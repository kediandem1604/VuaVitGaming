import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { buildReminder } from '../../src/server/modules/reminders/messages.js';
import { reminderKindsDue, runReminders } from '../../src/server/modules/reminders/service.js';
import { cancelSession, updateSession } from '../../src/server/modules/sessions/service.js';
import { updateSettings } from '../../src/server/modules/settings/service.js';
import type { SessionView } from '../../src/server/ports.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession } from '../helpers/factories.js';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

/** Giờ bắt đầu mặc định của buổi: 21:00 ngày 22/10/2026 giờ VN. */
const start = new Date('2026-10-22T14:00:00Z');
/** Mốc `minutes` phút so với giờ bắt đầu (âm = trước giờ). */
const at = (minutes: number): Date => new Date(start.getTime() + minutes * 60_000);
const atIso = (minutes: number): string => at(minutes).toISOString();

const url = 'http://localhost:3000';
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

/** Điểm danh `going`, giờ tham gia `joinedAt` (mặc định 2 tiếng trước giờ bắt đầu). */
async function join(sessionId: number, memberId: number, joinedAt: Date = at(-120)): Promise<void> {
  await testDb.attendance.create({ data: { sessionId, memberId, status: 'going', updatedAt: joinedAt } });
}

/** Mọi dòng notification_log, xếp theo (member, loại, kênh) để so sánh ổn định. */
async function logRows() {
  const rows = await testDb.notificationLog.findMany();
  return rows.sort(
    (a, b) => a.memberId - b.memberId || a.kind.localeCompare(b.kind) || a.channel.localeCompare(b.channel),
  );
}

// ---------------------------------------------------------------------------
// reminderKindsDue
// ---------------------------------------------------------------------------

test.each([
  ['-16', []],
  ['-15', ['pre15']],
  ['-1', ['pre15']],
  ['0', ['start']],
  ['9', ['start']],
  ['10', []],
])('kinds due at start%s min', (offset, expected) => {
  expect(reminderKindsDue(start, at(Number(offset)), 15)).toEqual(expected);
});

test('kinds due follow the configured lead and are half-open to the second', () => {
  expect(reminderKindsDue(start, at(-31), 30)).toEqual([]);
  expect(reminderKindsDue(start, at(-30), 30)).toEqual(['pre15']);
  expect(reminderKindsDue(start, at(-16), 30)).toEqual(['pre15']);
  expect(reminderKindsDue(start, new Date(start.getTime() - 1), 15)).toEqual(['pre15']);
  expect(reminderKindsDue(start, new Date(at(10).getTime() - 1), 15)).toEqual(['start']);
});

// ---------------------------------------------------------------------------
// buildReminder
// ---------------------------------------------------------------------------

const view: SessionView = {
  id: 7,
  startsAt: start,
  modeName: 'Cổ điển (Classic)',
  capacity: 16,
  roomCode: null,
  note: null,
  status: 'scheduled',
  attendees: [],
};

test('pre15 message uses the real lead and VN time', () => {
  expect(buildReminder('pre15', view, 15, url)).toEqual({
    subject: '[GGD] Còn 15 phút: buổi Cổ điển (Classic) lúc 21:00',
    text: 'Còn 15 phút nữa là tới buổi chơi Cổ điển (Classic) lúc 21:00. Chuẩn bị vào game nhé!\nhttp://localhost:3000',
  });
  expect(buildReminder('pre15', view, 30, url)).toEqual({
    subject: '[GGD] Còn 30 phút: buổi Cổ điển (Classic) lúc 21:00',
    text: 'Còn 30 phút nữa là tới buổi chơi Cổ điển (Classic) lúc 21:00. Chuẩn bị vào game nhé!\nhttp://localhost:3000',
  });
});

test('start message carries room code', () => {
  expect(buildReminder('start', { ...view, roomCode: 'ABCD' }, 15, url).text).toContain('Mã phòng: ABCD');
  expect(buildReminder('start', { ...view, roomCode: 'ABCD' }, 15, url)).toEqual({
    subject: '[GGD] Vào game thôi! Buổi Cổ điển (Classic) 21:00',
    text: 'Buổi chơi Cổ điển (Classic) bắt đầu rồi, vào game thôi! 🦆\nMã phòng: ABCD\nhttp://localhost:3000',
  });
  // Không có mã phòng → không có dòng "Mã phòng".
  expect(buildReminder('start', view, 15, url).text).toBe(
    'Buổi chơi Cổ điển (Classic) bắt đầu rồi, vào game thôi! 🦆\nhttp://localhost:3000',
  );
});

