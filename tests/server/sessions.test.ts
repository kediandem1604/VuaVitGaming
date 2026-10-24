import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  cancelSession,
  createSession,
  getSessionView,
  listSessionsOnVnDate,
  setAttendance,
  syncSessionMessage,
  updateSession,
} from '../../src/server/modules/sessions/service.js';
import { markMemberLeft, upsertMemberFromGuild } from '../../src/server/modules/members/service.js';
import type { GuildMemberInfo } from '../../src/server/ports.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession as insertSession } from '../helpers/factories.js';
import { patchDelegate } from '../helpers/prisma.js';

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
// updateSession
// ---------------------------------------------------------------------------

test('update sets room code, note and capacity, trims them, and edits the Discord message', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });

  // Trong lúc sửa tin Discord, dòng buổi còn bẩn: chết giữa chừng thì bộ hẹn giờ sửa bù.
  let dirtyDuringEdit: boolean | null = null;
  vi.spyOn(notifier, 'updateSession').mockImplementationOnce(async (messageId, view) => {
    dirtyDuringEdit = (await sessionRow(s.id)).discordDirty;
    notifier.updated.push({ messageId, view });
  });

  const v = await updateSession(ctx, admin.id, s.id, { roomCode: '  XYZ123  ', note: '  Mang mic  ', capacity: 10 });
  expect(v).toEqual({ ...s, roomCode: 'XYZ123', note: 'Mang mic', capacity: 10 });
  expect(dirtyDuringEdit).toBe(true);
  expect(notifier.published).toHaveLength(1);
  expect(notifier.updated).toEqual([{ messageId: 'msg-1', view: v }]);
  expect(await sessionRow(s.id)).toMatchObject({
    roomCode: 'XYZ123',
    note: 'Mang mic',
    capacity: 10,
    startsAt,
    discordDirty: false,
  });
});

test('update clears room code and note with null or blanks, and leaves absent fields alone', async () => {
  const { ctx, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, capacity: 8, roomCode: 'ABC', note: 'Ghi chú' });

  expect(await updateSession(ctx, admin.id, s.id, { roomCode: null })).toMatchObject({ roomCode: null, note: 'Ghi chú', capacity: 8 });
  expect(await updateSession(ctx, admin.id, s.id, { note: '   ' })).toMatchObject({ roomCode: null, note: null, capacity: 8 });
  expect(await updateSession(ctx, admin.id, s.id, { roomCode: 'DEF', note: '' })).toMatchObject({ roomCode: 'DEF', note: null });
});

test('update validation', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, roomCode: 'ABC' });
  const before = await sessionRow(s.id);
  const rejects = (patch: Parameters<typeof updateSession>[3], message?: string) =>
    expect(updateSession(ctx, admin.id, s.id, patch)).rejects.toMatchObject(
      message === undefined ? { code: 'VALIDATION' } : { code: 'VALIDATION', message },
    );

  await rejects({ capacity: 0 }, 'Sức chứa phải từ 1 đến 25');
  await rejects({ capacity: 26 }, 'Sức chứa phải từ 1 đến 25');
  await rejects({ capacity: 2.5 }, 'Sức chứa phải từ 1 đến 25');
  await rejects({ roomCode: 'x'.repeat(21) }, 'Mã phòng tối đa 20 ký tự');
  await rejects({ note: 'x'.repeat(301) }, 'Ghi chú tối đa 300 ký tự');
  await rejects({ startsAt: new Date('không phải ngày') }, 'Dữ liệu không hợp lệ');
  // Giờ mới không sớm hơn now − 5 phút (now = 12:00:00Z), như khi tạo buổi.
  await rejects({ startsAt: new Date('2026-10-22T11:54:59Z') }, 'Giờ bắt đầu đã qua');
  // Một trường hỏng thì không trường nào được lưu.
  await rejects({ roomCode: 'MỚI', capacity: 0 });

  expect(await sessionRow(s.id)).toEqual(before);
  expect(notifier.updated).toHaveLength(0);

  // Các biên hợp lệ.
  await updateSession(ctx, admin.id, s.id, { capacity: 1, roomCode: 'x'.repeat(20), note: 'x'.repeat(300) });
  await updateSession(ctx, admin.id, s.id, { capacity: 25, startsAt: new Date('2026-10-22T11:55:00Z') });
  expect(await sessionRow(s.id)).toMatchObject({ capacity: 25, startsAt: new Date('2026-10-22T11:55:00Z') });
});

