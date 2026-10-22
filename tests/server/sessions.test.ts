import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  cancelSession,
  createSession,
  getSessionView,
  listSessionsOnVnDate,
  setAttendance,
  syncSessionMessage,
} from '../../src/server/modules/sessions/service.js';
import { markMemberLeft, upsertMemberFromGuild } from '../../src/server/modules/members/service.js';
import type { GuildMemberInfo } from '../../src/server/ports.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession as insertSession } from '../helpers/factories.js';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

/** 21:00 ngày 22/10/2026 giờ VN = now mặc định (19:00 VN) + 2 giờ. */
const startsAt = new Date('2026-10-22T14:00:00Z');

async function setup() {
  const t = makeTestCtx();
  const admin = await createMember(testDb, { accessLevel: 'admin', displayName: 'Admin' });
  const classic = await testDb.gameMode.findUniqueOrThrow({ where: { key: 'classic' } });
  return { ...t, admin, classic };
}

const sessionRow = (id: number) => testDb.gameSession.findUniqueOrThrow({ where: { id } });
const attendanceRow = (sessionId: number, memberId: number) =>
  testDb.attendance.findUniqueOrThrow({ where: { sessionId_memberId: { sessionId, memberId } } });
const goingCount = (sessionId: number) => testDb.attendance.count({ where: { sessionId, status: 'going' } });
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

test('create publishes and stores message id', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const v = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });

  expect(v.capacity).toBe(16);
  expect(v).toEqual({
    id: v.id,
    startsAt,
    modeName: 'Cổ điển (Classic)',
    capacity: 16,
    roomCode: null,
    note: null,
    status: 'scheduled',
    attendees: [],
  });
  expect(notifier.published).toHaveLength(1);
  expect(notifier.published[0]).toEqual(v);
  expect(notifier.updated).toHaveLength(0);

  const row = await sessionRow(v.id);
  expect(row.discordMessageId).toBe('msg-1');
  expect(row).toMatchObject({ discordDirty: false, createdById: admin.id, status: 'scheduled', modeId: classic.id });
});

test('create trims room code and note, keeps capacity and blanks become null', async () => {
  const { ctx, admin, classic } = await setup();
  const v = await createSession(ctx, admin.id, {
    startsAt,
    modeId: classic.id,
    capacity: 10,
    roomCode: '  ABCDEF  ',
    note: '  Mang theo mic  ',
  });
  expect(v).toMatchObject({ capacity: 10, roomCode: 'ABCDEF', note: 'Mang theo mic' });

  const blank = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, roomCode: '   ', note: '' });
  expect(blank).toMatchObject({ roomCode: null, note: null });
});

test('create validation', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const base = { startsAt, modeId: classic.id };
  const rejects = (input: Parameters<typeof createSession>[2], message?: string) =>
    expect(createSession(ctx, admin.id, input)).rejects.toMatchObject(
      message === undefined ? { code: 'VALIDATION' } : { code: 'VALIDATION', message },
    );

  await rejects({ ...base, capacity: 0 }, 'Sức chứa phải từ 1 đến 25');
  await rejects({ ...base, capacity: 26 }, 'Sức chứa phải từ 1 đến 25');
  await rejects({ ...base, capacity: 2.5 }, 'Sức chứa phải từ 1 đến 25');

  // Không sớm hơn now − 5 phút (now = 12:00:00Z).
  await rejects({ ...base, startsAt: new Date('2026-10-22T11:54:59Z') }, 'Giờ bắt đầu đã qua');
  await rejects({ ...base, startsAt: new Date('không phải ngày') });

  const inactive = await testDb.gameMode.update({ where: { key: 'goose_hunt' }, data: { active: false } });
  await rejects({ ...base, modeId: inactive.id }, 'Chế độ chơi không hợp lệ');
  await rejects({ ...base, modeId: 9999 }, 'Chế độ chơi không hợp lệ');

  await rejects({ ...base, roomCode: 'x'.repeat(21) });
  await rejects({ ...base, note: 'x'.repeat(301) });

  // Không có gì được lưu hay đăng lên Discord khi dữ liệu sai.
  expect(await testDb.gameSession.count()).toBe(0);
  expect(notifier.published).toHaveLength(0);

  // Các biên hợp lệ: đúng 5 phút trước, sức chứa 1 và 25, mã phòng 20 và ghi chú 300 ký tự.
  await createSession(ctx, admin.id, { ...base, startsAt: new Date('2026-10-22T11:55:00Z'), capacity: 1 });
  await createSession(ctx, admin.id, { ...base, capacity: 25, roomCode: 'x'.repeat(20), note: 'x'.repeat(300) });
  expect(await testDb.gameSession.count()).toBe(2);
});

