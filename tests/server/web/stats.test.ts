import { once } from 'node:events';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { Readable } from 'node:stream';
import type { Member, Role } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import { ensureSeason } from '../../../src/server/modules/seasons/service.js';
import type { FactionTopDto, HallDto, HeldRoleDto, LeaderboardRowDto, ReportDto, SeasonDto } from '../../../src/shared/api-types.js';
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
let ipCounter = 0;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  app = await buildApp(ctx, { oauth });
  await app.ready();
  swordsman = await roleByKey(testDb, 'swordsman');
  ipCounter = 0;
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

/**
 * PUT highlight thô với content-type `type` (mặc định video/mp4). Mỗi lần gọi từ một IP khác
 * để các test nghiệp vụ không đụng giới hạn 6 lần / 10 phút của route; test giới hạn tốc độ
 * truyền `remoteAddress` cố định.
 */
const putHighlight = (id: number | string, sid: string | undefined, body: Buffer | string, type = 'video/mp4', remoteAddress = freshIp()) =>
  app.inject({
    method: 'PUT',
    url: `/api/reports/${id}/highlight`,
    cookies: sid ? { ggd_sid: sid } : {},
    headers: { 'content-type': type },
    payload: body,
    remoteAddress,
  });

function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

/**
 * PUT highlight mà body không bao giờ tới (luồng không kết thúc), chỉ có header `Content-Length`:
 * request chỉ có trả lời nếu route trả lời TRƯỚC khi đọc body — đọc body thì test treo (hết giờ).
 */
const putHighlightBodyless = (id: number, sid: string, contentLength: number) =>
  app.inject({
    method: 'PUT',
    url: `/api/reports/${id}/highlight`,
    cookies: { ggd_sid: sid },
    headers: { 'content-type': 'video/mp4', 'content-length': String(contentLength) },
    payload: new Readable({ read() {} }),
    remoteAddress: freshIp(),
  });

/**
 * Giữ mọi lần đăng highlight ở bước "đang tải lên Discord" tới khi test thả (`onPostHighlight`
 * trả promise chưa xong) — để có các lần tải lên đang chạy cùng lúc mà không cần chờ giờ.
 */
function holdHighlightPosts() {
  const held: (() => void)[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  notifier.onPostHighlight = () =>
    new Promise<void>((resolve) => {
      held.push(resolve);
      for (const waiter of waiters) if (held.length >= waiter.count) waiter.resolve();
    });
  return {
    /** Chờ tới khi đã có tổng cộng `count` lần đăng vào tới Discord giả (kể cả lần đã thả). */
    reached: (count: number) =>
      new Promise<void>((resolve) => {
        if (held.length >= count) resolve();
        else waiters.push({ count, resolve });
      }),
    /** Thả lần đăng thứ `index` (từ 0). */
    release: (index: number) => held[index]?.(),
    releaseAll: () => held.forEach((resolve) => resolve()),
    /** Thả hết và thôi giữ: các lần đăng sau chạy thẳng. */
    stop: () => {
      notifier.onPostHighlight = undefined;
      held.forEach((resolve) => resolve());
    },
  };
}

/** Cho app lắng nghe cổng thật (một lần mỗi test) — để thử client ngắt kết nối giữa chừng. */
async function listenPort(): Promise<number> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as AddressInfo).port;
}

/** Kết nối TCP thật, gửi đầu yêu cầu PUT highlight (body gửi sau bằng `socket.write`). */
async function rawHighlightRequest(id: number, sid: string, contentLength: number): Promise<Socket> {
  const socket = connect(await listenPort(), '127.0.0.1');
  socket.on('error', () => {}); // server đóng/reset kết nối sau khi test tự ngắt: không phải lỗi của test
  await once(socket, 'connect');
  socket.write(
    `PUT /api/reports/${id}/highlight HTTP/1.1\r\nHost: localhost\r\nCookie: ggd_sid=${encodeURIComponent(sid)}\r\n` +
      `Content-Type: video/mp4\r\nContent-Length: ${contentLength}\r\n\r\n`,
  );
  return socket;
}