test('capacity cannot drop below the members going; members who left do not count', async () => {
  const { ctx, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const [a, b, c] = [await createMember(testDb), await createMember(testDb), await createMember(testDb)];
  for (const m of [a, b, c]) await setAttendance(ctx, s.id, m.id, true);
  // Dòng going cũ của người đã rời server (dữ liệu trước khi có trả chỗ tự động).
  await testDb.member.update({ where: { id: c.id }, data: { status: 'left' } });

  await expect(updateSession(ctx, admin.id, s.id, { capacity: 1 })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Đã có 2 người tham gia, sức chứa không được nhỏ hơn 2',
  });
  expect((await sessionRow(s.id)).capacity).toBe(16);

  expect(await updateSession(ctx, admin.id, s.id, { capacity: 2 })).toMatchObject({ capacity: 2 });
  // Đủ chỗ rồi: người thứ ba không vào được.
  const d = await createMember(testDb);
  await expect(setAttendance(ctx, s.id, d.id, true)).rejects.toMatchObject({ code: 'SESSION_FULL' });
});

test('a capacity cut and a join racing for the last seat never leave the session over capacity', async () => {
  const { ctx, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, capacity: 3 });
  const [a, b, c] = [await createMember(testDb), await createMember(testDb), await createMember(testDb)];
  await setAttendance(ctx, s.id, a.id, true);
  await setAttendance(ctx, s.id, b.id, true);

  // Cả hai khoá dòng buổi trước khi kiểm: hoặc c vào rồi giảm sức chứa bị từ chối, hoặc
  // giảm xong rồi c bị báo hết chỗ — không bao giờ 3 người trong buổi 2 chỗ.
  const [cut, join] = await Promise.allSettled([
    updateSession(ctx, admin.id, s.id, { capacity: 2 }),
    setAttendance(ctx, s.id, c.id, true),
  ]);
  expect([cut.status, join.status].filter((status) => status === 'fulfilled')).toHaveLength(1);
  expect(await goingCount(s.id)).toBeLessThanOrEqual((await sessionRow(s.id)).capacity);
});

