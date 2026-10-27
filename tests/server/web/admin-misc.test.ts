import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import type {
  AdminMemberDto,
  NotificationFailureDto,
  OpenVoteRoundDto,
  SettingsDto,
} from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, createSession } from '../../helpers/factories.js';

/** Không route nào ở đây đụng tới OAuth. */
const oauth: OAuthClient = {
  authorizeUrl: () => 'https://discord.test/authorize',
  exchange: async () => {
    throw new Error('không dùng');
  },
};

let ctx: Ctx;
let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  ({ ctx } = makeTestCtx());
  app = await buildApp(ctx, { oauth });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

/** Cookie phiên (đã ký) của một thành viên — không qua OAuth. */
async function sidFor(member: Member): Promise<string> {
  const session = await createWebSession(ctx, member.id);
  return app.signCookie(session.id);
}

const memberWithSid = async (p: Parameters<typeof createMember>[1] = {}) => {
  const member = await createMember(testDb, p);
  return { member, sid: await sidFor(member) };
};

const cookies = (sid?: string) => (sid ? { ggd_sid: sid } : {});

const get = (url: string, sid?: string) => app.inject({ url, cookies: cookies(sid) });

const patch = (url: string, sid: string | undefined, payload?: unknown) =>
  app.inject({
    method: 'PATCH',
    url,
    cookies: cookies(sid),
    headers: { 'content-type': 'application/json' },
    payload: payload === undefined ? '' : JSON.stringify(payload),
  });

const put = (url: string, sid: string | undefined, payload?: unknown) =>
  app.inject({
    method: 'PUT',
    url,
    cookies: cookies(sid),
    headers: { 'content-type': 'application/json' },
    payload: payload === undefined ? '' : JSON.stringify(payload),
  });

const errorBody = (code: string, message: string) => ({ error: { code, message } });
const FORBIDDEN = errorBody('FORBIDDEN', 'Bạn không có quyền làm việc này');
const INVALID = errorBody('VALIDATION', 'Dữ liệu không hợp lệ');

// ---------------------------------------------------------------------------
// Thành viên
// ---------------------------------------------------------------------------

test('member search', async () => {
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod', displayName: 'Mod Một' });
  const ke = await createMember(testDb, { displayName: 'Kẹ', email: 'ke@example.com' });
  await createMember(testDb, { displayName: 'Ngỗng Ba' });
  const gone = await createMember(testDb, { displayName: 'Kẹ Rời', status: 'left', leftAt: new Date() });

  // q='kẹ' tìm thấy 'Kẹ' (và 'Kẹ Rời' vì không lọc trạng thái).
  const res = await get('/api/admin/members?q=k%E1%BA%B9', modSid);
  expect(res.statusCode).toBe(200);
  const found = res.json<AdminMemberDto[]>();
  expect(found.map((m) => m.displayName)).toEqual(['Kẹ', 'Kẹ Rời']);
  expect(found[0]).toEqual({
    id: ke.id,
    memberCode: ke.memberCode,
    displayName: 'Kẹ',
    accessLevel: 'member',
    status: 'active',
    email: null, // mod không thấy email
    joinedAt: ke.joinedAt.toISOString(),
    serverJoinedAt: ke.joinedAt.toISOString(),
    daysInServer: 0,
    games: 0,
    gamesAdjustment: 0,
  });

  // Lọc trạng thái; kết hợp với q.
  const left = (await get('/api/admin/members?status=left', modSid)).json<AdminMemberDto[]>();
  expect(left.map((m) => m.id)).toEqual([gone.id]);
  expect(left[0]?.status).toBe('left');
  const activeKe = (await get('/api/admin/members?q=K%E1%BA%B9&status=active', modSid)).json<AdminMemberDto[]>();
  expect(activeKe.map((m) => m.displayName)).toEqual(['Kẹ']);

  // Không tham số: mọi người theo mã tăng dần.
  const all = (await get('/api/admin/members', modSid)).json<AdminMemberDto[]>();
  expect(all.map((m) => m.displayName)).toEqual(['Mod Một', 'Kẹ', 'Ngỗng Ba', 'Kẹ Rời']);

  // Trạng thái lạ → 400; thành viên thường → 403; chưa đăng nhập → 401.
  const bad = await get('/api/admin/members?status=banned', modSid);
  expect(bad.statusCode).toBe(400);
  expect(bad.json()).toEqual(INVALID);
  const { sid: memberSid } = await memberWithSid();
  const forbidden = await get('/api/admin/members', memberSid);
  expect(forbidden.statusCode).toBe(403);
  expect(forbidden.json()).toEqual(FORBIDDEN);
  expect((await get('/api/admin/members')).statusCode).toBe(401);
});

