import type { GameSession, Member, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { createRound } from '../../src/server/modules/rounds/service.js';
import { ensureSeason } from '../../src/server/modules/seasons/service.js';
import {
  getReportDto,
  revokeReport,
  reviewReport,
  submitReport,
  submitRoundReport,
  updateOwnReport,
} from '../../src/server/modules/stats/reports.js';
import {
  DAY_REPORTS_REPLACED_MESSAGE,
  ROUND_REPORT_CLOSED_MESSAGE,
  ROUND_REPORT_DUPLICATE_MESSAGE,
} from '../../src/shared/rounds.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';

/** 12:00 ngày 05/11/2026 giờ VN. */
const NOW = '2026-11-05T05:00:00Z';
/** Buổi 21:00 ngày 04/11/2026 giờ VN. */
const SESSION_AT = '2026-11-04T14:00:00Z';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')]);

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let mod: Member;
let a: Member;
let b: Member;
let session: GameSession;
let duck: Role;
let goose: Role;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  setNow(NOW);
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  a = await createMember(testDb, { displayName: 'An', discordId: 'discord-an' });
  b = await createMember(testDb, { displayName: 'Bình' });
  session = await createSession(testDb, { startsAt: new Date(SESSION_AT), createdById: mod.id });
  duck = await roleByKey(testDb, 'duck');
  goose = await roleByKey(testDb, 'goose');
});
afterEach(() => vi.restoreAllMocks());

const modR = () => ({ id: mod.id, accessLevel: mod.accessLevel });

async function round(s: GameSession = session, winner: 'goose' | 'duck' | 'neutral' | null = null): Promise<number> {
  return (await createRound(ctx, mod.id, s.id, PNG, winner)).id;
}

test('khai theo ván: chờ duyệt, gắn ván, buổi của ván và ngày VN của buổi', async () => {
  const r1 = await round(session, 'duck');
  const created = await submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 2, note: '  hay  ' });
  expect(created).toMatchObject({
    memberId: a.id,
    roleId: duck.id,
    roundId: r1,
    sessionId: session.id,
    playedOn: dateOnlyToDb('2026-11-04'),
    value: 2,
    extraValue: 0,
    penaltyValue: 0,
    note: 'hay',
    status: 'pending',
    source: 'self',
    createdAt: ctx.now(),
  });
  const dto = await getReportDto(ctx, created.id);
  expect(dto.round).toEqual({ id: r1, number: 1, sessionId: session.id, winnerFaction: 'duck', won: true });
  expect(dto.playedOn).toBe('2026-11-04');
  expect(dto.sessionId).toBe(session.id);
});

test('buổi bắt đầu sau nửa đêm: ngày chơi là ngày VN của buổi', async () => {
  // 00:30 ngày 05/11 giờ VN.
  const late = await createSession(testDb, { startsAt: new Date('2026-11-04T17:30:00Z'), createdById: mod.id });
  const id = await round(late);
  const created = await submitRoundReport(ctx, a.id, id, { roleId: duck.id, value: 1 });
  expect(created.playedOn).toEqual(dateOnlyToDb('2026-11-05'));
  expect(created.sessionId).toBe(late.id);
});

test('mỗi (ván, người) một lần khai còn hiệu lực; bị từ chối thì khai lại được', async () => {
  const r1 = await round();
  const r2 = await round();
  const first = await submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1 });
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: goose.id, value: 0 })).rejects.toMatchObject({
    code: 'ROUND_REPORT_DUPLICATE',
    status: 409,
    message: 'Bạn đã khai ván này rồi',
  });
  expect(ROUND_REPORT_DUPLICATE_MESSAGE).toBe('Bạn đã khai ván này rồi');
  // Người khác cùng ván, cùng người ván khác: được.
  await submitRoundReport(ctx, b.id, r1, { roleId: goose.id, value: 0 });
  await submitRoundReport(ctx, a.id, r2, { roleId: goose.id, value: 0 });

  // Đã duyệt vẫn chặn; bị từ chối thì khai lại được; khai lại rồi huỷ duyệt → khai lại được.
  await reviewReport(ctx, modR(), first.id, { approve: false, reason: 'sai role' });
  const again = await submitRoundReport(ctx, a.id, r1, { roleId: goose.id, value: 0 });
  await reviewReport(ctx, modR(), again.id, { approve: true });
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: goose.id, value: 0 })).rejects.toMatchObject({ code: 'ROUND_REPORT_DUPLICATE' });
  await revokeReport(ctx, modR(), again.id, 'nhầm');
  await submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 0 });
  expect(await testDb.statReport.count({ where: { roundId: r1, memberId: a.id } })).toBe(3);
});