test('only scheduled sessions can be edited', async () => {
  const { ctx, admin } = await setup();
  for (const status of ['cancelled', 'ended'] as const) {
    const s = await insertSession(testDb, { status });
    await expect(updateSession(ctx, admin.id, s.id, { roomCode: 'ABC' })).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
    expect((await sessionRow(s.id)).roomCode).toBeNull();
  }
  await expect(updateSession(ctx, admin.id, 999, { roomCode: 'ABC' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('an edit that changes nothing writes nothing and leaves Discord alone', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id, capacity: 8, roomCode: 'ABC', note: 'Ghi chú' });
  const version = await xminOf(s.id);

  const same = await updateSession(ctx, admin.id, s.id, {
    startsAt: new Date(startsAt),
    capacity: 8,
    roomCode: ' ABC ',
    note: 'Ghi chú',
  });
  expect(same).toEqual(s);
  expect(await updateSession(ctx, admin.id, s.id, {})).toEqual(s);
  expect(await xminOf(s.id)).toBe(version);
  expect(notifier.updated).toHaveLength(0);
});

test('the room code can still be added after the start time', async () => {
  const { ctx, setNow, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  setNow('2026-10-22T14:20:00Z'); // 20 phút sau giờ bắt đầu

  // Form gửi kèm giờ cũ: giờ không đổi nên không bị kiểm "đã qua".
  const v = await updateSession(ctx, admin.id, s.id, { startsAt, roomCode: 'VAO-NGAY' });
  expect(v).toMatchObject({ roomCode: 'VAO-NGAY', startsAt });
  // Đổi sang một giờ đã qua thì vẫn bị chặn.
  await expect(updateSession(ctx, admin.id, s.id, { startsAt: new Date('2026-10-22T14:10:00Z') })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Giờ bắt đầu đã qua',
  });
});

test('editing while Discord is down still saves and leaves the session dirty', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const errors = silenceConsoleError();
  notifier.down = true;

  const v = await updateSession(ctx, admin.id, s.id, { roomCode: 'ABC' });
  expect(v.roomCode).toBe('ABC');
  expect(await sessionRow(s.id)).toMatchObject({ roomCode: 'ABC', discordMessageId: 'msg-1', discordDirty: true });
  expect(errors).toHaveBeenCalledTimes(1);

  notifier.down = false;
  await syncSessionMessage(ctx, s.id);
  expect(notifier.updated.at(-1)?.view).toMatchObject({ roomCode: 'ABC' });
  expect((await sessionRow(s.id)).discordDirty).toBe(false);
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

test('a deleted Discord message is republished with a new id instead of being edited forever', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errors = silenceConsoleError();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  expect((await sessionRow(s.id)).discordMessageId).toBe('msg-1');

  // Ai đó xoá tin trong Discord: sửa tin cũ báo "Unknown Message".
  notifier.goneMessageIds.add('msg-1');
  const m = await createMember(testDb, { displayName: 'An' });
  const v = await setAttendance(ctx, s.id, m.id, true);

  expect(notifier.updated).toHaveLength(0);
  expect(notifier.published).toHaveLength(2);
  expect(notifier.published[1]).toEqual(v);
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-2', discordDirty: false });
  expect(errors).not.toHaveBeenCalled();
  expect(warns).toHaveBeenCalledTimes(1);
  expect(warns.mock.calls[0]?.[0]).toContain('msg-1');
  expect(warns.mock.calls[0]?.[0]).toContain(String(s.id));

  // Từ đây sửa tin mới, không đăng thêm.
  await syncSessionMessage(ctx, s.id);
  expect(notifier.published).toHaveLength(2);
  expect(notifier.updated.map((u) => u.messageId)).toEqual(['msg-2']);
});

test('when the republish after a deleted message fails, the session stays dirty and the retry republishes', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errors = silenceConsoleError();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb);
  await setAttendance(ctx, s.id, m.id, true);
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: false });

  // Không ghi gì giữa chừng (bỏ id cũ cũng là một lần ghi, sẽ che mất dấu "cần sửa lại" của
  // người khác): đăng hỏng thì dòng giữ nguyên id cũ và vẫn bẩn.
  notifier.goneMessageIds.add('msg-1');
  vi.spyOn(notifier, 'publishSession').mockRejectedValueOnce(new Error('Discord lỗi'));
  await setAttendance(ctx, s.id, m.id, false);
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: true });
  expect(errors).toHaveBeenCalledTimes(1);
  expect(warns).toHaveBeenCalledTimes(1);

  // Lần thử lại (bộ hẹn giờ): tin cũ vẫn báo đã mất → đăng tin mới, lưu id, xoá cờ.
  await syncSessionMessage(ctx, s.id);
  expect(notifier.updated).toHaveLength(1);
  expect(notifier.published).toHaveLength(2);
  expect(notifier.published[1]?.attendees).toEqual([]);
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-2', discordDirty: false });
  expect(warns).toHaveBeenCalledTimes(2);
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

test('rapid presses coalesce into at most one queued Discord edit, which shows everyone', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const ms = await Promise.all([...Array(10)].map((_, i) => createMember(testDb, { discordId: `r${i}` })));
  expect(notifier.published).toHaveLength(1);

  // Lần sửa tin đầu tiên treo ở Discord cho tới khi cả 10 người đã bấm xong.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const updateSpy = vi.spyOn(notifier, 'updateSession').mockImplementationOnce(async (messageId, view) => {
    await gate;
    notifier.updated.push({ messageId, view });
  });

  const presses = ms.map((m) => setAttendance(ctx, s.id, m.id, true));
  await vi.waitFor(async () => expect(await goingCount(s.id)).toBe(10));
  await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 50)); // mọi lần bấm kịp xin đồng bộ
  release();
  await Promise.all(presses);

  // Lần đang chạy + đúng một lần chờ dùng chung (đọc trạng thái mới nhất), không phải 10 lần.
  expect(updateSpy.mock.calls.length).toBeLessThanOrEqual(2);
  expect(notifier.published).toHaveLength(1);
  const ids = (view: { attendees: { memberId: number }[] }) => view.attendees.map((a) => a.memberId).sort((x, y) => x - y);
  expect(ids(notifier.updated.at(-1)!.view)).toEqual(ms.map((m) => m.id).sort((x, y) => x - y));
  expect((await sessionRow(s.id)).discordDirty).toBe(false);
});