// ---------------------------------------------------------------------------
// runReminders
// ---------------------------------------------------------------------------

test('running twice sends once', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  const m = await createMember(testDb, { email: 'an@example.com' });
  const s = await createSession(testDb, { roomCode: 'ABCD' });
  await join(s.id, m.id);

  setNow(atIso(-15));
  expect(await runReminders(ctx)).toEqual({ sent: 2, failed: 0 });
  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });
  // Phút kế tiếp của bộ hẹn giờ: vẫn trong cửa sổ pre15, vẫn không gửi lại.
  setNow(atIso(-14));
  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });

  expect(mailer.sent).toEqual([
    {
      to: 'an@example.com',
      subject: '[GGD] Còn 15 phút: buổi Cổ điển (Classic) lúc 21:00',
      text: 'Còn 15 phút nữa là tới buổi chơi Cổ điển (Classic) lúc 21:00. Chuẩn bị vào game nhé!\nhttp://localhost:3000',
    },
  ]);
  expect(notifier.dms).toEqual([{ discordId: m.discordId, text: mailer.sent[0]?.text }]);
  // sentAt lấy từ đồng hồ của ctx, không phải đồng hồ thật.
  expect(await logRows()).toEqual([
    { sessionId: s.id, memberId: m.id, kind: 'pre15', channel: 'dm', sentAt: at(-15), error: null },
    { sessionId: s.id, memberId: m.id, kind: 'pre15', channel: 'email', sentAt: at(-15), error: null },
  ]);

  // Đúng giờ bắt đầu: nhắc `start` kèm mã phòng, mỗi kênh một lần.
  setNow(atIso(0));
  expect(await runReminders(ctx)).toEqual({ sent: 2, failed: 0 });
  setNow(atIso(1));
  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });

  expect(mailer.sent).toHaveLength(2);
  expect(mailer.sent[1]).toEqual({
    to: 'an@example.com',
    subject: '[GGD] Vào game thôi! Buổi Cổ điển (Classic) 21:00',
    text: 'Buổi chơi Cổ điển (Classic) bắt đầu rồi, vào game thôi! 🦆\nMã phòng: ABCD\nhttp://localhost:3000',
  });
  expect(notifier.dms).toHaveLength(2);
  expect(notifier.dms[1]).toEqual({ discordId: m.discordId, text: mailer.sent[1]?.text });
  expect((await logRows()).map((r) => [r.kind, r.channel, r.sentAt])).toEqual([
    ['pre15', 'dm', at(-15)],
    ['pre15', 'email', at(-15)],
    ['start', 'dm', at(0)],
    ['start', 'email', at(0)],
  ]);
});

test('late joiner skips pre15', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  const late = await createMember(testDb, { email: 'late@example.com' });
  const onTime = await createMember(testDb, { email: 'ontime@example.com' });
  const s = await createSession(testDb);
  await join(s.id, late.id, at(-10));
  await join(s.id, onTime.id, at(-15)); // đúng mốc startsAt − lead: vẫn được nhắc

  setNow(atIso(-5));
  expect(await runReminders(ctx)).toEqual({ sent: 2, failed: 0 });
  expect(mailer.sent.map((x) => x.to)).toEqual(['ontime@example.com']);
  expect(notifier.dms.map((d) => d.discordId)).toEqual([onTime.discordId]);
  expect(await testDb.notificationLog.count({ where: { memberId: late.id } })).toBe(0);

  setNow(atIso(0));
  expect(await runReminders(ctx)).toEqual({ sent: 4, failed: 0 });
  const lateRows = (await logRows()).filter((r) => r.memberId === late.id);
  expect(lateRows.map((r) => r.kind)).toEqual(['start', 'start']);
  expect(await testDb.notificationLog.count()).toBe(6);
});