const errorBody = (code: string, message: string) => ({ error: { code, message } });
const FORBIDDEN = errorBody('FORBIDDEN', 'Bạn không có quyền làm việc này');
const INVALID = errorBody('VALIDATION', 'Dữ liệu không hợp lệ');
const UNAUTHENTICATED = errorBody('UNAUTHENTICATED', 'Bạn cần đăng nhập');
const UNSUPPORTED_MEDIA_TYPE = errorBody('UNSUPPORTED_MEDIA_TYPE', 'Chỉ nhận dữ liệu JSON');
const INVALID_HIGHLIGHT = errorBody('INVALID_HIGHLIGHT', 'Highlight phải là video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF');
const HIGHLIGHT_BUSY = errorBody('HIGHLIGHT_BUSY', 'Máy chủ đang bận tải highlight khác, thử lại sau');

const MIB = 1024 * 1024;
/** `bodyLimit` của route highlight: 50 MiB + 64 KiB. */
const HIGHLIGHT_BODY_LIMIT = 52_494_336;

/** MP4 tối thiểu: 4 byte kích thước, `ftyp` ở byte 4, brand `isom` ở byte 8; phần còn lại là 0. */
function mp4(size = 64): Buffer {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(Math.min(size, 0xffffffff), 0);
  buf.write('ftypisom', 4, 'latin1');
  return buf;
}
const pngFile = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** Link tới tin Discord chứa highlight (guild của `testConfig` là `test-guild`). */
const jumpLink = (channelId: string, messageId: string) => `https://discord.com/channels/test-guild/${channelId}/${messageId}`;
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

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
    () => get('/api/leaderboard/factions'),
    () => get('/api/hall'),
    () => get('/api/seasons'),
    () => get('/api/reports/highlight-config'),
    () => putHighlight(1, undefined, mp4()),
  ];
  for (const call of calls) {
    const res = await call();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(UNAUTHENTICATED);
  }
  expect(await testDb.statReport.count()).toBe(0);
  expect(notifier.highlights).toEqual([]);
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
    highlightUrl: null,
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

test('faction top 3 API: three factions for the season, same season parsing as the leaderboard', async () => {
  const { member: me, sid } = await memberWithSid({ displayName: 'An' });
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod', displayName: 'Mod' });
  const empty = (seasonId: string): FactionTopDto => ({ seasonId, factions: { goose: [], duck: [], neutral: [] } });
  const r = await submit(sid, 5);
  // Chưa duyệt: ba phe trống, mùa mặc định là mùa hiện tại.
  expect((await get('/api/leaderboard/factions', sid)).json()).toEqual(empty('2026-10'));

  setNow('2026-10-22T13:00:00Z');
  expect((await review(modSid, r.id, { approve: true })).statusCode).toBe(204);
  const res = await get('/api/leaderboard/factions', sid);
  expect(res.statusCode).toBe(200);
  expect(res.json<FactionTopDto>()).toEqual({
    seasonId: '2026-10',
    factions: {
      goose: [],
      duck: [
        {
          rank: 1,
          memberId: me.id,
          displayName: 'An',
          avatarUrl: null,
          role: { id: swordsman.id, nameVi: 'Kiếm sĩ', icon: '⚔️', metricLabel: 'Số mạng chém', faction: 'duck' },
          value: 5,
          weight: 1,
          points: 5,
          games: 1,
        },
      ],
      neutral: [],
    },
  });
  expect((await get('/api/leaderboard/factions?season=2026-10', sid)).json()).toEqual(res.json());
  expect((await get('/api/leaderboard/factions?season=2026-09', sid)).json()).toEqual(empty('2026-09'));
  for (const season of ['2026-13', '202610', '2026-1', '10/2026', 'abc', '']) {
    const bad = await get(`/api/leaderboard/factions?season=${encodeURIComponent(season)}`, sid);
    expect(bad.statusCode, season).toBe(400);
    expect(bad.json(), season).toEqual(INVALID);
  }
  // Route con không che route bảng xếp hạng theo role.
  const board = await get(`/api/leaderboard?roleId=${swordsman.id}`, sid);
  expect(board.statusCode).toBe(200);
  expect(board.json<LeaderboardRowDto[]>()).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// Highlight kèm lần khai
// ---------------------------------------------------------------------------

test('highlight-config requires login and reports enabled/maxBytes', async () => {
  const { sid } = await memberWithSid();
  const anon = await get('/api/reports/highlight-config');
  expect(anon.statusCode).toBe(401);
  expect(anon.json()).toEqual(UNAUTHENTICATED);

  const res = await get('/api/reports/highlight-config', sid);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ enabled: true, maxBytes: 10 * MIB });

  // Theo giới hạn hiện hành của server Discord (boost cấp 2).
  notifier.uploadLimit = 50 * MIB;
  expect((await get('/api/reports/highlight-config', sid)).json()).toEqual({ enabled: true, maxBytes: 50 * MIB });

  // Bot sập → 503 với thông báo của service; tắt tính năng → trả "tắt" mà không hỏi Discord.
  silenceConsoleError();
  notifier.down = true;
  const down = await get('/api/reports/highlight-config', sid);
  expect(down.statusCode).toBe(503);
  expect(down.json()).toEqual(errorBody('DISCORD_UNAVAILABLE', 'Không đăng được highlight lên Discord, thử lại sau'));
  ctx.config.discord.highlightChannelId = null;
  const off = await get('/api/reports/highlight-config', sid);
  expect(off.statusCode).toBe(200);
  expect(off.json()).toEqual({ enabled: false, maxBytes: 0 });
});