test('a dirty mark written while a sync is talking to Discord survives that sync', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  silenceConsoleError();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  expect((await sessionRow(s.id)).discordDirty).toBe(false);

  // Trong lúc Discord đang nhận bản sửa, nơi khác (vd rời server → trả chỗ) đánh dấu buổi cần sửa lại.
  const markMidCall = () => testDb.gameSession.updateMany({ where: { id: s.id }, data: { discordDirty: true } });
  vi.spyOn(notifier, 'updateSession').mockImplementationOnce(async (messageId, view) => {
    await markMidCall();
    notifier.updated.push({ messageId, view });
  });
  await syncSessionMessage(ctx, s.id);
  expect(notifier.updated).toHaveLength(1);
  expect((await sessionRow(s.id)).discordDirty).toBe(true);
  // Lượt sau (bộ hẹn giờ) đồng bộ lại; lần này không ai chen vào nên cờ được xoá.
  await syncSessionMessage(ctx, s.id);
  expect(notifier.updated).toHaveLength(2);
  expect((await sessionRow(s.id)).discordDirty).toBe(false);

  // Cũng vậy khi đăng tin mới (buổi chưa có tin).
  notifier.down = true;
  const t = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  notifier.down = false;
  vi.spyOn(notifier, 'publishSession').mockImplementationOnce(async (view) => {
    await testDb.gameSession.updateMany({ where: { id: t.id }, data: { discordDirty: true } });
    notifier.published.push(view);
    return 'msg-mid';
  });
  await syncSessionMessage(ctx, t.id);
  expect(await sessionRow(t.id)).toMatchObject({ discordMessageId: 'msg-mid', discordDirty: true });
});

const xminOf = async (sessionId: number): Promise<string> => {
  const rows = await testDb.$queryRaw<{ x: string }[]>`SELECT xmin::text AS x FROM game_sessions WHERE id = ${sessionId}`;
  return rows[0]?.x ?? '';
};

test('postgres xmin marks every write to a session row: a same-value UPDATE changes it, row locks do not', async () => {
  const s = await insertSession(testDb, { discordDirty: true });
  const m = await createMember(testDb);
  const before = await xminOf(s.id);

  // Khoá dòng — FOR UPDATE (setAttendance, releaseSeats) hay FOR KEY SHARE của khoá ngoại khi
  // chèn dòng điểm danh — không phải một lần ghi: xmin giữ nguyên.
  await testDb.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM game_sessions WHERE id = ${s.id} FOR UPDATE`;
  });
  await testDb.attendance.create({ data: { sessionId: s.id, memberId: m.id, status: 'going' } });
  expect(await xminOf(s.id)).toBe(before);

  // Đánh dấu bẩn một dòng ĐÃ bẩn (giá trị không đổi) vẫn tạo phiên bản dòng mới, mỗi lần một xmin mới.
  await testDb.gameSession.updateMany({ where: { id: s.id }, data: { discordDirty: true } });
  const once = await xminOf(s.id);
  expect(once).not.toBe(before);
  await testDb.gameSession.updateMany({ where: { id: s.id }, data: { discordDirty: true } });
  expect(await xminOf(s.id)).not.toBe(once);
});

/**
 * Giao dịch khác đánh dấu buổi bẩn nhưng CHƯA commit, và chỉ commit khi thấy một câu
 * UPDATE khác đang chờ khoá dòng đó. Trả về khi đã giữ khoá; `committed` xong khi giao dịch
 * commit (bọc trong object: hàm async trả thẳng promise thì sẽ chờ luôn promise đó).
 */
async function markDirtyWhileNextWriteWaits(sessionId: number): Promise<{ committed: Promise<void> }> {
  let locked!: () => void;
  const hasLock = new Promise<void>((resolve) => (locked = resolve));
  const done = testDb.$transaction(
    async (tx) => {
      await tx.gameSession.updateMany({ where: { id: sessionId }, data: { discordDirty: true } });
      locked();
      await vi.waitFor(
        async () => {
          const [row] = await testDb.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query LIKE '%UPDATE game_sessions%'
          `;
          expect(row?.n).toBe(1);
        },
        { timeout: 5_000 },
      );
    },
    { timeout: 10_000 },
  );
  await hasLock;
  return { committed: done };
}