test('member without email only gets DM', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  const m = await createMember(testDb, { email: null, notifyEmail: true });
  const s = await createSession(testDb);
  await join(s.id, m.id);
  setNow(atIso(-15));

  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  expect(mailer.sent).toHaveLength(0);
  expect(await testDb.notificationLog.count({ where: { channel: 'email' } })).toBe(0);
  expect(notifier.dms).toHaveLength(1);
  expect(await logRows()).toEqual([
    { sessionId: s.id, memberId: m.id, kind: 'pre15', channel: 'dm', sentAt: at(-15), error: null },
  ]);
});

test('blank email counts as no email', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  const m = await createMember(testDb, { email: '', notifyEmail: true });
  const s = await createSession(testDb);
  await join(s.id, m.id);
  setNow(atIso(-15));

  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  expect(mailer.sent).toHaveLength(0);
  expect(notifier.dms).toHaveLength(1);
  expect((await logRows()).map((r) => r.channel)).toEqual(['dm']);
});

test('channel switches respected', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  const emailOnly = await createMember(testDb, { email: 'a@example.com', notifyDm: false });
  const dmOnly = await createMember(testDb, { email: 'b@example.com', notifyEmail: false });
  const muted = await createMember(testDb, { email: 'c@example.com', notifyEmail: false, notifyDm: false });
  const s = await createSession(testDb);
  for (const m of [emailOnly, dmOnly, muted]) await join(s.id, m.id);
  setNow(atIso(-15));

  expect(await runReminders(ctx)).toEqual({ sent: 2, failed: 0 });
  expect(mailer.sent.map((x) => x.to)).toEqual(['a@example.com']);
  expect(notifier.dms.map((d) => d.discordId)).toEqual([dmOnly.discordId]);
  // Kênh tắt không có dòng log nào (kể cả người tắt cả hai kênh).
  expect((await logRows()).map((r) => [r.memberId, r.channel])).toEqual([
    [emailOnly.id, 'email'],
    [dmOnly.id, 'dm'],
  ]);
});

test('one failure does not block others', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  const errors = silenceConsoleError();
  const a = await createMember(testDb, { email: 'a@example.com' });
  const b = await createMember(testDb, { email: 'b@example.com' });
  const s = await createSession(testDb);
  await join(s.id, a.id);
  await join(s.id, b.id);
  notifier.failDmFor.add(a.discordId);
  setNow(atIso(-15));

  const result = await runReminders(ctx);
  expect(result).toEqual({ sent: 3, failed: 1 });
  expect(mailer.sent.map((x) => x.to)).toEqual(['a@example.com', 'b@example.com']);
  expect(notifier.dms.map((d) => d.discordId)).toEqual([b.discordId]);
  expect(errors).toHaveBeenCalledTimes(1);

  const rows = await logRows();
  expect(rows).toHaveLength(4);
  const failedRow = rows.find((r) => r.memberId === a.id && r.channel === 'dm');
  expect(failedRow?.error).toContain('FakeNotifier');
  expect(rows.filter((r) => r !== failedRow).map((r) => r.error)).toEqual([null, null, null]);

  // Lần chạy sau không gửi lại DM đã lỗi: dòng log đã có, kể cả khi Discord đã ổn.
  notifier.failDmFor.clear();
  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });
  expect(notifier.dms).toHaveLength(1);
  expect(mailer.sent).toHaveLength(2);
});

test('Discord down fails every DM but emails still go', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  silenceConsoleError();
  const a = await createMember(testDb, { email: 'a@example.com' });
  const b = await createMember(testDb, { email: 'b@example.com' });
  const s = await createSession(testDb);
  await join(s.id, a.id);
  await join(s.id, b.id);
  notifier.down = true;
  setNow(atIso(0));

  expect(await runReminders(ctx)).toEqual({ sent: 2, failed: 2 });
  expect(mailer.sent.map((x) => x.to)).toEqual(['a@example.com', 'b@example.com']);
  expect(notifier.dms).toHaveLength(0);
  const rows = await logRows();
  expect(rows.filter((r) => r.channel === 'dm').map((r) => r.error)).toEqual([
    'FakeNotifier: Discord đang sập',
    'FakeNotifier: Discord đang sập',
  ]);
  expect(rows.filter((r) => r.channel === 'email').map((r) => r.error)).toEqual([null, null]);
});