test('PUT highlight with video/mp4 body stores it and returns highlightUrl', async () => {
  const { sid } = await memberWithSid({ displayName: 'An' });
  const r = await submit(sid, 5);
  const file = mp4();

  const res = await putHighlight(r.id, sid, file);
  expect(res.statusCode, res.body).toBe(200);
  expect(notifier.highlights).toHaveLength(1);
  const posted = notifier.highlights[0]!;
  expect(posted).toMatchObject({ memberName: 'An', roleLabel: '⚔️ Kiếm sĩ', fileName: `highlight-${r.id}.mp4`, channelId: 'ch-highlight' });
  expect(posted.data.equals(file)).toBe(true);
  const url = jumpLink(posted.channelId, posted.messageId);
  expect(res.json<ReportDto>()).toEqual({ ...r, highlightUrl: url });
  expect(await reportRow(r.id)).toMatchObject({ highlightChannelId: posted.channelId, highlightMessageId: posted.messageId, status: 'pending' });
  expect((await get('/api/reports/mine', sid)).json<ReportDto[]>()[0]).toMatchObject({ id: r.id, highlightUrl: url });

  // Mọi content-type trong danh sách đều qua; đổi highlight → tin cũ bị xoá.
  for (const type of ['video/webm', 'video/quicktime', 'image/png', 'image/jpeg', 'image/gif']) {
    const again = await putHighlight(r.id, sid, file, type);
    expect(again.statusCode, type).toBe(200);
  }
  expect(notifier.highlights).toHaveLength(6);
  expect(notifier.deletedMessages).toHaveLength(5);
  expect(notifier.deletedMessages[0]).toEqual({ channelId: posted.channelId, messageId: posted.messageId });

  // Loại thật theo nội dung, không theo header: gửi PNG với content-type video/mp4 → tên file .png.
  const asPng = await putHighlight(r.id, sid, pngFile, 'video/mp4');
  expect(asPng.statusCode).toBe(200);
  const latest = notifier.highlights.at(-1)!;
  expect(latest).toMatchObject({ fileName: `highlight-${r.id}.png` });
  expect(asPng.json<ReportDto>().highlightUrl).toBe(jumpLink(latest.channelId, latest.messageId));
  expect(await reportRow(r.id)).toMatchObject({ highlightChannelId: latest.channelId, highlightMessageId: latest.messageId });
});