test('a mark committed while the clearing UPDATE waits on the row lock still wins (READ COMMITTED re-check)', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb);

  // Sửa tin: câu xoá cờ có điều kiện bị chặn bởi giao dịch đang ghi dòng; giao dịch đó commit
  // → PostgreSQL xét lại điều kiện trên phiên bản mới nhất (xmin mới) → không xoá.
  let concurrent: Promise<void> = Promise.resolve();
  vi.spyOn(notifier, 'updateSession').mockImplementationOnce(async (messageId, view) => {
    concurrent = (await markDirtyWhileNextWriteWaits(s.id)).committed;
    notifier.updated.push({ messageId, view });
  });
  await setAttendance(ctx, s.id, m.id, true);
  await concurrent;
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: true });

  // Đăng tin mới: câu lưu id + xoá cờ cũng vậy — id được lưu, cờ giữ nguyên.
  notifier.down = true;
  silenceConsoleError();
  const t = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  notifier.down = false;
  vi.spyOn(notifier, 'publishSession').mockImplementationOnce(async (view) => {
    concurrent = (await markDirtyWhileNextWriteWaits(t.id)).committed;
    notifier.published.push(view);
    return 'msg-locked';
  });
  await syncSessionMessage(ctx, t.id);
  await concurrent;
  expect(await sessionRow(t.id)).toMatchObject({ discordMessageId: 'msg-locked', discordDirty: true });
});

test('the session stays dirty while Discord is being edited or published to, and is cleared only after', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  silenceConsoleError();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb, { displayName: 'An' });

  // Tiến trình chết (OOM, SIGKILL, exit khi phiên Discord bị vô hiệu) giữa lúc gọi Discord:
  // dòng lúc đó phải còn bẩn để bộ hẹn giờ của lần chạy sau sửa bù.
  const seen: { dirty: boolean; messageId: string | null }[] = [];
  const look = async (id: number) => {
    const row = await sessionRow(id);
    seen.push({ dirty: row.discordDirty, messageId: row.discordMessageId });
  };
  vi.spyOn(notifier, 'updateSession').mockImplementationOnce(async (messageId, view) => {
    await look(s.id);
    notifier.updated.push({ messageId, view });
  });
  await setAttendance(ctx, s.id, m.id, true);
  expect(seen).toEqual([{ dirty: true, messageId: 'msg-1' }]);
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: false });

  // Đăng tin mới (buổi tạo lúc Discord sập) cũng vậy.
  notifier.down = true;
  const t = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  notifier.down = false;
  vi.spyOn(notifier, 'publishSession').mockImplementationOnce(async (view) => {
    await look(t.id);
    notifier.published.push(view);
    return 'msg-new';
  });
  await syncSessionMessage(ctx, t.id);
  expect(seen[1]).toEqual({ dirty: true, messageId: null });
  expect(await sessionRow(t.id)).toMatchObject({ discordMessageId: 'msg-new', discordDirty: false });
});

test('a Discord call that throws leaves the session dirty, even when the database drops right after', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const errors = silenceConsoleError();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb);

  // Discord lỗi và DB mất kết nối ngay sau đó: không còn bật lại cờ được — nó phải chưa từng bị xoá.
  let restore = (): void => {};
  vi.spyOn(notifier, 'updateSession').mockImplementationOnce(async () => {
    restore = patchDelegate(testDb.gameSession, 'updateMany', () => (() => Promise.reject(new Error('mất kết nối'))) as never);
    throw new Error('Discord lỗi');
  });
  try {
    await setAttendance(ctx, s.id, m.id, true);
  } finally {
    restore();
  }
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: true });
  expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([
    expect.stringContaining(`buổi ${s.id}`),
    expect.stringContaining('mất kết nối'),
  ]);

  // Lượt sau sửa bù rồi mới xoá cờ.
  await syncSessionMessage(ctx, s.id);
  expect(notifier.updated.at(-1)?.view.attendees).toEqual([{ memberId: m.id, displayName: m.displayName }]);
  expect((await sessionRow(s.id)).discordDirty).toBe(false);
});