test('mods do not see emails', async () => {
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin', email: 'admin@example.com' });
  await createMember(testDb, { displayName: 'Có Email', email: 'co@example.com' });
  await createMember(testDb, { displayName: 'Không Email' });

  const asMod = (await get('/api/admin/members', modSid)).json<AdminMemberDto[]>();
  expect(asMod).toHaveLength(4);
  for (const m of asMod) expect(m.email).toBeNull();

  const asAdmin = (await get('/api/admin/members', adminSid)).json<AdminMemberDto[]>();
  expect(asAdmin.map((m) => m.email)).toEqual([null, 'admin@example.com', 'co@example.com', null]);
});

/** Một buổi đã kết thúc (hoặc `status` khác) mà `memberIds` đều điểm danh `going`. */
async function endedSession(memberIds: number[], status: 'ended' | 'scheduled' | 'cancelled' = 'ended'): Promise<number> {
  const s = await createSession(testDb, { status, endedAt: status === 'ended' ? new Date('2026-10-20T16:00:00Z') : null });
  for (const memberId of memberIds) await testDb.attendance.create({ data: { sessionId: s.id, memberId, status: 'going' } });
  return s.id;
}

const GAMES_INVALID = errorBody('VALIDATION', 'Số buổi phải là số nguyên từ 0 đến 10000');

test('members list days in server (Discord join date when known, until leftAt for leavers) and games', async () => {
  const { sid } = await memberWithSid({ accessLevel: 'mod' });
  // now = 2026-10-22T12:00Z (19:00 VN ngày 22/10). 2026-09-30T17:30Z là 00:30 VN ngày 01/10 → 21 ngày.
  const discordJoin = new Date('2026-09-30T17:30:00Z');
  const an = await createMember(testDb, { displayName: 'An', joinedAt: new Date('2026-10-20T00:00:00Z'), guildJoinedAt: discordJoin });
  // Không biết ngày vào Discord → dùng joinedAt của app: 2026-10-21T17:00Z = 00:00 VN ngày 22/10 → 0 ngày.
  const binh = await createMember(testDb, { displayName: 'Bình', joinedAt: new Date('2026-10-21T17:00:00Z') });
  // Đã rời: đếm tới leftAt, không tới bây giờ. 01/10 → 05/10 VN = 4 ngày.
  const gone = await createMember(testDb, {
    displayName: 'Rời',
    joinedAt: new Date('2026-10-01T03:00:00Z'),
    status: 'left',
    leftAt: new Date('2026-10-05T03:00:00Z'),
    gamesAdjustment: 3,
  });

  // An đi 2 buổi đã kết thúc; buổi scheduled/cancelled và điểm danh đã huỷ không tính.
  await endedSession([an.id, binh.id]);
  await endedSession([an.id]);
  await endedSession([an.id], 'scheduled');
  await endedSession([an.id], 'cancelled');
  const dropped = await endedSession([]);
  await testDb.attendance.create({ data: { sessionId: dropped, memberId: an.id, status: 'cancelled' } });
  // Bình bị chỉnh âm quá số tự đếm → tổng không âm.
  await testDb.member.update({ where: { id: binh.id }, data: { gamesAdjustment: -5 } });

  const res = await get('/api/admin/members', sid);
  expect(res.statusCode, res.body).toBe(200);
  const byName = new Map(res.json<AdminMemberDto[]>().map((m) => [m.displayName, m]));
  expect(byName.get('An')).toMatchObject({
    joinedAt: '2026-10-20T00:00:00.000Z',
    serverJoinedAt: discordJoin.toISOString(),
    daysInServer: 21,
    games: 2,
    gamesAdjustment: 0,
  });
  expect(byName.get('Bình')).toMatchObject({ serverJoinedAt: '2026-10-21T17:00:00.000Z', daysInServer: 0, games: 0, gamesAdjustment: -5 });
  expect(byName.get('Rời')).toMatchObject({ serverJoinedAt: '2026-10-01T03:00:00.000Z', daysInServer: 4, games: 3, gamesAdjustment: 3 });
});

