import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { castVote } from '../../../src/server/modules/mvp/votes.js';
import type { AwardCategoryDto, EndOptionDto, HallOfDayDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, createSession as insertSession } from '../../helpers/factories.js';
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
let app: FastifyInstance;
/** Giờ tham gia tăng dần theo thứ tự gọi `join` trong một test. */
let joinCounter = 0;

beforeEach(async () => {
  await resetDb();
  joinCounter = 0;
  ({ ctx, notifier } = makeTestCtx());
  app = await buildApp(ctx, { oauth });
  await app.ready();
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

const category = (name: string) => testDb.awardCategory.findFirstOrThrow({ where: { name } });
const modeByKey = (key: string) => testDb.gameMode.findUniqueOrThrow({ where: { key } });
const sessionRow = (id: number) => testDb.gameSession.findUniqueOrThrow({ where: { id } });
const roundOf = (sessionId: number) => testDb.voteRound.findUniqueOrThrow({ where: { sessionId } });

/** Điểm danh `going` thẳng trong DB; giờ tham gia theo thứ tự gọi. */
async function join(sessionId: number, memberId: number): Promise<void> {
  joinCounter += 1;
  await testDb.attendance.create({
    data: { sessionId, memberId, status: 'going', updatedAt: new Date(Date.UTC(2026, 9, 22, 11, 0, joinCounter)) },
  });
}

/** Buổi classic 21:00 22/10 có người tham gia tên `names`, theo thứ tự. */
async function sessionWith(names: string[]) {
  const session = await insertSession(testDb);
  const members: Member[] = [];
  for (const displayName of names) {
    const m = await createMember(testDb, { displayName });
    await join(session.id, m.id);
    members.push(m);
  }
  return { session, members };
}

const SEEDED_NAMES = [
  'Giết nhiều nhất',
  'Pha xử lý ngu nhất',
  'Pha dí người ngu nhất',
  'Ngỗng chạy giỏi nhất',
  'Pha đẻ trứng lộ liễu nhất (Cò gáy)',
  'Pha chém lố nhất (Kiếm sĩ)',
];

// ---------------------------------------------------------------------------
// Phân quyền
// ---------------------------------------------------------------------------

test('member cannot end session or use any other admin route; anonymous gets 401', async () => {
  const { sid } = await memberWithSid();
  const { session: s } = await sessionWith(['An']);
  const kills = await category('Giết nhiều nhất');

  const calls = [
    (who?: string) => get(`/api/admin/sessions/${s.id}/end-options`, who),
    (who?: string) => post(`/api/admin/sessions/${s.id}/end`, who, { categoryIds: [kills.id] }),
    (who?: string) => post('/api/admin/vote-rounds/1/close', who),
    (who?: string) => get('/api/admin/categories', who),
    (who?: string) => post('/api/admin/categories', who, { scope: 'always', name: 'Lậu' }),
    (who?: string) => patch(`/api/admin/categories/${kills.id}`, who, { name: 'Lậu' }),
  ];
  for (const call of calls) {
    const forbidden = await call(sid);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual(FORBIDDEN);
    expect((await call()).statusCode).toBe(401);
  }

  // Không gì thay đổi.
  expect((await sessionRow(s.id)).status).toBe('scheduled');
  expect(await testDb.voteRound.count()).toBe(0);
  expect(await testDb.awardCategory.count()).toBe(6);
  expect((await category('Giết nhiều nhất')).id).toBe(kills.id);
  expect(notifier.votes).toHaveLength(0);
});

test('mod can end and close but cannot manage categories', async () => {
  const { sid } = await memberWithSid({ accessLevel: 'mod' });
  const { session: s } = await sessionWith(['An']);
  const kills = await category('Giết nhiều nhất');

  expect((await get(`/api/admin/sessions/${s.id}/end-options`, sid)).statusCode).toBe(200);
  expect((await post(`/api/admin/sessions/${s.id}/end`, sid, { categoryIds: [kills.id] })).statusCode).toBe(204);
  const round = await roundOf(s.id);
  expect((await post(`/api/admin/vote-rounds/${round.id}/close`, sid)).statusCode).toBe(204);
  expect((await testDb.voteRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe('closed');

  for (const res of await Promise.all([
    get('/api/admin/categories', sid),
    post('/api/admin/categories', sid, { scope: 'always', name: 'Lậu' }),
    patch(`/api/admin/categories/${kills.id}`, sid, { name: 'Lậu' }),
  ])) {
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FORBIDDEN);
  }
  expect(await testDb.awardCategory.count()).toBe(6);
  expect((await category('Giết nhiều nhất')).id).toBe(kills.id);
});

// ---------------------------------------------------------------------------
// Kết thúc buổi
// ---------------------------------------------------------------------------

test('end options list the applicable categories with preselection', async () => {
  const { sid } = await memberWithSid({ accessLevel: 'mod' });
  const goose = await insertSession(testDb, { modeKey: 'goose_hunt' });
  const classic = await insertSession(testDb);
  const seeded = await testDb.awardCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  const idOf = (name: string) => seeded.find((c) => c.name === name)?.id;

  const res = await get(`/api/admin/sessions/${goose.id}/end-options`, sid);
  expect(res.statusCode).toBe(200);
  expect(res.json<EndOptionDto[]>()).toEqual([
    { id: idOf('Giết nhiều nhất'), name: 'Giết nhiều nhất', scope: 'always', preselected: true },
    { id: idOf('Pha xử lý ngu nhất'), name: 'Pha xử lý ngu nhất', scope: 'always', preselected: true },
    { id: idOf('Pha dí người ngu nhất'), name: 'Pha dí người ngu nhất', scope: 'always', preselected: true },
    { id: idOf('Ngỗng chạy giỏi nhất'), name: 'Ngỗng chạy giỏi nhất', scope: 'mode', preselected: true },
    { id: idOf('Pha đẻ trứng lộ liễu nhất (Cò gáy)'), name: 'Pha đẻ trứng lộ liễu nhất (Cò gáy)', scope: 'optional', preselected: false },
    { id: idOf('Pha chém lố nhất (Kiếm sĩ)'), name: 'Pha chém lố nhất (Kiếm sĩ)', scope: 'optional', preselected: false },
  ]);
  // Buổi classic không có hạng mục của Săn ngỗng.
  expect((await get(`/api/admin/sessions/${classic.id}/end-options`, sid)).json<EndOptionDto[]>().map((o) => o.name)).toEqual(
    SEEDED_NAMES.filter((n) => n !== 'Ngỗng chạy giỏi nhất'),
  );

  const missing = await get('/api/admin/sessions/999/end-options', sid);
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
  expect((await get('/api/admin/sessions/abc/end-options', sid)).statusCode).toBe(400);
});

test('mod ends session with chosen categories', async () => {
  const { sid } = await memberWithSid({ accessLevel: 'mod' });
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [Member, Member];
  const egg = await category('Pha đẻ trứng lộ liễu nhất (Cò gáy)');

  const res = await post(`/api/admin/sessions/${s.id}/end`, sid, { categoryIds: [egg.id] });
  expect(res.statusCode).toBe(204);
  expect(res.body).toBe('');

  // Một hạng mục → một tin vote với mọi người có mặt; buổi kết thúc, tin buổi sửa sang "Đã kết thúc".
  expect(notifier.votes).toHaveLength(1);
  const round = await roundOf(s.id);
  expect(notifier.votes[0]).toEqual({
    roundId: round.id,
    categoryId: egg.id,
    categoryName: 'Pha đẻ trứng lộ liễu nhất (Cò gáy)',
    description: null,
    sessionLabel: 'Cổ điển (Classic) 21:00 22/10',
    closesAt: new Date('2026-10-23T00:00:00Z'),
    nominees: [
      { memberId: a.id, displayName: 'An' },
      { memberId: b.id, displayName: 'Bình' },
    ],
  });
  expect(round.status).toBe('open');
  expect(await sessionRow(s.id)).toMatchObject({ status: 'ended', endedAt: ctx.now(), discordDirty: false });
  expect(notifier.published.at(-1)).toMatchObject({ id: s.id, status: 'ended' });

  // Kết thúc lần nữa → 409, không mở thêm gì.
  const again = await post(`/api/admin/sessions/${s.id}/end`, sid, { categoryIds: [egg.id] });
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual(errorBody('SESSION_NOT_OPEN', 'Buổi chơi đã kết thúc hoặc bị huỷ'));
  expect(notifier.votes).toHaveLength(1);
});

test('end with an empty category list ends the session without a vote', async () => {
  const { sid } = await memberWithSid({ accessLevel: 'mod' });
  const { session: s } = await sessionWith(['An', 'Bình']);

  const res = await post(`/api/admin/sessions/${s.id}/end`, sid, { categoryIds: [] });
  expect(res.statusCode).toBe(204);
  expect(await sessionRow(s.id)).toMatchObject({ status: 'ended', endedAt: ctx.now() });
  expect(await testDb.voteRound.count()).toBe(0);
  expect(await testDb.voteMessage.count()).toBe(0);
  expect(notifier.votes).toHaveLength(0);
  expect(notifier.published.at(-1)).toMatchObject({ id: s.id, status: 'ended' });
});

test('end validation', async () => {
  const { sid } = await memberWithSid({ accessLevel: 'mod' });
  const { session: s } = await sessionWith(['An']);
  const runner = await category('Ngỗng chạy giỏi nhất'); // chỉ cho Săn ngỗng

  // Dạng sai → 400 chung. Thiếu `categoryIds` cũng không được (muốn mặc định thì gửi danh sách tick sẵn).
  for (const body of [
    undefined,
    {},
    { categoryIds: 'x' },
    { categoryIds: [1.5] },
    { categoryIds: [0] },
    { categoryIds: [-1] },
    { categoryIds: ['1'] },
    { categoryIds: [2_147_483_648] },
    { categoryIds: [], extra: 1 },
    { categoryIds: Array.from({ length: 26 }, (_, i) => i + 1) },
  ]) {
    const res = await post(`/api/admin/sessions/${s.id}/end`, sid, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json(), JSON.stringify(body)).toEqual(INVALID);
  }
  // Hạng mục không áp dụng cho chế độ của buổi hoặc không có → thông báo của service.
  for (const ids of [[runner.id], [9999]]) {
    const res = await post(`/api/admin/sessions/${s.id}/end`, sid, { categoryIds: ids });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(errorBody('VALIDATION', 'Hạng mục không hợp lệ'));
  }
  expect(await sessionRow(s.id)).toMatchObject({ status: 'scheduled', endedAt: null });
  expect(await testDb.voteRound.count()).toBe(0);
  expect(notifier.votes).toHaveLength(0);

  expect((await post('/api/admin/sessions/999/end', sid, { categoryIds: [] })).statusCode).toBe(404);
  expect((await post('/api/admin/sessions/abc/end', sid, { categoryIds: [] })).statusCode).toBe(400);
  const cancelled = await insertSession(testDb, { status: 'cancelled' });
  const res = await post(`/api/admin/sessions/${cancelled.id}/end`, sid, { categoryIds: [] });
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual(errorBody('SESSION_NOT_OPEN', 'Buổi chơi đã kết thúc hoặc bị huỷ'));
});

// ---------------------------------------------------------------------------
// Đóng sớm và Sảnh tri ân
// ---------------------------------------------------------------------------

test('hall of day after close', async () => {
  const { member: me, sid } = await memberWithSid();
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [Member, Member];
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');

  expect((await post(`/api/admin/sessions/${s.id}/end`, modSid, { categoryIds: [kills.id, dumb.id] })).statusCode).toBe(204);
  const round = await roundOf(s.id);
  await castVote(ctx, { roundId: round.id, categoryId: kills.id, voterId: me.id, nomineeId: a.id });
  await castVote(ctx, { roundId: round.id, categoryId: kills.id, voterId: b.id, nomineeId: a.id });

  // Vote còn mở: chưa lên sảnh, chưa có ngày nào.
  expect((await get('/api/mvp/day?date=2026-10-22', sid)).json()).toEqual({ date: '2026-10-22', sessions: [] });
  expect((await get('/api/mvp/dates', sid)).json()).toEqual([]);

  const close = await post(`/api/admin/vote-rounds/${round.id}/close`, modSid);
  expect(close.statusCode).toBe(204);
  expect(close.body).toBe('');
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.closedVotes).toHaveLength(2);

  const day = await get('/api/mvp/day?date=2026-10-22', sid);
  expect(day.statusCode).toBe(200);
  expect(day.json<HallOfDayDto>()).toEqual({
    date: '2026-10-22',
    sessions: [
      {
        sessionId: s.id,
        label: 'Cổ điển (Classic) 21:00',
        awards: [
          { categoryName: 'Giết nhiều nhất', winners: [{ memberId: a.id, displayName: 'An', avatarUrl: null, voteCount: 2 }] },
          { categoryName: 'Pha xử lý ngu nhất', winners: [] },
        ],
      },
    ],
  });
  // Không truyền ngày → hôm nay theo giờ VN (now = 19:00 22/10 VN).
  expect((await get('/api/mvp/day', sid)).json()).toEqual(day.json());
  expect((await get('/api/mvp/dates', sid)).json()).toEqual(['2026-10-22']);
  expect((await get('/api/mvp/day?date=2026-10-23', sid)).json()).toEqual({ date: '2026-10-23', sessions: [] });

  // Đóng lần nữa: vô hại (204, không thông báo lại); đợt không có → 404; id hỏng → 400.
  expect((await post(`/api/admin/vote-rounds/${round.id}/close`, modSid)).statusCode).toBe(204);
  expect(notifier.announcements).toHaveLength(1);
  const missing = await post('/api/admin/vote-rounds/999/close', modSid);
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
  expect((await post('/api/admin/vote-rounds/abc/close', modSid)).statusCode).toBe(400);
  expect((await post('/api/admin/vote-rounds/0/close', modSid)).statusCode).toBe(400);
});

test('GET /api/mvp/day with a bad date is 400; hall routes need a login', async () => {
  expect((await get('/api/mvp/day')).statusCode).toBe(401);
  expect((await get('/api/mvp/dates')).statusCode).toBe(401);

  const { sid } = await memberWithSid();
  for (const date of ['abc', '22/10/2026', '2026-10-2', '']) {
    const res = await get(`/api/mvp/day?date=${encodeURIComponent(date)}`, sid);
    expect(res.statusCode, date).toBe(400);
    expect(res.json(), date).toEqual(INVALID);
  }
  // Đúng dạng nhưng không tồn tại → thông báo của service.
  const noDay = await get('/api/mvp/day?date=2026-02-30', sid);
  expect(noDay.statusCode).toBe(400);
  expect(noDay.json()).toEqual(errorBody('VALIDATION', 'Ngày không hợp lệ'));
  // Ngày hợp lệ mà không có gì → sảnh trống.
  expect((await get('/api/mvp/day?date=2026-10-21', sid)).json()).toEqual({ date: '2026-10-21', sessions: [] });
});

// ---------------------------------------------------------------------------
// Quản trị hạng mục
// ---------------------------------------------------------------------------

test('category admin only and validated', async () => {
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const { sid } = await memberWithSid({ accessLevel: 'admin' });
  const gooseMode = await modeByKey('goose_hunt');
  const kills = await category('Giết nhiều nhất');
  const runner = await category('Ngỗng chạy giỏi nhất');

  // Mod không được tạo.
  expect((await post('/api/admin/categories', modSid, { scope: 'always', name: 'X' })).statusCode).toBe(403);

  // Danh sách: theo sortOrder, kèm chế độ chơi khi có.
  const list = await get('/api/admin/categories', sid);
  expect(list.statusCode).toBe(200);
  const categories = list.json<AwardCategoryDto[]>();
  expect(categories.map((c) => c.name)).toEqual(SEEDED_NAMES);
  expect(categories[0]).toEqual({
    id: kills.id,
    scope: 'always',
    mode: null,
    name: 'Giết nhiều nhất',
    description: null,
    active: true,
    sortOrder: 1,
    badgeGroup: 'mvp',
  });
  expect(categories[3]).toEqual({
    id: runner.id,
    scope: 'mode',
    mode: { id: gooseMode.id, key: 'goose_hunt', nameVi: 'Săn ngỗng (Goose Hunt)' },
    name: 'Ngỗng chạy giỏi nhất',
    description: null,
    active: true,
    sortOrder: 4,
    badgeGroup: 'mvp',
  });

  // Tạo: cắt khoảng trắng, sortOrder mặc định sau cùng.
  const created = await post('/api/admin/categories', sid, {
    scope: 'optional',
    name: '  Pha trốn hay nhất  ',
    description: '  Dành cho vịt  ',
  });
  expect(created.statusCode).toBe(201);
  const dto = created.json<AwardCategoryDto>();
  expect(dto).toEqual({
    id: dto.id,
    scope: 'optional',
    mode: null,
    name: 'Pha trốn hay nhất',
    description: 'Dành cho vịt',
    active: true,
    sortOrder: 7,
    badgeGroup: 'none', // không gửi → không tính cho danh hiệu
  });
  const modeCat = await post('/api/admin/categories', sid, { scope: 'mode', modeId: gooseMode.id, name: 'Vịt săn giỏi nhất', sortOrder: 2 });
  expect(modeCat.statusCode).toBe(201);
  expect(modeCat.json<AwardCategoryDto>()).toMatchObject({
    scope: 'mode',
    mode: { id: gooseMode.id, key: 'goose_hunt' },
    description: null,
    sortOrder: 2,
  });
  const modeCatId = modeCat.json<AwardCategoryDto>().id;

  // Kiểm tra dữ liệu: dạng sai → 400 chung; vi phạm quy tắc → thông báo của service.
  for (const body of [undefined, {}, { scope: 'always' }, { scope: 'weird', name: 'X' }, { scope: 'always', name: 1 }, { scope: 'always', name: 'X', extra: 1 }, { scope: 'always', name: 'X', sortOrder: 1.5 }, { scope: 'mode', modeId: 'x', name: 'X' }]) {
    const res = await post('/api/admin/categories', sid, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json(), JSON.stringify(body)).toEqual(INVALID);
  }
  const noMode = await post('/api/admin/categories', sid, { scope: 'mode', name: 'X' });
  expect(noMode.statusCode).toBe(400);
  expect(noMode.json()).toEqual(errorBody('VALIDATION', 'Hạng mục theo chế độ phải chọn chế độ chơi'));
  expect((await post('/api/admin/categories', sid, { scope: 'always', modeId: gooseMode.id, name: 'X' })).json()).toEqual(
    errorBody('VALIDATION', 'Chỉ hạng mục theo chế độ mới có chế độ chơi'),
  );
  expect((await post('/api/admin/categories', sid, { scope: 'mode', modeId: 9999, name: 'X' })).json()).toEqual(
    errorBody('VALIDATION', 'Chế độ chơi không hợp lệ'),
  );
  expect((await post('/api/admin/categories', sid, { scope: 'always', name: '   ' })).json()).toEqual(
    errorBody('VALIDATION', 'Tên hạng mục không được để trống'),
  );
  expect(await testDb.awardCategory.count()).toBe(8);

  // Sửa: ẩn hạng mục → chỉ còn trong danh sách `all=1`.
  const hidden = await patch(`/api/admin/categories/${dto.id}`, sid, { active: false, sortOrder: 0, description: '' });
  expect(hidden.statusCode).toBe(200);
  expect(hidden.json<AwardCategoryDto>()).toEqual({ ...dto, active: false, sortOrder: 0, description: null });
  expect((await get('/api/admin/categories', sid)).json<AwardCategoryDto[]>().map((c) => c.id)).not.toContain(dto.id);
  const all = (await get('/api/admin/categories?all=1', sid)).json<AwardCategoryDto[]>();
  expect(all[0]?.id).toBe(dto.id);
  expect(all).toHaveLength(8);
  expect((await get('/api/admin/categories?all=yes', sid)).statusCode).toBe(400);

  // Đổi phạm vi từ `mode` sang `always`: phải gửi kèm `modeId: null`.
  const stillMode = await patch(`/api/admin/categories/${modeCatId}`, sid, { scope: 'always' });
  expect(stillMode.statusCode).toBe(400);
  expect(stillMode.json()).toEqual(errorBody('VALIDATION', 'Chỉ hạng mục theo chế độ mới có chế độ chơi'));
  const moved = await patch(`/api/admin/categories/${modeCatId}`, sid, { scope: 'always', modeId: null });
  expect(moved.statusCode).toBe(200);
  expect(moved.json<AwardCategoryDto>()).toMatchObject({ id: modeCatId, scope: 'always', mode: null });
  // Và ngược lại.
  expect((await patch(`/api/admin/categories/${modeCatId}`, sid, { scope: 'mode' })).json()).toEqual(
    errorBody('VALIDATION', 'Hạng mục theo chế độ phải chọn chế độ chơi'),
  );
  expect((await patch(`/api/admin/categories/${modeCatId}`, sid, { scope: 'mode', modeId: gooseMode.id })).json()).toMatchObject({
    scope: 'mode',
    mode: { id: gooseMode.id },
  });

  for (const body of [{ name: 1 }, { active: 'no' }, { extra: 1 }, { modeId: 'x' }]) {
    const res = await patch(`/api/admin/categories/${kills.id}`, sid, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json(), JSON.stringify(body)).toEqual(INVALID);
  }
  expect((await patch('/api/admin/categories/999', sid, { name: 'X' })).statusCode).toBe(404);
  expect((await patch('/api/admin/categories/abc', sid, { name: 'X' })).statusCode).toBe(400);
  expect((await patch(`/api/admin/categories/${kills.id}`, modSid, { name: 'X' })).statusCode).toBe(403);
  expect((await category('Giết nhiều nhất')).id).toBe(kills.id);
});

test('category badge group is listed, stored on create, patched and validated', async () => {
  const { sid } = await memberWithSid({ accessLevel: 'admin' });

  // Danh sách: nhóm của sáu hạng mục mẫu theo tên (spec huy hiệu §4).
  const seeded = (await get('/api/admin/categories', sid)).json<AwardCategoryDto[]>();
  expect(Object.fromEntries(seeded.map((c) => [c.name, c.badgeGroup]))).toEqual({
    'Giết nhiều nhất': 'mvp',
    'Ngỗng chạy giỏi nhất': 'mvp',
    'Pha xử lý ngu nhất': 'fun',
    'Pha dí người ngu nhất': 'fun',
    'Pha đẻ trứng lộ liễu nhất (Cò gáy)': 'fun',
    'Pha chém lố nhất (Kiếm sĩ)': 'fun',
  });

  // Tạo kèm nhóm.
  const created = await post('/api/admin/categories', sid, { scope: 'optional', name: 'Pha troll vui nhất', badgeGroup: 'fun' });
  expect(created.statusCode).toBe(201);
  const dto = created.json<AwardCategoryDto>();
  expect(dto.badgeGroup).toBe('fun');
  expect((await testDb.awardCategory.findUniqueOrThrow({ where: { id: dto.id } })).badgeGroup).toBe('fun');

  // Sửa nhóm — chỉ trường đó đổi.
  const patched = await patch(`/api/admin/categories/${dto.id}`, sid, { badgeGroup: 'mvp' });
  expect(patched.statusCode).toBe(200);
  expect(patched.json<AwardCategoryDto>()).toEqual({ ...dto, badgeGroup: 'mvp' });
  expect((await testDb.awardCategory.findUniqueOrThrow({ where: { id: dto.id } })).badgeGroup).toBe('mvp');
  const listed = (await get('/api/admin/categories', sid)).json<AwardCategoryDto[]>();
  expect(listed.find((c) => c.id === dto.id)?.badgeGroup).toBe('mvp');

  // Giá trị lạ / sai kiểu → 400 chung, không ghi gì.
  for (const badgeGroup of ['khen', 'MVP', '', 1, null]) {
    const bad = await post('/api/admin/categories', sid, { scope: 'always', name: 'X', badgeGroup });
    expect(bad.statusCode, JSON.stringify(badgeGroup)).toBe(400);
    expect(bad.json(), JSON.stringify(badgeGroup)).toEqual(INVALID);
    const badPatch = await patch(`/api/admin/categories/${dto.id}`, sid, { badgeGroup });
    expect(badPatch.statusCode, JSON.stringify(badgeGroup)).toBe(400);
    expect(badPatch.json(), JSON.stringify(badgeGroup)).toEqual(INVALID);
  }
  expect(await testDb.awardCategory.count()).toBe(7);
  expect((await testDb.awardCategory.findUniqueOrThrow({ where: { id: dto.id } })).badgeGroup).toBe('mvp');
});