test('send error is stored truncated to 500 characters', async () => {
  const { ctx, mailer, setNow } = makeTestCtx();
  silenceConsoleError();
  const m = await createMember(testDb, { email: 'a@example.com', notifyDm: false });
  const s = await createSession(testDb);
  await join(s.id, m.id);
  vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('x'.repeat(600)));
  setNow(atIso(-15));

  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 1 });
  expect((await logRows()).map((r) => r.error)).toEqual(['x'.repeat(500)]);
});

test('catch-up after restart sends start only', async () => {
  const { ctx, mailer, setNow } = makeTestCtx();
  const m = await createMember(testDb, { email: 'a@example.com' });
  const s = await createSession(testDb);
  await join(s.id, m.id);

  // Bộ hẹn giờ nằm im suốt cửa sổ pre15, dậy lúc start+5: chỉ gửi `start`.
  setNow(atIso(5));
  expect(await runReminders(ctx)).toEqual({ sent: 2, failed: 0 });
  expect((await logRows()).map((r) => r.kind)).toEqual(['start', 'start']);
  expect(mailer.sent.map((x) => x.subject)).toEqual(['[GGD] Vào game thôi! Buổi Cổ điển (Classic) 21:00']);
});

test('more than 10 minutes after start sends nothing', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  const m = await createMember(testDb, { email: 'a@example.com' });
  const s = await createSession(testDb);
  await join(s.id, m.id);

  setNow(atIso(10));
  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });
  expect(mailer.sent).toHaveLength(0);
  expect(notifier.dms).toHaveLength(0);
  expect(await testDb.notificationLog.count()).toBe(0);
});

test('cancelled session sends nothing', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  const m = await createMember(testDb, { email: 'a@example.com' });
  const cancelled = await createSession(testDb, { status: 'cancelled' });
  const ended = await createSession(testDb, { status: 'ended', endedAt: at(-30) });
  await join(cancelled.id, m.id);
  await join(ended.id, m.id);

  for (const minutes of [-15, 0]) {
    setNow(atIso(minutes));
    expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });
  }
  expect(mailer.sent).toHaveLength(0);
  expect(notifier.dms).toHaveLength(0);
  expect(await testDb.notificationLog.count()).toBe(0);
});

test('members who left the server or left the session get nothing', async () => {
  const { ctx, mailer, notifier, setNow } = makeTestCtx();
  const gone = await createMember(testDb, { email: 'gone@example.com', status: 'left', leftAt: at(-60) });
  const quit = await createMember(testDb, { email: 'quit@example.com' });
  const s = await createSession(testDb);
  await join(s.id, gone.id);
  await testDb.attendance.create({ data: { sessionId: s.id, memberId: quit.id, status: 'cancelled', updatedAt: at(-120) } });

  setNow(atIso(-15));
  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });
  expect(mailer.sent).toHaveLength(0);
  expect(notifier.dms).toHaveLength(0);
  expect(await testDb.notificationLog.count()).toBe(0);
});

test('reminder lead comes from settings', async () => {
  const { ctx, mailer, setNow } = makeTestCtx();
  await updateSettings(ctx, { reminderLeadMinutes: 30 });
  const early = await createMember(testDb, { email: 'early@example.com', notifyDm: false });
  const late = await createMember(testDb, { email: 'late@example.com', notifyDm: false });
  const s = await createSession(testDb);
  await join(s.id, early.id, at(-120));
  await join(s.id, late.id, at(-25)); // sau mốc start − 30 → lỡ pre15

  setNow(atIso(-31));
  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });

  setNow(atIso(-30));
  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  expect(mailer.sent).toEqual([
    {
      to: 'early@example.com',
      subject: '[GGD] Còn 30 phút: buổi Cổ điển (Classic) lúc 21:00',
      text: 'Còn 30 phút nữa là tới buổi chơi Cổ điển (Classic) lúc 21:00. Chuẩn bị vào game nhé!\nhttp://localhost:3000',
    },
  ]);
  // Loại nhắc trong log vẫn là `pre15` dù lead là 30 phút.
  expect((await logRows()).map((r) => [r.memberId, r.kind])).toEqual([[early.id, 'pre15']]);

  // Mốc −15 (cửa sổ mặc định) không còn ý nghĩa khi lead = 30.
  setNow(atIso(-15));
  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });
});