test('create while Discord down marks dirty', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const errors = silenceConsoleError();
  notifier.down = true;

  const v = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, capacity: 8 });
  expect(v).toMatchObject({ capacity: 8, status: 'scheduled', attendees: [] });

  const row = await sessionRow(v.id);
  expect(row).toMatchObject({ discordMessageId: null, discordDirty: true, capacity: 8 });
  expect(notifier.published).toHaveLength(0);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(errors.mock.calls[0]?.[0]).toContain(String(v.id));
});

// ---------------------------------------------------------------------------
// getSessionView / listSessionsOnVnDate
// ---------------------------------------------------------------------------

test('getSessionView on unknown id is NOT_FOUND', async () => {
  const { ctx } = await setup();
  await expect(getSessionView(ctx, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('sessions listed by VN day', async () => {
  const { ctx } = await setup();
  // 00:30 ngày 23/10 giờ VN — vẫn là 22/10 theo UTC.
  const lateNight = await insertSession(testDb, { startsAt: new Date('2026-10-22T17:30:00Z') });
  // 23:59 ngày 22/10 giờ VN.
  const lastMinute = await insertSession(testDb, { startsAt: new Date('2026-10-22T16:59:00Z') });
  const evening = await insertSession(testDb, { startsAt: new Date('2026-10-22T14:00:00Z') });
  const cancelled = await insertSession(testDb, { startsAt: new Date('2026-10-22T10:00:00Z'), status: 'cancelled' });
  // 00:00 ngày 22/10 giờ VN — đầu ngày, thuộc 22/10.
  const midnight = await insertSession(testDb, { startsAt: new Date('2026-10-21T17:00:00Z') });

  const ids = (views: { id: number }[]) => views.map((v) => v.id);
  // Tăng dần theo giờ bắt đầu, gồm cả buổi huỷ.
  expect(ids(await listSessionsOnVnDate(ctx, '2026-10-22'))).toEqual([
    midnight.id,
    cancelled.id,
    evening.id,
    lastMinute.id,
  ]);
  expect(ids(await listSessionsOnVnDate(ctx, '2026-10-23'))).toEqual([lateNight.id]);
  expect(await listSessionsOnVnDate(ctx, '2026-10-21')).toEqual([]);

  const [first] = await listSessionsOnVnDate(ctx, '2026-10-23');
  expect(first).toMatchObject({ id: lateNight.id, modeName: 'Cổ điển (Classic)', status: 'scheduled', attendees: [] });
  expect((await listSessionsOnVnDate(ctx, '2026-10-22'))[1]?.status).toBe('cancelled');

  await expect(listSessionsOnVnDate(ctx, '22/10/2026')).rejects.toMatchObject({ code: 'VALIDATION' });
});

// ---------------------------------------------------------------------------
// setAttendance
// ---------------------------------------------------------------------------

test('join, rejoin idempotent, leave', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb, { displayName: 'An' });

  const joined = await setAttendance(ctx, s.id, m.id, true);
  expect(joined.attendees).toEqual([{ memberId: m.id, displayName: 'An' }]);

  const again = await setAttendance(ctx, s.id, m.id, true);
  expect(again.attendees).toEqual([{ memberId: m.id, displayName: 'An' }]);
  expect(await testDb.attendance.count({ where: { sessionId: s.id } })).toBe(1);

  const left = await setAttendance(ctx, s.id, m.id, false);
  expect(left.attendees).toEqual([]);
  expect((await attendanceRow(s.id, m.id)).status).toBe('cancelled');
  expect(await getSessionView(ctx, s.id)).toEqual(left);

  // Mỗi lần bấm đều sửa lại tin Discord đã đăng, không đăng tin mới.
  expect(notifier.published).toHaveLength(1);
  expect(notifier.updated.map((u) => u.messageId)).toEqual(['msg-1', 'msg-1', 'msg-1']);
  expect(notifier.updated[2]?.view).toEqual(left);
  expect((await sessionRow(s.id)).discordDirty).toBe(false);
});

test('rejoining while already going keeps the original join time', async () => {
  const { ctx, setNow, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb);

  setNow('2026-10-22T12:01:00Z');
  await setAttendance(ctx, s.id, m.id, true);
  expect((await attendanceRow(s.id, m.id)).updatedAt).toEqual(new Date('2026-10-22T12:01:00Z'));

  // Bấm lại khi đang tham gia: không đụng dòng, giữ giờ tham gia ban đầu.
  setNow('2026-10-22T12:02:00Z');
  await setAttendance(ctx, s.id, m.id, true);
  expect((await attendanceRow(s.id, m.id)).updatedAt).toEqual(new Date('2026-10-22T12:01:00Z'));

  // Đổi trạng thái thì ghi giờ của ctx.now(), không phải đồng hồ thật.
  setNow('2026-10-22T12:03:00Z');
  await setAttendance(ctx, s.id, m.id, false);
  expect(await attendanceRow(s.id, m.id)).toMatchObject({
    status: 'cancelled',
    updatedAt: new Date('2026-10-22T12:03:00Z'),
  });

  setNow('2026-10-22T12:04:00Z');
  await setAttendance(ctx, s.id, m.id, true);
  expect(await attendanceRow(s.id, m.id)).toMatchObject({
    status: 'going',
    updatedAt: new Date('2026-10-22T12:04:00Z'),
  });
});

test('leaving a session never joined is a no-op', async () => {
  const { ctx, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb);

  const v = await setAttendance(ctx, s.id, m.id, false);
  expect(v.attendees).toEqual([]);
  expect(await testDb.attendance.count({ where: { sessionId: s.id } })).toBe(0);

  // Rời rồi rời tiếp: cũng không đổi gì (giữ giờ rời ban đầu).
  await setAttendance(ctx, s.id, m.id, true);
  await setAttendance(ctx, s.id, m.id, false);
  const first = await attendanceRow(s.id, m.id);
  await setAttendance(ctx, s.id, m.id, false);
  expect(await attendanceRow(s.id, m.id)).toEqual(first);
});

test('attendees are listed in join order', async () => {
  const { ctx, setNow, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const a = await createMember(testDb, { displayName: 'A' });
  const b = await createMember(testDb, { displayName: 'B' });
  const c = await createMember(testDb, { displayName: 'C' });

  setNow('2026-10-22T12:01:00Z');
  await setAttendance(ctx, s.id, c.id, true);
  setNow('2026-10-22T12:02:00Z');
  await setAttendance(ctx, s.id, a.id, true);
  // Cùng một mốc giờ: xếp theo memberId.
  await setAttendance(ctx, s.id, b.id, true);

  expect((await getSessionView(ctx, s.id)).attendees).toEqual([
    { memberId: c.id, displayName: 'C' },
    { memberId: a.id, displayName: 'A' },
    { memberId: b.id, displayName: 'B' },
  ]);

  // Rời rồi vào lại thì xuống cuối danh sách.
  setNow('2026-10-22T12:03:00Z');
  await setAttendance(ctx, s.id, c.id, false);
  await setAttendance(ctx, s.id, c.id, true);
  expect((await getSessionView(ctx, s.id)).attendees.map((x) => x.displayName)).toEqual(['A', 'B', 'C']);
});

test('full session rejects', async () => {
  const { ctx, setNow, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, capacity: 2 });
  const a = await createMember(testDb);
  const b = await createMember(testDb);
  const c = await createMember(testDb);

  await setAttendance(ctx, s.id, a.id, true);
  await setAttendance(ctx, s.id, b.id, true);
  await expect(setAttendance(ctx, s.id, c.id, true)).rejects.toMatchObject({
    code: 'SESSION_FULL',
    message: 'Đã đủ người',
  });
  expect(await goingCount(s.id)).toBe(2);

  // Người đang tham gia bấm lại khi đã đủ: vẫn ok (không đếm thêm).
  expect((await setAttendance(ctx, s.id, a.id, true)).attendees).toHaveLength(2);

  // Có người rời thì chỗ trống lại; người vào sau xếp sau.
  await setAttendance(ctx, s.id, a.id, false);
  setNow('2026-10-22T12:01:00Z');
  expect((await setAttendance(ctx, s.id, c.id, true)).attendees.map((x) => x.memberId)).toEqual([b.id, c.id]);
  expect(await goingCount(s.id)).toBe(2);
});

test('concurrent joins never exceed capacity', async () => {
  const { ctx, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, capacity: 3 });
  const ms = await Promise.all([...Array(6)].map((_, i) => createMember(testDb, { discordId: `c${i}` })));

  const results = await Promise.allSettled(ms.map((m) => setAttendance(ctx, s.id, m.id, true)));

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  expect(fulfilled).toHaveLength(3);
  expect(rejected).toHaveLength(3);
  for (const r of rejected) expect(r.reason).toMatchObject({ code: 'SESSION_FULL' });
  expect(await testDb.attendance.count({ where: { sessionId: s.id, status: 'going' } })).toBe(3);
  expect((await getSessionView(ctx, s.id)).attendees).toHaveLength(3);
});

const guildInfo = (discordId: string, displayName: string): GuildMemberInfo => ({
  discordId,
  displayName,
  avatarUrl: null,
  roleIds: [],
});

test('leaving the server frees the seat, and rejoining does not take it back', async () => {
  const { ctx, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, capacity: 2 });
  const a = await createMember(testDb, { displayName: 'A' });
  const b = (await upsertMemberFromGuild(ctx, guildInfo('dB', 'B'))).member;
  const c = await createMember(testDb, { displayName: 'C' });

  await setAttendance(ctx, s.id, a.id, true);
  await setAttendance(ctx, s.id, b.id, true);

  // B rời server: chỗ của B bị huỷ ngay, buổi chờ bộ hẹn giờ sửa lại tin Discord.
  await markMemberLeft(ctx, 'dB');
  expect(await attendanceRow(s.id, b.id)).toMatchObject({ status: 'cancelled', updatedAt: ctx.now() });
  expect((await sessionRow(s.id)).discordDirty).toBe(true);
  expect((await getSessionView(ctx, s.id)).attendees).toEqual([{ memberId: a.id, displayName: 'A' }]);
  expect(await goingCount(s.id)).toBe(1);

  // C lấy chỗ vừa trống.
  const v = await setAttendance(ctx, s.id, c.id, true);
  expect(v.attendees).toEqual([
    { memberId: a.id, displayName: 'A' },
    { memberId: c.id, displayName: 'C' },
  ]);

  // B quay lại server: không tự có lại chỗ; bấm Tham gia thì buổi đã đủ người.
  expect((await upsertMemberFromGuild(ctx, guildInfo('dB', 'B'))).reactivated).toBe(true);
  expect(await goingCount(s.id)).toBe(2);
  expect((await getSessionView(ctx, s.id)).attendees.map((x) => x.memberId)).toEqual([a.id, c.id]);
  await expect(setAttendance(ctx, s.id, b.id, true)).rejects.toMatchObject({ code: 'SESSION_FULL' });
  expect(await goingCount(s.id)).toBe(2);
  expect((await attendanceRow(s.id, b.id)).status).toBe('cancelled');
});