test('PUT /api/admin/members/:id/games sets the total; later sessions keep adding', async () => {
  const { member: admin, sid: adminSid } = await memberWithSid({ accessLevel: 'admin', displayName: 'Quản trị' });
  const an = await createMember(testDb, { displayName: 'An' });
  await endedSession([an.id]);
  await endedSession([an.id]);
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});

  const res = await put(`/api/admin/members/${an.id}/games`, adminSid, { games: 12 });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json<AdminMemberDto>()).toMatchObject({ id: an.id, displayName: 'An', email: null, games: 12, gamesAdjustment: 10 });
  expect((await testDb.member.findUniqueOrThrow({ where: { id: an.id } })).gamesAdjustment).toBe(10);
  expect(info).toHaveBeenCalledTimes(1);
  const line = String(info.mock.calls[0]?.[0]);
  for (const part of ['Quản trị', String(admin.id), 'An', String(an.id), '2', '12']) expect(line).toContain(part);

  // Buổi kết thúc sau đó vẫn cộng tiếp lên tổng đã chỉnh.
  await endedSession([an.id]);
  const list = (await get('/api/admin/members', adminSid)).json<AdminMemberDto[]>();
  expect(list.find((m) => m.id === an.id)).toMatchObject({ games: 13, gamesAdjustment: 10 });

  // Đặt tổng 0 khi số tự đếm lớn hơn: chỉnh âm, tổng về 0.
  const zero = await put(`/api/admin/members/${an.id}/games`, adminSid, { games: 0 });
  expect(zero.statusCode).toBe(200);
  expect(zero.json<AdminMemberDto>()).toMatchObject({ games: 0, gamesAdjustment: -3 });
  // Biên trên.
  expect((await put(`/api/admin/members/${an.id}/games`, adminSid, { games: 10000 })).statusCode).toBe(200);
});

test('PUT games: admin only, strict body, unknown member → 404', async () => {
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const { sid: memberSid } = await memberWithSid();
  const an = await createMember(testDb, { displayName: 'An' });

  for (const sid of [modSid, memberSid]) {
    const res = await put(`/api/admin/members/${an.id}/games`, sid, { games: 5 });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FORBIDDEN);
  }
  expect((await put(`/api/admin/members/${an.id}/games`, undefined, { games: 5 })).statusCode).toBe(401);

  for (const body of [{ games: -1 }, { games: 10001 }, { games: 1.5 }, { games: '5' }, { games: 5, extra: 1 }, {}, undefined]) {
    const bad = await put(`/api/admin/members/${an.id}/games`, adminSid, body);
    expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    expect(bad.json(), JSON.stringify(body)).toEqual(GAMES_INVALID);
  }
  expect((await testDb.member.findUniqueOrThrow({ where: { id: an.id } })).gamesAdjustment).toBe(0);

  for (const id of [an.id + 1000, 'abc', '0']) {
    const missing = await put(`/api/admin/members/${id}/games`, adminSid, { games: 5 });
    expect(missing.statusCode, String(id)).toBe(404);
    expect(missing.json(), String(id)).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
  }
});

// ---------------------------------------------------------------------------
// Cài đặt
// ---------------------------------------------------------------------------

