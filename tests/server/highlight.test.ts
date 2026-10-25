import type { Member, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { attachHighlight, detectHighlightKind, highlightConfig } from '../../src/server/modules/stats/highlight.js';
import {
  listMyReports,
  listPendingReports,
  reviewReport,
  submitReport,
  updateOwnReport,
} from '../../src/server/modules/stats/reports.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';

/** 12:00 ngày 10/10/2026 giờ VN. */
const NOW = '2026-10-10T05:00:00Z';
const MIB = 1024 * 1024;

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
/** Người khai mặc định. */
let member: Member;
let duck: Role;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  setNow(NOW);
  ctx.config.discord.highlightChannelId = 'hl-chan';
  ctx.config.discord.guildId = 'g1';
  member = await createMember(testDb, { displayName: 'An' });
  duck = await roleByKey(testDb, 'duck');
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// File mẫu tối thiểu — chỉ cần đúng chữ ký đầu file
// ---------------------------------------------------------------------------

/** ISO BMFF (MP4/MOV): 4 byte kích thước, `ftyp` ở byte 4, brand ở byte 8; phần còn lại là 0. */
function isoBmff(brand: string, size = 64): Buffer {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(Math.min(size, 0xffffffff), 0);
  buf.write('ftyp', 4, 'latin1');
  buf.write(brand, 8, 'latin1');
  return buf;
}
const mp4 = (size?: number) => isoBmff('isom', size);
const mov = () => isoBmff('qt  ');
const webm = () => Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const gif = () => Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');

/** Khai mặc định: Vịt, 3 mạng, ngày 10/10. */
const submit = (memberId = member.id) => submitReport(ctx, memberId, { roleId: duck.id, value: 3, playedOn: '2026-10-10' });
const attach = (reportId: number, data: Buffer, memberId = member.id) => attachHighlight(ctx, memberId, reportId, { data });
const reportRow = (id: number) => testDb.statReport.findUniqueOrThrow({ where: { id } });
const mod = () => createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
const asReviewer = (m: Member) => ({ id: m.id, accessLevel: m.accessLevel });
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const jumpLink = (channelId: string, messageId: string) => `https://discord.com/channels/g1/${channelId}/${messageId}`;

// ---------------------------------------------------------------------------

test('a pending report owner attaches a video and gets a Discord jump link', async () => {
  const r = await submit();
  const file = mp4();

  const dto = await attach(r.id, file);

  expect(notifier.highlights).toHaveLength(1);
  const posted = notifier.highlights[0]!;
  expect(posted).toEqual({
    memberName: 'An',
    roleLabel: '🦆 Vịt',
    valueText: '3 Số mạng đã giết',
    playedOnText: '10/10/2026',
    fileName: `highlight-${r.id}.mp4`,
    data: file,
    channelId: posted.channelId,
    messageId: posted.messageId,
  });
  expect(posted.channelId).toBeTruthy();
  expect(posted.messageId).toBeTruthy();

  // DTO trả về và DB cùng trỏ tới tin vừa đăng; phần còn lại của lần khai không đổi.
  expect(dto).toMatchObject({ id: r.id, value: 3, status: 'pending', highlightUrl: jumpLink(posted.channelId, posted.messageId) });
  expect(await reportRow(r.id)).toMatchObject({ highlightChannelId: posted.channelId, highlightMessageId: posted.messageId, status: 'pending' });
  expect(notifier.deletedMessages).toEqual([]);

  // Tên file theo loại thật của nội dung, không phải đuôi người dùng đặt.
  const r2 = await submit();
  await attach(r2.id, png());
  expect(notifier.highlights[1]).toMatchObject({ fileName: `highlight-${r2.id}.png` });
});

test("someone else's report → NOT_FOUND; approved/rejected report → NOT_PENDING", async () => {
  const other = await createMember(testDb, { displayName: 'Bình' });
  const theirs = await submit(other.id);
  await expect(attach(theirs.id, mp4())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  for (const badId of [9999, 0, -1, 1.5, Number.NaN, 2 ** 40]) {
    await expect(attach(badId, mp4())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }

  const m = await mod();
  const approved = await submit();
  await reviewReport(ctx, asReviewer(m), approved.id, { approve: true });
  await expect(attach(approved.id, mp4())).rejects.toMatchObject({ code: 'NOT_PENDING' });

  const rejected = await submit();
  await reviewReport(ctx, asReviewer(m), rejected.id, { approve: false, reason: 'Trùng' });
  await expect(attach(rejected.id, mp4())).rejects.toMatchObject({ code: 'NOT_PENDING' });

  expect(notifier.highlights).toEqual([]);
  expect(await reportRow(theirs.id)).toMatchObject({ highlightChannelId: null, highlightMessageId: null });
});

test('unknown or fake files → INVALID_HIGHLIGHT', async () => {
  const r = await submit();
  const invalid = {
    code: 'INVALID_HIGHLIGHT',
    status: 400,
    message: 'Highlight phải là video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF',
  };
  for (const data of [
    Buffer.from('hello'),
    Buffer.from('%PDF-1.4\n%âãÏÓ'),
    Buffer.alloc(0),
    Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), // WebP không nhận
    Buffer.from('ftypisom'), // `ftyp` phải ở byte 4, không phải byte 0
  ]) {
    await expect(attach(r.id, data), data.toString('latin1')).rejects.toMatchObject(invalid);
  }
  expect(notifier.highlights).toEqual([]);
  expect(await reportRow(r.id)).toMatchObject({ highlightChannelId: null, highlightMessageId: null });
});

test('a file exactly at the limit is accepted; one byte more is HIGHLIGHT_TOO_LARGE "Highlight tối đa 10 MB"', async () => {
  expect(notifier.uploadLimit).toBe(10 * MIB);
  const r = await submit();

  await expect(attach(r.id, mp4(10 * MIB + 1))).rejects.toMatchObject({
    code: 'HIGHLIGHT_TOO_LARGE',
    status: 400,
    message: 'Highlight tối đa 10 MB',
  });
  expect(notifier.highlights).toEqual([]);

  await expect(attach(r.id, mp4(10 * MIB))).resolves.toMatchObject({ id: r.id });
  expect(notifier.highlights[0]?.data.length).toBe(10 * MIB);

  // Server được boost cấp 2–3: giới hạn và câu chữ theo giới hạn hiện hành.
  notifier.uploadLimit = 50 * MIB;
  await expect(attach(r.id, mp4(50 * MIB + 1))).rejects.toMatchObject({
    code: 'HIGHLIGHT_TOO_LARGE',
    message: 'Highlight tối đa 50 MB',
  });
  await expect(attach(r.id, mp4(10 * MIB + 1))).resolves.toMatchObject({ id: r.id });
  expect(notifier.highlights).toHaveLength(2);
});

test('Discord down → DISCORD_UNAVAILABLE and nothing is saved', async () => {
  silenceConsoleError();
  const r = await submit();
  notifier.down = true;

  await expect(attach(r.id, mp4())).rejects.toMatchObject({
    code: 'DISCORD_UNAVAILABLE',
    status: 503,
    message: 'Không đăng được highlight lên Discord, thử lại sau',
  });
  expect(notifier.highlights).toEqual([]);
  expect(await reportRow(r.id)).toMatchObject({ highlightChannelId: null, highlightMessageId: null, status: 'pending' });
  expect((await listMyReports(ctx, member.id))[0]).toMatchObject({ id: r.id, highlightUrl: null });
});

test('replacing a highlight deletes the old Discord message', async () => {
  const r = await submit();
  await attach(r.id, mp4());
  const first = notifier.highlights[0]!;

  const dto = await attach(r.id, webm());
  const second = notifier.highlights[1]!;
  expect(second).toMatchObject({ fileName: `highlight-${r.id}.webm` });
  expect(second.messageId).not.toBe(first.messageId);
  expect(notifier.deletedMessages).toEqual([{ channelId: first.channelId, messageId: first.messageId }]);
  expect(dto.highlightUrl).toBe(jumpLink(second.channelId, second.messageId));
  expect(await reportRow(r.id)).toMatchObject({ highlightChannelId: second.channelId, highlightMessageId: second.messageId });

  // Không xoá được tin cũ (Discord sập ngay sau khi đăng) → highlight mới vẫn được lưu.
  silenceConsoleError();
  notifier.onPostHighlight = async () => {
    notifier.down = true;
  };
  const third = await attach(r.id, gif());
  notifier.down = false;
  const posted = notifier.highlights[2]!;
  expect(third.highlightUrl).toBe(jumpLink(posted.channelId, posted.messageId));
  expect(await reportRow(r.id)).toMatchObject({ highlightMessageId: posted.messageId });
  expect(notifier.deletedMessages).toHaveLength(1); // lần xoá thứ hai thất bại, không ghi lại
});

test('feature off (no highlight channel) → HIGHLIGHT_DISABLED; highlightConfig → { enabled: false, maxBytes: 0 }', async () => {
  expect(await highlightConfig(ctx)).toEqual({ enabled: true, maxBytes: 10 * MIB });
  notifier.uploadLimit = 50 * MIB;
  expect(await highlightConfig(ctx)).toEqual({ enabled: true, maxBytes: 50 * MIB });

  const r = await submit();
  ctx.config.discord.highlightChannelId = null;
  expect(await highlightConfig(ctx)).toEqual({ enabled: false, maxBytes: 0 });
  await expect(attach(r.id, mp4())).rejects.toMatchObject({
    code: 'HIGHLIGHT_DISABLED',
    status: 409,
    message: 'Chưa bật tính năng highlight',
  });
  expect(notifier.highlights).toEqual([]);

  // Tắt tính năng không đụng tới Discord — kể cả khi bot sập.
  notifier.down = true;
  expect(await highlightConfig(ctx)).toEqual({ enabled: false, maxBytes: 0 });

  // Bật tính năng nhưng không hỏi được giới hạn của server → lỗi Discord.
  silenceConsoleError();
  ctx.config.discord.highlightChannelId = 'hl-chan';
  await expect(highlightConfig(ctx)).rejects.toMatchObject({ code: 'DISCORD_UNAVAILABLE' });
});

test('report reviewed while uploading → the new message is deleted and NOT_PENDING', async () => {
  const r = await submit();
  // Mod duyệt đúng lúc file đang được đăng lên Discord (sau khi đã kiểm "còn pending").
  notifier.onPostHighlight = async () => {
    await testDb.statReport.update({ where: { id: r.id }, data: { status: 'approved' } });
  };

  await expect(attach(r.id, mp4())).rejects.toMatchObject({ code: 'NOT_PENDING' });

  expect(notifier.highlights).toHaveLength(1);
  const posted = notifier.highlights[0]!;
  expect(notifier.deletedMessages).toEqual([{ channelId: posted.channelId, messageId: posted.messageId }]);
  expect(await reportRow(r.id)).toMatchObject({ status: 'approved', highlightChannelId: null, highlightMessageId: null });
});

test('editing the report keeps the highlight; reviewed reports keep highlightUrl', async () => {
  const r = await submit();
  const plain = await submit();
  await attach(r.id, mov());
  const posted = notifier.highlights[0]!;
  expect(posted.fileName).toBe(`highlight-${r.id}.mov`);
  const url = jumpLink(posted.channelId, posted.messageId);

  await updateOwnReport(ctx, member.id, r.id, { value: 4, note: 'Trận cuối' });
  expect(await reportRow(r.id)).toMatchObject({ value: 4, highlightChannelId: posted.channelId, highlightMessageId: posted.messageId });

  // Hàng chờ duyệt và lịch sử của tôi đều có link; lần khai không highlight → null.
  const pending = await listPendingReports(ctx);
  expect(pending.find((p) => p.id === r.id)).toMatchObject({ highlightUrl: url });
  expect(pending.find((p) => p.id === plain.id)).toMatchObject({ highlightUrl: null });

  const m = await mod();
  await reviewReport(ctx, asReviewer(m), r.id, { approve: true });
  await reviewReport(ctx, asReviewer(m), plain.id, { approve: false, reason: 'Thiếu ảnh' });
  const mine = await listMyReports(ctx, member.id);
  expect(mine.find((p) => p.id === r.id)).toMatchObject({ status: 'approved', highlightUrl: url });
  expect(mine.find((p) => p.id === plain.id)).toMatchObject({ status: 'rejected', highlightUrl: null });
  expect(notifier.deletedMessages).toEqual([]);
});

test('detectHighlightKind recognises mp4, mov, webm, png, jpg, gif', () => {
  expect(detectHighlightKind(mp4())).toEqual({ ext: 'mp4' });
  expect(detectHighlightKind(isoBmff('mp42'))).toEqual({ ext: 'mp4' });
  expect(detectHighlightKind(isoBmff('M4V '))).toEqual({ ext: 'mp4' });
  expect(detectHighlightKind(mov())).toEqual({ ext: 'mov' });
  expect(detectHighlightKind(webm())).toEqual({ ext: 'webm' });
  expect(detectHighlightKind(png())).toEqual({ ext: 'png' });
  expect(detectHighlightKind(jpg())).toEqual({ ext: 'jpg' });
  expect(detectHighlightKind(gif())).toEqual({ ext: 'gif' });
  expect(detectHighlightKind(Buffer.from('GIF87a\x01\x00\x01\x00', 'latin1'))).toEqual({ ext: 'gif' });

  for (const data of [
    Buffer.alloc(0),
    Buffer.from('hello'),
    Buffer.from('%PDF-1.4'),
    Buffer.from('GIF'), // cụt
    Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG cụt
    Buffer.from([0xff, 0xd8, 0x00]),
    Buffer.from([0x1a, 0x45, 0xdf]),
    Buffer.from('\0\0\0\0fty'), // `ftyp` cụt
    Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]),
  ]) {
    expect(detectHighlightKind(data), data.toString('latin1')).toBeNull();
  }
});