test('a stale going row of a left member neither counts toward capacity nor appears as an attendee', async () => {
  const { ctx, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, capacity: 2 });
  const a = await createMember(testDb, { displayName: 'A' });
  const b = await createMember(testDb, { displayName: 'B' });
  const c = await createMember(testDb, { displayName: 'C' });

  await setAttendance(ctx, s.id, a.id, true);
  await setAttendance(ctx, s.id, b.id, true);
  // Đổi thẳng trạng thái trong DB, không qua module thành viên — mô phỏng dòng `going`
  // còn sót (vd đua giữa lúc rời server và lúc bấm Tham gia). Lớp phòng thủ thứ hai.
  await testDb.member.update({ where: { id: b.id }, data: { status: 'left', leftAt: ctx.now() } });
  expect((await attendanceRow(s.id, b.id)).status).toBe('going');

  expect((await getSessionView(ctx, s.id)).attendees).toEqual([{ memberId: a.id, displayName: 'A' }]);

  // Dòng sót không chiếm chỗ: C vẫn vào được.
  const v = await setAttendance(ctx, s.id, c.id, true);
  expect(v.attendees).toEqual([
    { memberId: a.id, displayName: 'A' },
    { memberId: c.id, displayName: 'C' },
  ]);

  // Người đã rời server (hoặc không tồn tại) không được bấm.
  await expect(setAttendance(ctx, s.id, b.id, false)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(setAttendance(ctx, s.id, 999, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('cannot join cancelled session', async () => {
  const { ctx, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb);
  await setAttendance(ctx, s.id, m.id, true);

  await cancelSession(ctx, s.id);
  await expect(setAttendance(ctx, s.id, m.id, true)).rejects.toMatchObject({
    code: 'SESSION_NOT_OPEN',
    message: 'Buổi chơi đã kết thúc hoặc bị huỷ',
  });
  // Rời cũng không được nữa; dòng điểm danh giữ nguyên.
  await expect(setAttendance(ctx, s.id, m.id, false)).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
  expect((await attendanceRow(s.id, m.id)).status).toBe('going');

  const ended = await insertSession(testDb, { status: 'ended', endedAt: ctx.now() });
  await expect(setAttendance(ctx, ended.id, m.id, true)).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });

  await expect(setAttendance(ctx, 999, m.id, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('setAttendance while Discord down still saves and marks dirty', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  silenceConsoleError();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb, { displayName: 'An' });

  notifier.down = true;
  const v = await setAttendance(ctx, s.id, m.id, true);
  expect(v.attendees).toEqual([{ memberId: m.id, displayName: 'An' }]);
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: true });
  expect(notifier.updated).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// syncSessionMessage
// ---------------------------------------------------------------------------

test('sync publishes a missing message, then updates it, and never throws', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const errors = silenceConsoleError();
  notifier.down = true;
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: null, discordDirty: true });

  // Discord trở lại: đăng bù, lưu id, xoá cờ.
  notifier.down = false;
  await syncSessionMessage(ctx, s.id);
  expect(notifier.published).toHaveLength(1);
  expect(notifier.published[0]).toEqual(await getSessionView(ctx, s.id));
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: false });

  // Đã có id: sửa tin cũ, không đăng thêm.
  await syncSessionMessage(ctx, s.id);
  expect(notifier.published).toHaveLength(1);
  expect(notifier.updated).toEqual([{ messageId: 'msg-1', view: await getSessionView(ctx, s.id) }]);

  // Sập lúc sửa: giữ id, bật cờ, ghi log kèm id buổi, không ném lỗi.
  notifier.down = true;
  await expect(syncSessionMessage(ctx, s.id)).resolves.toBeUndefined();
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: true });
  expect(errors).toHaveBeenCalledTimes(2);
  expect(errors.mock.calls[1]?.[0]).toContain(String(s.id));

  // Buổi không tồn tại: không ném lỗi, không gọi Discord.
  notifier.down = false;
  await expect(syncSessionMessage(ctx, 999)).resolves.toBeUndefined();
  expect(notifier.published).toHaveLength(1);
  expect(notifier.updated).toHaveLength(1);
});