test('several sessions are handled in one run', async () => {
  const { ctx, mailer, setNow } = makeTestCtx();
  const m = await createMember(testDb, { email: 'a@example.com', notifyDm: false });
  const starting = await createSession(testDb); // đúng giờ → start
  const soon = await createSession(testDb, { startsAt: at(15), modeKey: 'goose_hunt' }); // còn 15 phút → pre15
  const later = await createSession(testDb, { startsAt: at(16) }); // chưa tới cửa sổ
  const past = await createSession(testDb, { startsAt: at(-10) }); // quá 10 phút
  const empty = await createSession(testDb, { startsAt: at(0) }); // không ai tham gia
  for (const s of [starting, soon, later, past]) await join(s.id, m.id);

  setNow(atIso(0));
  expect(await runReminders(ctx)).toEqual({ sent: 2, failed: 0 });
  // Buổi gần giờ hơn được gửi trước.
  expect(mailer.sent.map((x) => x.subject)).toEqual([
    '[GGD] Vào game thôi! Buổi Cổ điển (Classic) 21:00',
    '[GGD] Còn 15 phút: buổi Săn ngỗng (Goose Hunt) lúc 21:15',
  ]);
  expect((await logRows()).map((r) => [r.sessionId, r.kind])).toEqual([
    [soon.id, 'pre15'],
    [starting.id, 'start'],
  ]);
  expect(await testDb.notificationLog.count({ where: { sessionId: { in: [later.id, past.id, empty.id] } } })).toBe(0);
});

// ---------------------------------------------------------------------------
// Admin đổi giờ / huỷ buổi giữa chừng
// ---------------------------------------------------------------------------

const pre15Text = (time: string) =>
  `Còn 15 phút nữa là tới buổi chơi Cổ điển (Classic) lúc ${time}. Chuẩn bị vào game nhé!\nhttp://localhost:3000`;
const startText = 'Buổi chơi Cổ điển (Classic) bắt đầu rồi, vào game thôi! 🦆\nhttp://localhost:3000';

/** Admin (không nhận nhắc) và một buổi 21:00 có `members` người nhận DM, tham gia từ sớm. */
async function sessionWithDmMembers(members: number) {
  const admin = await createMember(testDb, { accessLevel: 'admin', notifyDm: false });
  const s = await createSession(testDb);
  const going = [];
  for (let i = 0; i < members; i += 1) {
    const m = await createMember(testDb);
    await join(s.id, m.id, at(-120 + i));
    going.push(m);
  }
  return { admin, s, going };
}

test('moving a session later re-sends the reminder already sent for the old time', async () => {
  const { ctx, notifier, setNow } = makeTestCtx();
  const { admin, s } = await sessionWithDmMembers(1);

  setNow(atIso(-15));
  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });

  // 20:50: dời sang 22:00 → log pre15 của giờ cũ bị xoá để nhắc lại theo giờ mới.
  setNow(atIso(-10));
  await updateSession(ctx, admin.id, s.id, { startsAt: at(60) });
  expect(await logRows()).toEqual([]);
  for (const minutes of [-10, 0, 5]) {
    // Giờ cũ trôi qua: không nhắc gì theo giờ cũ.
    setNow(atIso(minutes));
    expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });
  }

  setNow(atIso(45));
  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  setNow(atIso(60));
  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  expect(notifier.dms.map((d) => d.text)).toEqual([pre15Text('21:00'), pre15Text('22:00'), startText]);
});

test('moving a session within the reminder window it is already in does not remind twice', async () => {
  const { ctx, notifier, setNow } = makeTestCtx();
  const { admin, s } = await sessionWithDmMembers(1);

  setNow(atIso(-15));
  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });

  // 20:50, dời sang 21:05: cửa sổ pre15 của giờ mới [20:50, 21:05) đã mở → giữ log, không nhắc lại.
  setNow(atIso(-10));
  await updateSession(ctx, admin.id, s.id, { startsAt: at(5) });
  expect((await logRows()).map((r) => r.kind)).toEqual(['pre15']);
  setNow(atIso(0));
  expect(await runReminders(ctx)).toEqual({ sent: 0, failed: 0 });

  setNow(atIso(5));
  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  expect(notifier.dms.map((d) => d.text)).toEqual([pre15Text('21:00'), startText]);
});