test('PUT highlight with application/pdf or text/plain → 415; JSON or a fake file → INVALID_HIGHLIGHT', async () => {
  const { sid } = await memberWithSid();
  const r = await submit(sid, 5);

  for (const type of ['application/pdf', 'text/plain', 'image/webp', 'image/svg+xml', 'video/x-matroska', 'application/octet-stream']) {
    const res = await putHighlight(r.id, sid, mp4(), type);
    expect(res.statusCode, type).toBe(415);
    expect(res.json(), type).toEqual(UNSUPPORTED_MEDIA_TYPE);
  }
  // Thiếu content-type → 415 như mọi route ghi.
  const noType = await app.inject({ method: 'PUT', url: `/api/reports/${r.id}/highlight`, cookies: { ggd_sid: sid }, payload: mp4() });
  expect(noType.statusCode).toBe(415);
  expect(noType.json()).toEqual(UNSUPPORTED_MEDIA_TYPE);

  // Guard cho JSON qua nhưng body không phải file → cùng lỗi với file giả; nội dung lạ → lỗi của service.
  const json = await putHighlight(r.id, sid, '{"a":1}', 'application/json');
  expect(json.statusCode).toBe(400);
  expect(json.json()).toEqual(INVALID_HIGHLIGHT);
  const fake = await putHighlight(r.id, sid, 'hello', 'video/mp4');
  expect(fake.statusCode).toBe(400);
  expect(fake.json()).toEqual(INVALID_HIGHLIGHT);
  const pdf = await putHighlight(r.id, sid, '%PDF-1.4', 'image/png');
  expect(pdf.statusCode).toBe(400);
  expect(pdf.json()).toEqual(INVALID_HIGHLIGHT);
  expect((await putHighlight(r.id, sid, Buffer.alloc(0))).json()).toEqual(INVALID_HIGHLIGHT);

  expect(notifier.highlights).toEqual([]);
  expect(await reportRow(r.id)).toMatchObject({ highlightChannelId: null, highlightMessageId: null });
});

test('a raw body to any other /api route is still rejected (415)', async () => {
  const { sid } = await memberWithSid();
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });
  const r = await submit(sid, 5);
  const raw = (method: 'POST' | 'PATCH' | 'PUT', url: string, who: string, type = 'video/mp4') =>
    app.inject({ method, url, cookies: { ggd_sid: who }, headers: { 'content-type': type }, payload: mp4() });

  const calls: [method: 'POST' | 'PATCH' | 'PUT', url: string, who: string][] = [
    ['PUT', `/api/reports/${r.id}`, sid], // không có route PUT ở đây
    ['PATCH', `/api/reports/${r.id}`, sid],
    ['POST', '/api/reports', sid],
    ['POST', `/api/admin/reports/${r.id}/review`, adminSid],
    ['PUT', `/api/admin/roles/${swordsman.id}/image`, adminSid], // route ảnh role chỉ nhận ảnh của nó
    ['POST', `/api/reports/${r.id}/highlight`, sid], // sai phương thức
    ['PUT', `/api/reports/${r.id}/highlight/extra`, sid],
  ];
  for (const [method, url, who] of calls) {
    const res = await raw(method, url, who);
    expect(res.statusCode, `${method} ${url}`).toBe(415);
    expect(res.json(), `${method} ${url}`).toEqual(UNSUPPORTED_MEDIA_TYPE);
  }
  // Ngược lại, content-type ảnh role (webp) không mở được route highlight.
  const webp = await putHighlight(r.id, sid, mp4(), 'image/webp');
  expect(webp.statusCode).toBe(415);

  expect(await reportRow(r.id)).toMatchObject({ value: 5, status: 'pending', highlightChannelId: null });
  expect(await roleByKey(testDb, 'swordsman')).toMatchObject({ image: null, imageMime: null });
  expect(await testDb.statReport.count()).toBe(1);
  expect(notifier.highlights).toEqual([]);
});