test('near-simultaneous presses never leave an older view on the Discord message', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const a = await createMember(testDb);
  const b = await createMember(testDb);

  // Lần sửa tin đầu tiên "treo" ở Discord cho tới khi được thả — mô phỏng HTTP chậm.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const updateSpy = vi.spyOn(notifier, 'updateSession').mockImplementationOnce(async (messageId, view) => {
    await gate;
    notifier.updated.push({ messageId, view });
  });

  const first = setAttendance(ctx, s.id, a.id, true);
  await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));

  // Người thứ hai vào trong lúc lần sửa đầu còn treo: đã lưu, nhưng lần sửa của họ phải xếp hàng.
  const second = setAttendance(ctx, s.id, b.id, true);
  await vi.waitFor(async () => expect(await goingCount(s.id)).toBe(2));
  expect(updateSpy).toHaveBeenCalledTimes(1);

  release();
  await Promise.all([first, second]);
  // Bản cuối cùng gửi lên Discord là bản mới nhất (2 người), không phải bản cũ (1 người).
  expect(updateSpy).toHaveBeenCalledTimes(2);
  expect(notifier.updated.map((u) => u.view.attendees.length)).toEqual([1, 2]);
  expect((await sessionRow(s.id)).discordDirty).toBe(false);
});

// ---------------------------------------------------------------------------
// cancelSession
// ---------------------------------------------------------------------------