test('hai lần khai cùng ván gửi song song → đúng một lần được ghi', async () => {
  const r1 = await round();
  const results = await Promise.allSettled([
    submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1 }),
    submitRoundReport(ctx, a.id, r1, { roleId: goose.id, value: 0 }),
    submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 2 }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  for (const r of results.filter((x) => x.status === 'rejected')) {
    expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'ROUND_REPORT_DUPLICATE', message: 'Bạn đã khai ván này rồi' });
  }
  expect(await testDb.statReport.count({ where: { roundId: r1 } })).toBe(1);
});

test('ván không còn nhận khai: không có, buổi huỷ, ngoài 3 ngày, mùa trước luật ván', async () => {
  const closed = { code: 'ROUND_REPORT_CLOSED', status: 409, message: 'Ván này không còn nhận khai' };
  expect(ROUND_REPORT_CLOSED_MESSAGE).toBe('Ván này không còn nhận khai');
  await expect(submitRoundReport(ctx, a.id, 999_999, { roleId: duck.id, value: 1 })).rejects.toMatchObject(closed);
  await expect(submitRoundReport(ctx, a.id, -1, { roleId: duck.id, value: 1 })).rejects.toMatchObject(closed);

  // Buổi bị huỷ sau khi đã có ván.
  const r1 = await round();
  await testDb.gameSession.update({ where: { id: session.id }, data: { status: 'cancelled' } });
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1 })).rejects.toMatchObject(closed);
  await testDb.gameSession.update({ where: { id: session.id }, data: { status: 'scheduled' } });

  // Ngày VN của buổi (04/11) trong [hôm nay − 3, hôm nay]: 07/11 còn được, 08/11 thì không.
  setNow('2026-11-07T16:59:59Z');
  await submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1 });
  setNow('2026-11-07T17:00:00Z');
  await expect(submitRoundReport(ctx, b.id, r1, { roleId: duck.id, value: 1 })).rejects.toMatchObject(closed);

  // Buổi tháng 10 (mùa chưa dùng luật ván) có ván: không nhận khai theo ván.
  setNow('2026-11-01T05:00:00Z');
  const oct = await createSession(testDb, { startsAt: new Date('2026-10-31T14:00:00Z'), createdById: mod.id });
  const octRound = await round(oct);
  await expect(submitRoundReport(ctx, b.id, octRound, { roleId: duck.id, value: 1 })).rejects.toMatchObject(closed);
});

test('khai theo ván dùng chung bộ kiểm tra: thành viên, role, giới hạn, ghi chú, mùa chốt, 30 lần/ngày', async () => {
  const r1 = await round();
  const left = await createMember(testDb, { displayName: 'Đã rời', status: 'left' });
  await expect(submitRoundReport(ctx, left.id, r1, { roleId: duck.id, value: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await testDb.role.update({ where: { id: goose.id }, data: { active: false } });
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: goose.id, value: 0 })).rejects.toMatchObject({ code: 'ROLE_INACTIVE' });
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 999 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1, extraValue: 1 })).rejects.toMatchObject({
    message: 'Role này không có chỉ số phụ',
  });
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1, note: 'x'.repeat(301) })).rejects.toMatchObject({
    message: 'Ghi chú tối đa 300 ký tự',
  });
  // Body không nhận ngày/buổi/báo cáo người chơi.
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1, playedOn: '2026-11-04' } as never)).rejects.toMatchObject({
    code: 'VALIDATION',
  });
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1, accusation: null } as never)).rejects.toMatchObject({
    message: 'Báo cáo người chơi gửi ở tab riêng',
  });

  // 30 lần/ngày tính chung lần khai theo ngày và theo ván.
  await testDb.statReport.createMany({
    data: Array.from({ length: 30 }, () => ({ memberId: b.id, roleId: duck.id, playedOn: dateOnlyToDb('2026-10-31'), value: 0, createdAt: ctx.now() })),
  });
  await expect(submitRoundReport(ctx, b.id, r1, { roleId: duck.id, value: 1 })).rejects.toMatchObject({ code: 'RATE_LIMITED' });

  await ensureSeason(ctx, '2026-11');
  await testDb.season.update({ where: { id: '2026-11' }, data: { closedAt: ctx.now() } });
  await expect(submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1 })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
  expect(await testDb.statReport.count({ where: { roundId: r1 } })).toBe(0);
});