test('settings are admin only', async () => {
  const { sid: memberSid } = await memberWithSid();
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });

  for (const sid of [memberSid, modSid]) {
    const read = await get('/api/admin/settings', sid);
    expect(read.statusCode).toBe(403);
    expect(read.json()).toEqual(FORBIDDEN);
    const write = await patch('/api/admin/settings', sid, { voteDurationHours: 6 });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toEqual(FORBIDDEN);
  }
  expect((await get('/api/admin/settings')).statusCode).toBe(401);
  expect((await patch('/api/admin/settings', undefined, { voteDurationHours: 6 })).statusCode).toBe(401);
  expect(await testDb.appSetting.count()).toBe(0);

  const defaults = await get('/api/admin/settings', adminSid);
  expect(defaults.statusCode).toBe(200);
  expect(defaults.json<SettingsDto>()).toEqual({ voteDurationHours: 12, autoEndHours: 4, reminderLeadMinutes: 15 });

  const updated = await patch('/api/admin/settings', adminSid, { voteDurationHours: 6 });
  expect(updated.statusCode).toBe(200);
  expect(updated.json<SettingsDto>()).toEqual({ voteDurationHours: 6, autoEndHours: 4, reminderLeadMinutes: 15 });
  expect((await get('/api/admin/settings', adminSid)).json<SettingsDto>()).toEqual({
    voteDurationHours: 6,
    autoEndHours: 4,
    reminderLeadMinutes: 15,
  });

  // Ngoài khoảng (service), sai kiểu / khoá lạ (route) → 400 chung; không ghi gì.
  for (const body of [{ voteDurationHours: 73 }, { autoEndHours: 0 }, { reminderLeadMinutes: 4.5 }, { autoEndHours: '4' }, { extra: 1 }, undefined]) {
    const bad = await patch('/api/admin/settings', adminSid, body);
    expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    expect(bad.json(), JSON.stringify(body)).toEqual(INVALID);
  }
  expect((await get('/api/admin/settings', adminSid)).json<SettingsDto>()).toMatchObject({ voteDurationHours: 6 });
  // Patch rỗng hợp lệ: không đổi gì.
  expect((await patch('/api/admin/settings', adminSid, {})).json<SettingsDto>()).toMatchObject({ voteDurationHours: 6 });
});

// ---------------------------------------------------------------------------
// Nhắc gửi lỗi
// ---------------------------------------------------------------------------

test('failures newest first', async () => {
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const a = await createMember(testDb, { displayName: 'Ngỗng A' });
  const b = await createMember(testDb, { displayName: 'Vịt B' });
  const session = await createSession(testDb); // Cổ điển, 21:00 22/10 giờ VN
  const hunt = await createSession(testDb, { modeKey: 'goose_hunt', startsAt: new Date('2026-10-23T13:30:00Z') });

  await testDb.notificationLog.createMany({
    data: [
      { sessionId: session.id, memberId: a.id, kind: 'pre15', channel: 'email', sentAt: new Date('2026-10-22T13:45:00Z'), error: 'Hộp thư không tồn tại' },
      { sessionId: session.id, memberId: a.id, kind: 'pre15', channel: 'dm', sentAt: new Date('2026-10-22T13:45:01Z'), error: null },
      { sessionId: hunt.id, memberId: b.id, kind: 'start', channel: 'dm', sentAt: new Date('2026-10-23T13:30:00Z'), error: 'Người nhận chặn DM' },
    ],
  });

  const res = await get('/api/admin/notification-failures', modSid);
  expect(res.statusCode).toBe(200);
  const rows = res.json<NotificationFailureDto[]>();
  expect(rows).toEqual([
    {
      sessionId: hunt.id,
      sessionLabel: 'Săn ngỗng (Goose Hunt) 20:30 23/10',
      memberId: b.id,
      displayName: 'Vịt B',
      kind: 'start',
      channel: 'dm',
      sentAt: '2026-10-23T13:30:00.000Z',
      error: 'Người nhận chặn DM',
    },
    {
      sessionId: session.id,
      sessionLabel: 'Cổ điển (Classic) 21:00 22/10',
      memberId: a.id,
      displayName: 'Ngỗng A',
      kind: 'pre15',
      channel: 'email',
      sentAt: '2026-10-22T13:45:00.000Z',
      error: 'Hộp thư không tồn tại',
    },
  ]);

  const { sid: memberSid } = await memberWithSid();
  expect((await get('/api/admin/notification-failures', memberSid)).statusCode).toBe(403);
  expect((await get('/api/admin/notification-failures')).statusCode).toBe(401);
});

