import type { Member, Role } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import { ensureSeason } from '../../../src/server/modules/seasons/service.js';
import type { HallDto, HeldRoleDto, LeaderboardRowDto, ReportDto, SeasonDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, roleByKey } from '../../helpers/factories.js';
import type { FakeNotifier } from '../../helpers/fakes.js';

/** Không route nào ở đây đụng tới OAuth. */
const oauth: OAuthClient = {
  authorizeUrl: () => 'https://discord.test/authorize',
  exchange: async () => {
    throw new Error('không dùng');
  },
};

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let app: FastifyInstance;
let swordsman: Role;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  app = await buildApp(ctx, { oauth });
  await app.ready();
  swordsman = await roleByKey(testDb, 'swordsman');
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
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

const get = (url: string, sid?: string) => app.inject({ url, cookies: sid ? { ggd_sid: sid } : {} });

const send = (method: 'POST' | 'PATCH', url: string, sid: string | undefined, payload?: unknown) =>
  app.inject({
    method,
    url,
    cookies: sid ? { ggd_sid: sid } : {},
    headers: { 'content-type': 'application/json' },
    payload: payload === undefined ? '' : JSON.stringify(payload),
  });
const post = (url: string, sid: string | undefined, payload?: unknown) => send('POST', url, sid, payload);
const patch = (url: string, sid: string | undefined, payload?: unknown) => send('PATCH', url, sid, payload);

const errorBody = (code: string, message: string) => ({ error: { code, message } });
const FORBIDDEN = errorBody('FORBIDDEN', 'Bạn không có quyền làm việc này');
const INVALID = errorBody('VALIDATION', 'Dữ liệu không hợp lệ');