test('a seat freed by someone leaving the server during the Discord edit is not lost', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const an = await createMember(testDb, { discordId: 'an', displayName: 'An' });
  const binh = await createMember(testDb, { discordId: 'binh', displayName: 'Bình' });
  await setAttendance(ctx, s.id, an.id, true);

  // Bình bấm tham gia; đúng lúc Discord đang nhận bản (An, Bình) thì An rời server → trả chỗ.
  vi.spyOn(notifier, 'updateSession').mockImplementationOnce(async (messageId, view) => {
    await markMemberLeft(ctx, 'an');
    notifier.updated.push({ messageId, view });
  });
  await setAttendance(ctx, s.id, binh.id, true);
  const names = () => notifier.updated.at(-1)?.view.attendees.map((a) => a.displayName);
  expect(names()).toEqual(['An', 'Bình']);
  // Bản vừa gửi đã cũ: dòng vẫn bẩn, lượt sau sửa thành chỉ còn Bình rồi mới xoá cờ.
  expect((await sessionRow(s.id)).discordDirty).toBe(true);
  await syncSessionMessage(ctx, s.id);
  expect(names()).toEqual(['Bình']);
  expect((await sessionRow(s.id)).discordDirty).toBe(false);
});

test('a deleted message is republished with the session still dirty, and a mark during the republish survives', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb);

  notifier.goneMessageIds.add('msg-1');
  let seen: { dirty: boolean; messageId: string | null } | undefined;
  vi.spyOn(notifier, 'publishSession').mockImplementationOnce(async (view) => {
    const row = await sessionRow(s.id);
    seen = { dirty: row.discordDirty, messageId: row.discordMessageId };
    await testDb.gameSession.updateMany({ where: { id: s.id }, data: { discordDirty: true } }); // ai đó đánh dấu chen vào
    notifier.published.push(view);
    return 'msg-2';
  });
  await setAttendance(ctx, s.id, m.id, true);
  // Trong lúc đăng lại: id cũ còn nguyên (chưa ghi gì), dòng còn bẩn.
  expect(seen).toEqual({ dirty: true, messageId: 'msg-1' });
  // Id mới được lưu; dấu chen vào giữ cờ bẩn.
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-2', discordDirty: true });

  await syncSessionMessage(ctx, s.id);
  expect(notifier.updated.map((u) => u.messageId)).toEqual(['msg-2']);
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-2', discordDirty: false });
});

test('creating and changing attendance save the session dirty, so a crash before the Discord sync is retried', async () => {
  const { ctx, admin, classic } = await setup();
  silenceConsoleError();
  const m = await createMember(testDb, { displayName: 'An' });
  const existing = await insertSession(testDb, { discordMessageId: 'msg-old' });
  expect(existing.discordDirty).toBe(false);

  // Mất kết nối DB ngay sau khi lưu xong (như tiến trình chết trước khi kịp đồng bộ Discord):
  // mọi bước đồng bộ sau đó đều hỏng, cờ phải đã nằm sẵn trong dòng vừa lưu.
  const lost = () => (() => Promise.reject(new Error('mất kết nối'))) as never;
  const restoreFind = patchDelegate(testDb.gameSession, 'findUnique', lost);
  const restoreUpdate = patchDelegate(testDb.gameSession, 'updateMany', lost);
  try {
    await expect(createSession(ctx, admin.id, { startsAt, modeId: classic.id })).rejects.toThrow('mất kết nối');
    await expect(setAttendance(ctx, existing.id, m.id, true)).rejects.toThrow('mất kết nối');
  } finally {
    restoreFind();
    restoreUpdate();
  }

  const rows = await testDb.gameSession.findMany({ orderBy: { id: 'asc' }, select: { id: true, discordDirty: true } });
  expect(rows).toEqual([
    { id: existing.id, discordDirty: true },
    { id: existing.id + 1, discordDirty: true },
  ]);
  expect(await goingCount(existing.id)).toBe(1);
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

test('cancelling saves the session dirty in the same update, so a crash before the Discord sync is retried', async () => {
  const { ctx } = await setup();
  const s = await insertSession(testDb, { discordMessageId: 'msg-old' });

  // Mất kết nối ngay sau khi đổi trạng thái: không đọc lại được buổi, không đồng bộ được gì.
  const restore = patchDelegate(testDb.gameSession, 'findUnique', () => (() => Promise.reject(new Error('mất kết nối'))) as never);
  try {
    await expect(cancelSession(ctx, s.id)).rejects.toThrow('mất kết nối');
  } finally {
    restore();
  }
  expect(await sessionRow(s.id)).toMatchObject({ status: 'cancelled', discordDirty: true });
});