test('mods see failure errors with recipient emails masked; admins see them', async () => {
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });
  const a = await createMember(testDb, { displayName: 'Ngỗng A', email: 'user@example.com' });
  const session = await createSession(testDb);
  await testDb.notificationLog.create({
    data: {
      sessionId: session.id,
      memberId: a.id,
      kind: 'pre15',
      channel: 'email',
      sentAt: new Date('2026-10-22T13:45:00Z'),
      error: '550 5.1.1 <user@example.com> Recipient address rejected: User unknown',
    },
  });

  const asMod = (await get('/api/admin/notification-failures', modSid)).json<NotificationFailureDto[]>();
  expect(asMod).toHaveLength(1);
  expect(asMod[0]?.error).toBe('550 5.1.1 <[email ẩn]> Recipient address rejected: User unknown');
  expect(JSON.stringify(asMod)).not.toContain('user@example.com');

  const asAdmin = (await get('/api/admin/notification-failures', adminSid)).json<NotificationFailureDto[]>();
  expect(asAdmin[0]?.error).toBe('550 5.1.1 <user@example.com> Recipient address rejected: User unknown');
});

test('failures are capped at the newest 100', async () => {
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const session = await createSession(testDb);
  // Khoá chính (buổi, người, loại, kênh): mỗi dòng lỗi cần một người riêng.
  const members = [];
  for (let i = 0; i < 101; i += 1) members.push(await createMember(testDb));
  await testDb.notificationLog.createMany({
    data: members.map((m, i) => ({
      sessionId: session.id,
      memberId: m.id,
      kind: 'start' as const,
      channel: 'dm' as const,
      sentAt: new Date(Date.UTC(2026, 9, 22, 14, 0, 0, i)),
      error: `lỗi ${i}`,
    })),
  });

  const rows = (await get('/api/admin/notification-failures', modSid)).json<NotificationFailureDto[]>();
  expect(rows).toHaveLength(100);
  expect(rows[0]?.error).toBe('lỗi 100');
  expect(rows[99]?.error).toBe('lỗi 1');
});

// ---------------------------------------------------------------------------
// Vote đang mở
// ---------------------------------------------------------------------------

test('open vote rounds are listed for mods, soonest closing first', async () => {
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const { sid: memberSid } = await memberWithSid();
  const late = await createSession(testDb, { status: 'ended' });
  const soon = await createSession(testDb, { modeKey: 'goose_hunt', startsAt: new Date('2026-10-22T11:00:00Z'), status: 'ended' });
  const closed = await createSession(testDb, { startsAt: new Date('2026-10-21T14:00:00Z'), status: 'ended' });
  await testDb.voteRound.createMany({
    data: [
      { sessionId: late.id, closesAt: new Date('2026-10-23T02:00:00Z'), status: 'open' },
      { sessionId: soon.id, closesAt: new Date('2026-10-22T23:00:00Z'), status: 'open' },
      { sessionId: closed.id, closesAt: new Date('2026-10-22T02:00:00Z'), status: 'closed' },
    ],
  });
  const rounds = await testDb.voteRound.findMany({ orderBy: { id: 'asc' } });

  const res = await get('/api/admin/vote-rounds?status=open', modSid);
  expect(res.statusCode).toBe(200);
  expect(res.json<OpenVoteRoundDto[]>()).toEqual([
    { id: rounds[1]?.id, sessionId: soon.id, sessionLabel: 'Săn ngỗng (Goose Hunt) 18:00 22/10', closesAt: '2026-10-22T23:00:00.000Z' },
    { id: rounds[0]?.id, sessionId: late.id, sessionLabel: 'Cổ điển (Classic) 21:00 22/10', closesAt: '2026-10-23T02:00:00.000Z' },
  ]);

  // Chỉ hỗ trợ `status=open`; thiếu hoặc khác → 400.
  for (const url of ['/api/admin/vote-rounds', '/api/admin/vote-rounds?status=closed']) {
    const bad = await get(url, modSid);
    expect(bad.statusCode, url).toBe(400);
    expect(bad.json(), url).toEqual(INVALID);
  }
  const forbidden = await get('/api/admin/vote-rounds?status=open', memberSid);
  expect(forbidden.statusCode).toBe(403);
  expect(forbidden.json()).toEqual(FORBIDDEN);
  expect((await get('/api/admin/vote-rounds?status=open')).statusCode).toBe(401);
});