test('delaying a session that has already started re-sends both reminders for the new time', async () => {
  const { ctx, notifier, setNow } = makeTestCtx();
  const { admin, s } = await sessionWithDmMembers(1);

  for (const minutes of [-15, 0]) {
    setNow(atIso(minutes));
    expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  }

  // 21:02: chờ thêm người, dời sang 21:30 → cả pre15 lẫn start đều chưa tới hạn theo giờ mới.
  setNow(atIso(2));
  await updateSession(ctx, admin.id, s.id, { startsAt: at(30) });
  expect(await logRows()).toEqual([]);

  for (const minutes of [15, 30]) {
    setNow(atIso(minutes));
    expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  }
  expect(notifier.dms.map((d) => d.text)).toEqual([pre15Text('21:00'), startText, pre15Text('21:30'), startText]);
});

test('a run that read the old start time reminds no one else once the time has changed', async () => {
  const { ctx, notifier, setNow } = makeTestCtx();
  const { admin, s, going } = await sessionWithDmMembers(2);
  const [first, second] = going.map((m) => m.discordId);
  setNow(atIso(-15));

  // Admin dời buổi sang 22:00 đúng lúc lần chạy đang gửi DM cho người đầu tiên.
  vi.spyOn(notifier, 'sendDm').mockImplementationOnce(async (discordId, text) => {
    await updateSession(ctx, admin.id, s.id, { startsAt: at(60) });
    notifier.dms.push({ discordId, text });
  });
  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  expect(notifier.dms.map((d) => d.discordId)).toEqual([first]);
  // Người thứ hai không bị ghi log theo giờ cũ (log đó sẽ chặn mất nhắc theo giờ mới);
  // log của người đầu đã bị lần đổi giờ xoá.
  expect(await logRows()).toEqual([]);

  setNow(atIso(45));
  expect(await runReminders(ctx)).toEqual({ sent: 2, failed: 0 });
  expect(notifier.dms.slice(1)).toEqual([
    { discordId: first, text: pre15Text('22:00') },
    { discordId: second, text: pre15Text('22:00') },
  ]);
});

test('a session cancelled while a run is sending gets no further reminders', async () => {
  const { ctx, notifier, setNow } = makeTestCtx();
  const { s, going } = await sessionWithDmMembers(2);
  const [first, second] = going.map((m) => m.discordId);
  setNow(atIso(-15));

  vi.spyOn(notifier, 'sendDm').mockImplementationOnce(async (discordId, text) => {
    await cancelSession(ctx, s.id); // DM báo huỷ cho cả hai qua sendDm thật
    notifier.dms.push({ discordId, text });
  });
  expect(await runReminders(ctx)).toEqual({ sent: 1, failed: 0 });
  expect(notifier.dms.map((d) => [d.discordId, d.text.startsWith('Còn 15 phút')])).toEqual([
    [first, false],
    [second, false],
    [first, true],
  ]);
  expect((await logRows()).map((r) => r.memberId)).toEqual([going[0]?.id]);
});

test('a reminder waiting on an edit that holds the session row re-checks the start time once it commits', async () => {
  const { ctx, notifier, setNow } = makeTestCtx();
  const { s } = await sessionWithDmMembers(1);
  setNow(atIso(-15));

  // Giao dịch đổi giờ (như updateSession: khoá dòng rồi ghi) chỉ commit khi thấy câu ghi log
  // của bộ nhắc đang chờ khoá dòng buổi. Câu đó phải xét lại điều kiện trên bản mới → không chèn.
  let locked!: () => void;
  const hasLock = new Promise<void>((resolve) => (locked = resolve));
  const edit = testDb.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM game_sessions WHERE id = ${s.id} FOR UPDATE`;
      await tx.gameSession.update({ where: { id: s.id }, data: { startsAt: at(60), discordDirty: true } });
      locked();
      await vi.waitFor(
        async () => {
          const [row] = await testDb.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query LIKE '%INSERT INTO notification_log%'
          `;
          expect(row?.n).toBe(1);
        },
        { timeout: 5_000 },
      );
    },
    { timeout: 10_000 },
  );
  await hasLock;

  const run = runReminders(ctx);
  await edit;
  expect(await run).toEqual({ sent: 0, failed: 0 });
  expect(notifier.dms).toEqual([]);
  expect(await logRows()).toEqual([]);
});