test('khai theo ngày cho ngày thuộc mùa luật ván bị chặn; mùa cũ vẫn khai được', async () => {
  expect(DAY_REPORTS_REPLACED_MESSAGE).toBe('Từ tháng 11 khai điểm theo ván — chọn buổi và ván để khai');
  setNow('2026-11-02T05:00:00Z');
  await expect(submitReport(ctx, a.id, { roleId: duck.id, value: 1, playedOn: '2026-11-01' })).rejects.toMatchObject({
    code: 'VALIDATION',
    status: 400,
    message: 'Từ tháng 11 khai điểm theo ván — chọn buổi và ván để khai',
  });
  const old = await submitReport(ctx, a.id, { roleId: duck.id, value: 1, playedOn: '2026-10-31' });
  expect(old.roundId).toBeNull();

  // Sửa lần khai theo ngày sang ngày của mùa mới cũng bị chặn; sửa giá trị thì được.
  await expect(updateOwnReport(ctx, a.id, old.id, { playedOn: '2026-11-01' })).rejects.toMatchObject({ message: DAY_REPORTS_REPLACED_MESSAGE });
  expect((await updateOwnReport(ctx, a.id, old.id, { value: 2 })).value).toBe(2);
});

test('lần khai theo ngày mùa mới có từ trước (chờ duyệt) vẫn sửa giá trị được', async () => {
  setNow('2026-11-02T05:00:00Z');
  const legacy = await testDb.statReport.create({
    data: { memberId: a.id, roleId: duck.id, playedOn: dateOnlyToDb('2026-11-01'), value: 1, createdAt: ctx.now() },
  });
  expect((await updateOwnReport(ctx, a.id, legacy.id, { value: 3 })).value).toBe(3);
});

test('sửa lần khai theo ván: đổi role/chỉ số được, không đổi ván/ngày/buổi', async () => {
  const r1 = await round();
  const other = await createSession(testDb, { startsAt: new Date('2026-11-05T02:00:00Z'), createdById: mod.id });
  const r = await submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1 });
  const edited = await updateOwnReport(ctx, a.id, r.id, { roleId: goose.id, value: 0, note: 'đổi' });
  expect(edited).toMatchObject({ roleId: goose.id, value: 0, note: 'đổi', roundId: r1, sessionId: session.id, playedOn: dateOnlyToDb('2026-11-04') });

  await expect(updateOwnReport(ctx, a.id, r.id, { roundId: r1 } as never)).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateOwnReport(ctx, a.id, r.id, { playedOn: '2026-11-05' })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateOwnReport(ctx, a.id, r.id, { sessionId: other.id })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateOwnReport(ctx, a.id, r.id, { sessionId: null })).rejects.toMatchObject({ code: 'VALIDATION' });
  // Gửi lại đúng giá trị đang có thì không sao (form gửi cả bản ghi).
  await updateOwnReport(ctx, a.id, r.id, { playedOn: '2026-11-04', sessionId: session.id, value: 1 });

  // Hết hạn khai của ván → không sửa được nữa, với câu của ván.
  setNow('2026-11-07T17:00:00Z');
  await expect(updateOwnReport(ctx, a.id, r.id, { value: 2 })).rejects.toMatchObject({ code: 'ROUND_REPORT_CLOSED' });
  const row = await testDb.statReport.findUniqueOrThrow({ where: { id: r.id } });
  expect(row).toMatchObject({ roleId: goose.id, value: 1, roundId: r1 });
});

test('DM từ chối / huỷ duyệt nêu số ván', async () => {
  const r1 = await round(session, 'duck');
  await round();
  const r3 = await round();
  const x = await submitRoundReport(ctx, a.id, r3, { roleId: duck.id, value: 2 });
  await reviewReport(ctx, modR(), x.id, { approve: false, reason: 'sai ván' });
  const y = await submitRoundReport(ctx, a.id, r1, { roleId: duck.id, value: 1 });
  await reviewReport(ctx, modR(), y.id, { approve: true });
  await revokeReport(ctx, modR(), y.id, 'nhầm');
  const texts = notifier.dms.filter((d) => d.discordId === 'discord-an').map((d) => d.text);
  expect(texts).toHaveLength(2);
  expect(texts[0]).toMatch(/^Lần khai Vịt \(.+\) ván 3 ngày 04\/11 bị từ chối: sai ván$/);
  expect(texts[1]).toMatch(/^Lần khai Vịt \(.+\) ván 1 ngày 04\/11 đã bị huỷ duyệt: nhầm$/);
});