/** Khai Kiếm sĩ `value` mạng ngày 22/10 qua API; trả về DTO đã tạo. */
async function submit(sid: string, value: number, extra: Record<string, unknown> = {}): Promise<ReportDto> {
  const res = await post('/api/reports', sid, { roleId: swordsman.id, value, playedOn: '2026-10-22', ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ReportDto>();
}

const review = (sid: string | undefined, id: number | string, body: unknown) => post(`/api/admin/reports/${id}/review`, sid, body);
const reportRow = (id: number) => testDb.statReport.findUniqueOrThrow({ where: { id } });

// ---------------------------------------------------------------------------
// Phân quyền
// ---------------------------------------------------------------------------

test('member cannot review', async () => {
  const { sid } = await memberWithSid();
  const { sid: otherSid } = await memberWithSid({ displayName: 'Bình' });
  const r = await submit(otherSid, 5);

  const res = await review(sid, r.id, { approve: true });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toEqual(FORBIDDEN);
  expect((await reportRow(r.id)).status).toBe('pending');

  const queue = await get('/api/admin/reports?status=pending', sid);
  expect(queue.statusCode).toBe(403);
  expect(queue.json()).toEqual(FORBIDDEN);
});

test('every stats route needs a login', async () => {
  const calls = [
    () => post('/api/reports', undefined, { roleId: 1, value: 1, playedOn: '2026-10-22' }),
    () => patch('/api/reports/1', undefined, { value: 2 }),
    () => get('/api/reports/mine'),
    () => get('/api/me/titles'),
    () => get('/api/admin/reports?status=pending'),
    () => review(undefined, 1, { approve: true }),
    () => get(`/api/leaderboard?roleId=${swordsman.id}`),
    () => get('/api/hall'),
    () => get('/api/seasons'),
  ];
  for (const call of calls) {
    const res = await call();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(errorBody('UNAUTHENTICATED', 'Bạn cần đăng nhập'));
  }
  expect(await testDb.statReport.count()).toBe(0);
});

// ---------------------------------------------------------------------------
// Khai, lịch sử, sửa
// ---------------------------------------------------------------------------

test('submit returns the created report; mine lists newest first; own pending report can be edited', async () => {
  const { member: me, sid } = await memberWithSid({ displayName: 'An' });
  const { sid: otherSid } = await memberWithSid({ displayName: 'Bình' });

  const first = await submit(sid, 5, { note: '  Trận cuối  ' });
  expect(first).toEqual({
    id: first.id,
    member: { id: me.id, displayName: 'An' },
    role: { id: swordsman.id, nameVi: 'Kiếm sĩ', icon: '⚔️', metricLabel: 'Số mạng chém' },
    value: 5,
    playedOn: '2026-10-22',
    sessionId: null,
    note: 'Trận cuối',
    status: 'pending',
    rejectReason: null,
    createdAt: '2026-10-22T12:00:00.000Z',
  });

  setNow('2026-10-22T12:30:00Z');
  const second = await submit(sid, 2, { playedOn: '2026-10-21' });
  await submit(otherSid, 9);

  const mine = await get('/api/reports/mine', sid);
  expect(mine.statusCode).toBe(200);
  expect(mine.json<ReportDto[]>().map((r) => r.id)).toEqual([second.id, first.id]);
  expect((await get('/api/reports/mine?limit=1', sid)).json<ReportDto[]>().map((r) => r.id)).toEqual([second.id]);
  for (const limit of ['0', '101', 'x', '1.5', '-1']) {
    const res = await get(`/api/reports/mine?limit=${limit}`, sid);
    expect(res.statusCode, limit).toBe(400);
    expect(res.json(), limit).toEqual(INVALID);
  }

  // Sửa lần khai của mình: trường vắng mặt giữ nguyên.
  const edited = await patch(`/api/reports/${first.id}`, sid, { value: 6, note: null });
  expect(edited.statusCode).toBe(200);
  expect(edited.json<ReportDto>()).toEqual({ ...first, value: 6, note: null });
  expect(await reportRow(first.id)).toMatchObject({ value: 6, note: null, status: 'pending', createdAt: new Date('2026-10-22T12:00:00Z') });

  // Của người khác → như không có; id hỏng → 400; body sai → 400 chung; vi phạm quy tắc → thông báo của service.
  const foreign = await patch(`/api/reports/${first.id}`, otherSid, { value: 1 });
  expect(foreign.statusCode).toBe(404);
  expect(foreign.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
  expect((await patch('/api/reports/abc', sid, { value: 1 })).statusCode).toBe(400);
  expect((await patch('/api/reports/999', sid, { value: 1 })).statusCode).toBe(404);
  for (const body of [undefined, { value: 'x' }, { extra: 1 }, { playedOn: '22/10/2026' }, { roleId: 0 }, { sessionId: 'x' }]) {
    const res = await patch(`/api/reports/${first.id}`, sid, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json(), JSON.stringify(body)).toEqual(INVALID);
  }
  const over = await patch(`/api/reports/${first.id}`, sid, { value: 99 });
  expect(over.statusCode).toBe(400);
  expect(over.json()).toEqual(errorBody('VALUE_OUT_OF_RANGE', 'Giá trị phải từ 0 đến 15'));
  expect((await reportRow(first.id)).value).toBe(6);
});

test('submit validation: shape errors are generic, rule violations carry the service message', async () => {
  const { sid } = await memberWithSid();
  const base = { roleId: swordsman.id, value: 3, playedOn: '2026-10-22' };
  for (const body of [
    undefined,
    {},
    { ...base, roleId: 'x' },
    { ...base, roleId: 0 },
    { ...base, value: '3' },
    { ...base, playedOn: '22/10/2026' },
    { ...base, playedOn: 20261022 },
    { ...base, sessionId: 'x' },
    { ...base, note: 5 },
    { ...base, extra: 1 },
  ]) {
    const res = await post('/api/reports', sid, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json(), JSON.stringify(body)).toEqual(INVALID);
  }
  const half = await post('/api/reports', sid, { ...base, value: 1.5 });
  expect(half.statusCode).toBe(400);
  expect(half.json()).toEqual(errorBody('VALUE_OUT_OF_RANGE', 'Giá trị phải từ 0 đến 15'));
  const noDay = await post('/api/reports', sid, { ...base, playedOn: '2026-02-30' });
  expect(noDay.statusCode).toBe(400);
  expect(noDay.json()).toEqual(errorBody('VALIDATION', 'Ngày chơi không hợp lệ'));
  const old = await post('/api/reports', sid, { ...base, playedOn: '2026-10-01' });
  expect(old.statusCode).toBe(400);
  expect(old.json()).toEqual(errorBody('PLAYED_ON_OUT_OF_WINDOW', 'Chỉ khai được trận trong 3 ngày gần nhất'));
  const noRole = await post('/api/reports', sid, { ...base, roleId: 9999 });
  expect(noRole.statusCode).toBe(400);
  expect(noRole.json()).toEqual(errorBody('VALIDATION', 'Role không hợp lệ'));
  expect(await testDb.statReport.count()).toBe(0);
});

// ---------------------------------------------------------------------------
// Duyệt
// ---------------------------------------------------------------------------

test('approved report shows on leaderboard API', async () => {
  const { member: me, sid } = await memberWithSid({ displayName: 'An' });
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod', displayName: 'Mod' });
  const r = await submit(sid, 5);

  // Chưa duyệt: bảng trống, chưa giữ role nào.
  expect((await get(`/api/leaderboard?roleId=${swordsman.id}`, sid)).json()).toEqual([]);
  expect((await get('/api/me/titles', sid)).json()).toEqual([]);

  setNow('2026-10-22T13:00:00Z');
  const approved = await review(modSid, r.id, { approve: true });
  expect(approved.statusCode).toBe(204);
  expect(approved.body).toBe('');
  expect(await reportRow(r.id)).toMatchObject({ status: 'approved', reviewedAt: new Date('2026-10-22T13:00:00Z') });
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Kiếm sĩ mùa 2026-10!']);

  const board = await get(`/api/leaderboard?roleId=${swordsman.id}`, sid);
  expect(board.statusCode).toBe(200);
  expect(board.json<LeaderboardRowDto[]>()).toEqual([
    { rank: 1, memberId: me.id, displayName: 'An', avatarUrl: null, score: 5, games: 1, lastApprovedAt: '2026-10-22T13:00:00.000Z' },
  ]);
  // Mùa hiện tại là mặc định; mùa khác trống.
  expect((await get(`/api/leaderboard?roleId=${swordsman.id}&season=2026-10`, sid)).json()).toEqual(board.json());
  expect((await get(`/api/leaderboard?roleId=${swordsman.id}&season=2026-09`, sid)).json()).toEqual([]);

  const titles = await get('/api/me/titles', sid);
  expect(titles.statusCode).toBe(200);
  expect(titles.json<HeldRoleDto[]>()).toEqual([
    {
      role: expect.objectContaining({ id: swordsman.id, key: 'swordsman', nameVi: 'Kiếm sĩ', faction: 'duck', icon: '⚔️' }),
      score: 5,
    },
  ]);
  expect((await get('/api/me/titles', modSid)).json()).toEqual([]);

  // Lần khai đã duyệt: duyệt lại → 409 với thông báo của service; sửa → 409.
  const again = await review(modSid, r.id, { approve: false, reason: 'Trùng' });
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual(errorBody('NOT_PENDING', 'Lần khai này đã được xử lý'));
  const edit = await patch(`/api/reports/${r.id}`, sid, { value: 1 });
  expect(edit.statusCode).toBe(409);
  expect(edit.json()).toEqual(errorBody('NOT_PENDING', 'Lần khai này đã được xử lý'));
  expect((await get('/api/reports/mine', sid)).json<ReportDto[]>()[0]).toMatchObject({ id: r.id, status: 'approved', value: 5 });
});

test('review decisions: approve ignores an empty reason, reject needs one and DMs the reporter', async () => {
  const { sid } = await memberWithSid({ displayName: 'An', discordId: 'an-discord' });
  const { member: mod, sid: modSid } = await memberWithSid({ accessLevel: 'mod', displayName: 'Mod' });
  const a = await submit(sid, 5);
  const b = await submit(sid, 4);
  const c = await submit(sid, 3);

  expect((await review(modSid, a.id, { approve: true, reason: '' })).statusCode).toBe(204);
  expect(await reportRow(a.id)).toMatchObject({ status: 'approved', reviewedById: mod.id, rejectReason: null });

  const noReason = await review(modSid, b.id, { approve: false });
  expect(noReason.statusCode).toBe(400);
  expect(noReason.json()).toEqual(errorBody('REASON_REQUIRED', 'Cần ghi lý do từ chối'));
  expect((await review(modSid, b.id, { approve: false, reason: '   ' })).json()).toEqual(errorBody('REASON_REQUIRED', 'Cần ghi lý do từ chối'));
  expect((await reportRow(b.id)).status).toBe('pending');

  const rejected = await review(modSid, b.id, { approve: false, reason: '  Khai trùng  ' });
  expect(rejected.statusCode).toBe(204);
  expect(await reportRow(b.id)).toMatchObject({ status: 'rejected', rejectReason: 'Khai trùng', reviewedById: mod.id });
  expect(notifier.dms).toEqual([{ discordId: 'an-discord', text: 'Lần khai Kiếm sĩ (4 Số mạng chém) ngày 22/10 bị từ chối: Khai trùng' }]);
  expect((await get('/api/reports/mine', sid)).json<ReportDto[]>().find((r) => r.id === b.id)).toMatchObject({
    status: 'rejected',
    rejectReason: 'Khai trùng',
  });

  // Dạng sai → 400 chung; id lạ → 404; id hỏng → 400.
  for (const body of [undefined, {}, { approve: 'yes' }, { approve: true, extra: 1 }, { approve: false, reason: 1 }]) {
    const res = await review(modSid, c.id, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json(), JSON.stringify(body)).toEqual(INVALID);
  }
  expect((await review(modSid, 999, { approve: true })).statusCode).toBe(404);
  expect((await review(modSid, 0, { approve: true })).statusCode).toBe(400);
  expect((await review(modSid, 'abc', { approve: true })).statusCode).toBe(400);

  // Mod không tự duyệt lần khai của mình; admin thì được.
  const own = await submit(modSid, 2);
  const self = await review(modSid, own.id, { approve: true });
  expect(self.statusCode).toBe(403);
  expect(self.json()).toEqual(errorBody('SELF_REVIEW', 'Mod không được tự duyệt lần khai của mình'));
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin', displayName: 'Admin' });
  expect((await review(adminSid, own.id, { approve: true })).statusCode).toBe(204);
  expect((await reportRow(c.id)).status).toBe('pending');
});

test('pending queue lists everyone, oldest first; only status=pending is supported', async () => {
  const { sid } = await memberWithSid({ displayName: 'An' });
  const { sid: otherSid } = await memberWithSid({ displayName: 'Bình' });
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod', displayName: 'Mod' });
  const a = await submit(sid, 5);
  setNow('2026-10-22T12:10:00Z');
  const b = await submit(otherSid, 4);
  setNow('2026-10-22T12:20:00Z');
  const c = await submit(sid, 3);
  expect((await review(modSid, b.id, { approve: true })).statusCode).toBe(204);

  const queue = await get('/api/admin/reports?status=pending', modSid);
  expect(queue.statusCode).toBe(200);
  const rows = queue.json<ReportDto[]>();
  expect(rows.map((r) => r.id)).toEqual([a.id, c.id]);
  expect(rows[0]).toEqual(a);
  expect(rows[0]?.member).toEqual({ id: a.member.id, displayName: 'An' });

  for (const q of ['', '?status=approved', '?status=', '?status=pending&status=x']) {
    const res = await get(`/api/admin/reports${q}`, modSid);
    expect(res.statusCode, q).toBe(400);
    expect(res.json(), q).toEqual(INVALID);
  }
});

// ---------------------------------------------------------------------------
// Bảng xếp hạng, Đại sảnh, mùa
// ---------------------------------------------------------------------------

test('leaderboard query validation and limit', async () => {
  const { sid } = await memberWithSid({ displayName: 'An' });
  const { sid: otherSid } = await memberWithSid({ displayName: 'Bình' });
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod', displayName: 'Mod' });
  const a = await submit(sid, 5);
  const b = await submit(otherSid, 7);
  expect((await review(modSid, a.id, { approve: true })).statusCode).toBe(204);
  expect((await review(modSid, b.id, { approve: true })).statusCode).toBe(204);

  const full = await get(`/api/leaderboard?roleId=${swordsman.id}`, sid);
  expect(full.json<LeaderboardRowDto[]>().map((r) => [r.rank, r.displayName, r.score])).toEqual([
    [1, 'Bình', 7],
    [2, 'An', 5],
  ]);
  const top1 = await get(`/api/leaderboard?roleId=${swordsman.id}&limit=1`, sid);
  expect(top1.json<LeaderboardRowDto[]>().map((r) => r.displayName)).toEqual(['Bình']);
  expect((await get(`/api/leaderboard?roleId=${swordsman.id}&limit=100`, sid)).statusCode).toBe(200);

  for (const q of [
    '',
    '?season=2026-10',
    '?roleId=abc',
    '?roleId=0',
    '?roleId=1.5',
    `?roleId=${swordsman.id}&season=2026-13`,
    `?roleId=${swordsman.id}&season=10/2026`,
    `?roleId=${swordsman.id}&season=2026-1`,
    `?roleId=${swordsman.id}&limit=0`,
    `?roleId=${swordsman.id}&limit=101`,
    `?roleId=${swordsman.id}&limit=x`,
  ]) {
    const res = await get(`/api/leaderboard${q}`, sid);
    expect(res.statusCode, q).toBe(400);
    expect(res.json(), q).toEqual(INVALID);
  }
  const missing = await get('/api/leaderboard?roleId=9999', sid);
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
});

test('hall lists 71 main roles', async () => {
  const { member: me, sid } = await memberWithSid({ displayName: 'An' });
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod', displayName: 'Mod' });
  const r = await submit(sid, 5);
  expect((await review(modSid, r.id, { approve: true })).statusCode).toBe(204);

  const res = await get('/api/hall', sid);
  expect(res.statusCode).toBe(200);
  const hall = res.json<HallDto>();
  expect(hall.seasonId).toBe('2026-10');
  expect(hall.closed).toBe(false);
  expect(hall.roles).toHaveLength(71);
  expect(hall.roles.every((x) => x.role.active)).toBe(true);
  // Ngỗng → Vịt → Phe thứ 3.
  expect(hall.roles[0]?.role).toMatchObject({ key: 'goose', faction: 'goose' });
  expect(hall.roles.at(-1)?.role.faction).toBe('neutral');
  const entry = hall.roles.find((x) => x.role.key === 'swordsman');
  expect(entry).toMatchObject({ holder: { memberId: me.id, displayName: 'An', score: 5 }, previous: null });
  expect(hall.roles.filter((x) => x.holder !== null)).toHaveLength(1);

  // Mùa cụ thể; mùa sai dạng → 400.
  const past = await get('/api/hall?season=2026-09', sid);
  expect(past.statusCode).toBe(200);
  expect(past.json<HallDto>()).toMatchObject({ seasonId: '2026-09', closed: false });
  expect(past.json<HallDto>().roles.every((x) => x.holder === null)).toBe(true);
  for (const season of ['2026-13', '202610', '2026-1', 'abc', '']) {
    const bad = await get(`/api/hall?season=${encodeURIComponent(season)}`, sid);
    expect(bad.statusCode, season).toBe(400);
    expect(bad.json(), season).toEqual(INVALID);
  }
});

test('seasons list the current season plus every known one, newest first', async () => {
  const { sid } = await memberWithSid();
  expect((await get('/api/seasons', sid)).json<SeasonDto[]>()).toEqual([{ id: '2026-10', closed: false }]);

  await ensureSeason(ctx, '2026-08');
  await ensureSeason(ctx, '2026-09');
  await testDb.season.update({ where: { id: '2026-08' }, data: { closedAt: ctx.now() } });
  const res = await get('/api/seasons', sid);
  expect(res.statusCode).toBe(200);
  expect(res.json<SeasonDto[]>()).toEqual([
    { id: '2026-10', closed: false },
    { id: '2026-09', closed: false },
    { id: '2026-08', closed: true },
  ]);
});