test('a body over the route limit → 400 HIGHLIGHT_TOO_LARGE', async () => {
  const { sid } = await memberWithSid();
  const r = await submit(sid, 5);

  // Vượt bodyLimit của route (50 MiB + 64 KiB) mà không khai Content-Length (gửi chunked) → Fastify
  // chặn trong lúc đọc body, vẫn là lỗi của app chứ không phải 413 chung (câu dự phòng).
  const huge = await app.inject({
    method: 'PUT',
    url: `/api/reports/${r.id}/highlight`,
    cookies: { ggd_sid: sid },
    headers: { 'content-type': 'video/mp4', 'transfer-encoding': 'chunked' },
    payload: Readable.from([mp4(HIGHLIGHT_BODY_LIMIT + 1)]),
    remoteAddress: freshIp(),
  });
  expect(huge.statusCode).toBe(400);
  expect(huge.json()).toEqual(errorBody('HIGHLIGHT_TOO_LARGE', 'Highlight quá lớn'));
  // Có Content-Length thì route chặn sớm với câu theo giới hạn hiện hành.
  expect((await putHighlight(r.id, sid, mp4(HIGHLIGHT_BODY_LIMIT + 1))).json()).toEqual(errorBody('HIGHLIGHT_TOO_LARGE', 'Highlight tối đa 10 MB'));

  // Đúng bodyLimit thì tới service: server chưa boost → "tối đa 10 MB"; đúng giới hạn hiện hành thì nhận.
  const atLimit = await putHighlight(r.id, sid, mp4(HIGHLIGHT_BODY_LIMIT));
  expect(atLimit.statusCode).toBe(400);
  expect(atLimit.json()).toEqual(errorBody('HIGHLIGHT_TOO_LARGE', 'Highlight tối đa 10 MB'));
  expect(notifier.highlights).toEqual([]);
  expect((await putHighlight(r.id, sid, mp4(10 * MIB))).statusCode).toBe(200);

  notifier.uploadLimit = 50 * MIB;
  expect((await putHighlight(r.id, sid, mp4(50 * MIB + 1))).json()).toEqual(errorBody('HIGHLIGHT_TOO_LARGE', 'Highlight tối đa 50 MB'));
  expect((await putHighlight(r.id, sid, mp4(50 * MIB))).statusCode).toBe(200);
  expect(notifier.highlights).toHaveLength(2);
  expect(notifier.highlights[1]?.data.length).toBe(50 * MIB);
});