test('cancel DMs only going attendees and survives DM failure', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const errors = silenceConsoleError();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const a = await createMember(testDb, { discordId: 'dA' });
  const b = await createMember(testDb, { discordId: 'dB' });
  const c = await createMember(testDb, { discordId: 'dC' });
  const d = await createMember(testDb, { discordId: 'dD' });

  await setAttendance(ctx, s.id, a.id, true);
  await setAttendance(ctx, s.id, b.id, true);
  await setAttendance(ctx, s.id, b.id, false);
  await setAttendance(ctx, s.id, c.id, true);
  await setAttendance(ctx, s.id, d.id, true);
  await testDb.member.update({ where: { id: d.id }, data: { status: 'left' } });
  notifier.failDmFor.add('dC');
  const updatesBefore = notifier.updated.length;

  await expect(cancelSession(ctx, s.id)).resolves.toBeUndefined();

  // Chỉ A nhận DM: B đã rời buổi, C lỗi DM (được ghi log), D đã rời server.
  expect(notifier.dms).toEqual([{ discordId: 'dA', text: 'Buổi chơi Cổ điển (Classic) lúc 21:00 ngày 22/10 đã bị huỷ.' }]);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(errors.mock.calls[0]?.[0]).toContain('dC');

  expect((await sessionRow(s.id)).status).toBe('cancelled');
  // Tin Discord được sửa sang trạng thái huỷ.
  expect(notifier.updated).toHaveLength(updatesBefore + 1);
  expect(notifier.updated.at(-1)?.view).toMatchObject({ id: s.id, status: 'cancelled' });
  expect(await getSessionView(ctx, s.id)).toMatchObject({ status: 'cancelled' });
});

