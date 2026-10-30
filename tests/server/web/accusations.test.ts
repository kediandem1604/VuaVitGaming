import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { FactionTotalsDto, StandaloneAccusationDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, roleByKey } from '../../helpers/factories.js';
import type { FakeNotifier } from '../../helpers/fakes.js';

const oauth: OAuthClient = {
  authorizeUrl: () => 'https://discord.test/authorize',
  exchange: async () => {
    throw new Error('không dùng');
  },
};

let ctx: Ctx;
let notifier: FakeNotifier;
let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier } = makeTestCtx());
  app = await buildApp(ctx, { oauth });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

async function sidFor(member: Member): Promise<string> {
  const session = await createWebSession(ctx, member.id);
  return app.signCookie(session.id);
}
const memberWithSid = async (p: Parameters<typeof createMember>[1] = {}) => {
  const member = await createMember(testDb, p);
  return { member, sid: await sidFor(member) };
};
const get = (url: string, sid?: string) => app.inject({ url, cookies: sid ? { ggd_sid: sid } : {} });
const post = (url: string, sid: string | undefined, payload?: unknown) =>
  app.inject({
    method: 'POST',
    url,
    cookies: sid ? { ggd_sid: sid } : {},
    headers: { 'content-type': 'application/json' },
    payload: payload === undefined ? '' : JSON.stringify(payload),
  });
const errorBody = (code: string, message: string) => ({ error: { code, message } });

test('standalone accusations over HTTP: submit, mine, admin queue, review, recent, revoke; shapes and permissions', async () => {
  const vigilante = await roleByKey(testDb, 'vigilante');
  const { member: an, sid } = await memberWithSid({ displayName: 'An' });
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod', displayName: 'Mod' });
  const binh = await createMember(testDb, { displayName: 'Bình', discordId: 'binh-discord' });
  const cuong = await createMember(testDb, { displayName: 'Cường' });
  // Giờ mặc định của ctx test: 19:00 ngày 22/10 giờ VN.
  const body = { playedOn: '2026-10-22', accusedId: binh.id, accusedRoleId: vigilante.id, victimId: cuong.id, victimFaction: 'goose', note: 'clip' };

  expect((await post('/api/accusations', undefined, body)).statusCode).toBe(401);
  const created = await post('/api/accusations', sid, body);
  expect(created.statusCode, created.body).toBe(201);
  const dto = created.json<StandaloneAccusationDto>();
  expect(dto).toMatchObject({ status: 'pending', reporter: { id: an.id }, accused: { displayName: 'Bình' }, playedOn: '2026-10-22', note: 'clip', session: null });

  // Sai dạng → lỗi chung; sai luật → lời nhắn của service.
  expect((await post('/api/accusations', sid, { ...body, playedOn: '22/10' })).json()).toEqual(errorBody('VALIDATION', 'Dữ liệu không hợp lệ'));
  expect((await post('/api/accusations', sid, { ...body, extra: true })).statusCode).toBe(400);
  expect((await post('/api/accusations', sid, { ...body, accusedId: an.id })).json()).toEqual(errorBody('VALIDATION', 'Không thể tự báo cáo chính mình'));

  const mine = (await get('/api/accusations/mine', sid)).json<StandaloneAccusationDto[]>();
  expect(mine.map((a) => a.id)).toEqual([dto.id]);
  expect((await get('/api/accusations/mine?limit=0', sid)).statusCode).toBe(400);

  // Quản trị: thành viên thường bị chặn; trạng thái lạ → 400.
  expect((await get('/api/admin/accusations?status=pending', sid)).statusCode).toBe(403);
  expect((await get('/api/admin/accusations?status=rejected', modSid)).statusCode).toBe(400);
  expect((await get('/api/admin/accusations?status=pending', modSid)).json<StandaloneAccusationDto[]>().map((a) => a.id)).toEqual([dto.id]);

  expect((await post(`/api/admin/accusations/${dto.id}/review`, sid, { approve: true })).statusCode).toBe(403);
  expect((await post('/api/admin/accusations/abc/review', modSid, { approve: true })).statusCode).toBe(404);
  expect((await post(`/api/admin/accusations/${dto.id}/review`, modSid, { approve: false })).json()).toEqual(
    errorBody('REASON_REQUIRED', 'Cần ghi lý do từ chối'),
  );
  expect((await post(`/api/admin/accusations/${dto.id}/review`, modSid, { approve: true })).statusCode).toBe(204);
  expect(notifier.dms).toContainEqual({ discordId: 'binh-discord', text: 'Bạn bị trừ 3 điểm (Dân phòng) ngày 22/10: bị báo cáo bắn Cường (phe Ngỗng).' });
  expect((await get('/api/admin/accusations?status=pending', modSid)).json()).toEqual([]);
  const recent = (await get('/api/admin/accusations?status=approved', modSid)).json<StandaloneAccusationDto[]>();
  expect(recent).toEqual([expect.objectContaining({ id: dto.id, status: 'approved', reviewedBy: expect.objectContaining({ displayName: 'Mod' }) })]);

  // +1 cho An ở "Cả 3 phe".
  const totals = (await get('/api/leaderboard/totals?season=2026-10', sid)).json<FactionTotalsDto>();
  expect(totals.boards.all.me).toMatchObject({ displayName: 'An', points: 1 });

  expect((await post(`/api/admin/accusations/${dto.id}/revoke`, modSid, {})).statusCode).toBe(400);
  expect((await post(`/api/admin/accusations/${dto.id}/revoke`, modSid, { reason: 'Nhầm' })).statusCode).toBe(204);
  expect((await get('/api/accusations/mine', sid)).json<StandaloneAccusationDto[]>()[0]).toMatchObject({ status: 'revoked', rejectReason: 'Nhầm' });
  expect((await post(`/api/admin/accusations/${dto.id}/revoke`, modSid, { reason: 'Nhầm' })).json()).toEqual(
    errorBody('NOT_APPROVED', 'Báo cáo không còn ở trạng thái đã duyệt'),
  );
});