test("not logged in → 401; another member's report → 404; processed, disabled or Discord down → service errors", async () => {
  const { sid } = await memberWithSid();
  const { sid: otherSid } = await memberWithSid({ displayName: 'Bình' });
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod', displayName: 'Mod' });
  const r = await submit(sid, 5);

  const anon = await putHighlight(r.id, undefined, mp4());
  expect(anon.statusCode).toBe(401);
  expect(anon.json()).toEqual(UNAUTHENTICATED);

  // Của người khác → như không có (mod cũng không thêm hộ); id lạ → 404; id hỏng → 400.
  const foreign = await putHighlight(r.id, otherSid, mp4());
  expect(foreign.statusCode).toBe(404);
  expect(foreign.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
  expect((await putHighlight(r.id, modSid, mp4())).statusCode).toBe(404);
  expect((await putHighlight(999, sid, mp4())).statusCode).toBe(404);
  for (const id of ['abc', '0', '-1', '1.5']) {
    const bad = await putHighlight(id, sid, mp4());
    expect(bad.statusCode, id).toBe(400);
    expect(bad.json(), id).toEqual(INVALID);
  }

  expect((await review(modSid, r.id, { approve: true })).statusCode).toBe(204);
  const processed = await putHighlight(r.id, sid, mp4());
  expect(processed.statusCode).toBe(409);
  expect(processed.json()).toEqual(errorBody('NOT_PENDING', 'Lần khai này đã được xử lý'));

  const r2 = await submit(sid, 4);
  silenceConsoleError();
  notifier.down = true;
  const down = await putHighlight(r2.id, sid, mp4());
  expect(down.statusCode).toBe(503);
  expect(down.json()).toEqual(errorBody('DISCORD_UNAVAILABLE', 'Không đăng được highlight lên Discord, thử lại sau'));
  notifier.down = false;

  ctx.config.discord.highlightChannelId = null;
  const off = await putHighlight(r2.id, sid, mp4());
  expect(off.statusCode).toBe(409);
  expect(off.json()).toEqual(errorBody('HIGHLIGHT_DISABLED', 'Chưa bật tính năng highlight'));

  expect(notifier.highlights).toEqual([]);
  expect(await reportRow(r.id)).toMatchObject({ status: 'approved', highlightChannelId: null, highlightMessageId: null });
  expect(await reportRow(r2.id)).toMatchObject({ highlightChannelId: null, highlightMessageId: null });
});

test('highlight uploads have their own rate-limit bucket: 6 per 10 minutes per IP', async () => {
  const { sid } = await memberWithSid();
  const r = await submit(sid, 5);
  const ip = '203.0.113.7';

  for (let i = 0; i < 6; i += 1) {
    expect((await putHighlight(r.id, sid, mp4(), 'video/mp4', ip)).statusCode, `lần ${i + 1}`).toBe(200);
  }
  const limited = await putHighlight(r.id, sid, mp4(), 'video/mp4', ip);
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toEqual(errorBody('RATE_LIMITED', 'Bạn thao tác quá nhanh, thử lại sau'));
  expect(notifier.highlights).toHaveLength(6);

  // Bucket riêng: route khác từ IP đó vẫn chạy (chưa đụng 120/phút chung); IP khác vẫn tải được.
  expect((await app.inject({ url: '/api/reports/highlight-config', cookies: { ggd_sid: sid }, remoteAddress: ip })).statusCode).toBe(200);
  expect((await app.inject({ url: '/api/reports/mine', cookies: { ggd_sid: sid }, remoteAddress: ip })).statusCode).toBe(200);
  expect((await putHighlight(r.id, sid, mp4(), 'video/mp4', '203.0.113.8')).statusCode).toBe(200);
});

// ---------------------------------------------------------------------------
// Highlight: giới hạn bộ nhớ (số lần tải cùng lúc, chặn sớm theo Content-Length)
// ---------------------------------------------------------------------------

test('at most two highlight uploads run at once: a third → 503 HIGHLIGHT_BUSY; a finished upload frees its slot', async () => {
  const { sid } = await memberWithSid();
  const r = await submit(sid, 5);
  const posts = holdHighlightPosts();

  const first = putHighlight(r.id, sid, mp4());
  const second = putHighlight(r.id, sid, mp4());
  await posts.reached(2);

  const third = await putHighlight(r.id, sid, mp4());
  expect(third.statusCode).toBe(503);
  expect(third.json()).toEqual(HIGHLIGHT_BUSY);
  // Người lạ không bao giờ tới bước lấy chỗ: vẫn 401 dù đang đầy.
  const anon = await putHighlight(r.id, undefined, mp4());
  expect(anon.statusCode).toBe(401);
  expect(anon.json()).toEqual(UNAUTHENTICATED);
  expect(notifier.highlights).toHaveLength(2);

  // Một lần xong → chỗ được trả: lần tải mới vào được tới Discord, lần sau nữa lại bận.
  posts.release(0);
  expect((await first).statusCode).toBe(200);
  const fourth = putHighlight(r.id, sid, mp4());
  await posts.reached(3);
  expect((await putHighlight(r.id, sid, mp4())).json()).toEqual(HIGHLIGHT_BUSY);

  posts.stop();
  expect((await second).statusCode).toBe(200);
  expect((await fourth).statusCode).toBe(200);
  expect(notifier.highlights).toHaveLength(3);
  // Lỗi (file giả) cũng trả chỗ: hai lần tải lỗi liền nhau rồi vẫn tải được.
  expect((await putHighlight(r.id, sid, 'hello')).json()).toEqual(INVALID_HIGHLIGHT);
  expect((await putHighlight(r.id, sid, 'hello')).json()).toEqual(INVALID_HIGHLIGHT);
  expect((await putHighlight(r.id, sid, mp4())).statusCode).toBe(200);
});

test('a declared Content-Length over the current limit (+64 KiB) → HIGHLIGHT_TOO_LARGE before the body is read', async () => {
  const { sid } = await memberWithSid();
  const r = await submit(sid, 5);

  const early = await putHighlightBodyless(r.id, sid, 10 * MIB + 64 * 1024 + 1);
  expect(early.statusCode).toBe(400);
  expect(early.json()).toEqual(errorBody('HIGHLIGHT_TOO_LARGE', 'Highlight tối đa 10 MB'));

  // Server được boost cấp 2: chặn sớm theo giới hạn 50 MB.
  notifier.uploadLimit = 50 * MIB;
  const boosted = await putHighlightBodyless(r.id, sid, 50 * MIB + 64 * 1024 + 1);
  expect(boosted.json()).toEqual(errorBody('HIGHLIGHT_TOO_LARGE', 'Highlight tối đa 50 MB'));

  expect(notifier.highlights).toEqual([]);
  expect(await reportRow(r.id)).toMatchObject({ highlightChannelId: null, highlightMessageId: null });
});

test('feature off → HIGHLIGHT_DISABLED before the body is read', async () => {
  const { sid } = await memberWithSid();
  const r = await submit(sid, 5);
  ctx.config.discord.highlightChannelId = null;

  const off = await putHighlightBodyless(r.id, sid, 64);
  expect(off.statusCode).toBe(409);
  expect(off.json()).toEqual(errorBody('HIGHLIGHT_DISABLED', 'Chưa bật tính năng highlight'));
  expect(notifier.highlights).toEqual([]);
});

test('a client that disconnects mid-upload gives its slot back; one that leaves during the Discord post holds it until the post ends', async () => {
  const { sid } = await memberWithSid();
  const r = await submit(sid, 5);
  const posts = holdHighlightPosts();
  // Cổng của route hỏi giới hạn tải lên trước khi lấy chỗ: đếm số lần gọi để biết một request đã qua cổng.
  const limitCalls = vi.spyOn(notifier, 'highlightUploadLimit');
  const slotFree = () =>
    vi.waitFor(async () => expect((await putHighlight(r.id, sid, 'hello')).json()).toEqual(INVALID_HIGHLIGHT), { timeout: 3000, interval: 20 });

  // Một lần tải giữ chỗ thứ nhất suốt test.
  const held = putHighlight(r.id, sid, mp4());
  await posts.reached(1);

  // (a) Ngắt khi body mới gửi một phần: chỗ thứ hai được trả.
  const callsBefore = limitCalls.mock.calls.length;
  const partial = await rawHighlightRequest(r.id, sid, 1000);
  partial.write(mp4()); // 64 trên 1000 byte đã khai
  await vi.waitFor(() => expect(limitCalls.mock.calls.length).toBeGreaterThan(callsBefore), { timeout: 3000, interval: 10 });
  expect((await putHighlight(r.id, sid, mp4())).json()).toEqual(HIGHLIGHT_BUSY);
  partial.destroy();
  await slotFree();

  // (b) Gửi đủ body rồi ngắt khi bot đang đăng lên Discord: file vẫn nằm trong bộ nhớ nên chỗ còn giữ…
  const file = mp4();
  const whole = await rawHighlightRequest(r.id, sid, file.length);
  whole.write(file);
  await posts.reached(2);
  whole.destroy();
  await once(whole, 'close');
  expect((await putHighlight(r.id, sid, mp4())).json()).toEqual(HIGHLIGHT_BUSY);
  // …tới khi lần đăng đó xong (dù không còn ai nhận phản hồi).
  posts.release(1);
  await slotFree();

  // Mỗi chỗ trả đúng một lần: thả lần đầu, rồi lại đúng hai lần tải chạy cùng lúc, lần thứ ba bận.
  posts.release(0);
  expect((await held).statusCode).toBe(200);
  const again = [putHighlight(r.id, sid, mp4()), putHighlight(r.id, sid, mp4())];
  await posts.reached(4);
  expect((await putHighlight(r.id, sid, mp4())).json()).toEqual(HIGHLIGHT_BUSY);
  posts.releaseAll();
  for (const res of await Promise.all(again)) expect(res.statusCode).toBe(200);
});