test('cancel message uses VN wall-clock time and mode name', async () => {
  const { ctx, notifier, admin } = await setup();
  const goose = await testDb.gameMode.findUniqueOrThrow({ where: { key: 'goose_hunt' } });
  // 23:30 ngày 31/10 giờ VN = 16:30Z — ngày hiển thị theo giờ VN, không theo UTC.
  const s = await createSession(ctx, admin.id, { startsAt: new Date('2026-10-31T16:30:00Z'), modeId: goose.id });
  const m = await createMember(testDb, { discordId: 'dM' });
  await setAttendance(ctx, s.id, m.id, true);

  await cancelSession(ctx, s.id);
  expect(notifier.dms).toEqual([
    { discordId: 'dM', text: 'Buổi chơi Săn ngỗng (Goose Hunt) lúc 23:30 ngày 31/10 đã bị huỷ.' },
  ]);
});

test('cancel only works on scheduled sessions', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  await cancelSession(ctx, s.id);
  await expect(cancelSession(ctx, s.id)).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });

  const ended = await insertSession(testDb, { status: 'ended', endedAt: ctx.now() });
  await expect(cancelSession(ctx, ended.id)).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
  expect((await sessionRow(ended.id)).status).toBe('ended');

  await expect(cancelSession(ctx, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(notifier.dms).toEqual([]);
});

test('cancel while Discord down still cancels and marks dirty', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  silenceConsoleError();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb);
  await setAttendance(ctx, s.id, m.id, true);

  notifier.down = true;
  await expect(cancelSession(ctx, s.id)).resolves.toBeUndefined();
  expect(await sessionRow(s.id)).toMatchObject({ status: 'cancelled', discordDirty: true });
  expect(notifier.dms).toEqual([]);
});
