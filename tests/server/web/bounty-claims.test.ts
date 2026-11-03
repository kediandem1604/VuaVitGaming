import type { GameSession, Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { createBounty } from '../../../src/server/modules/bounties/admin.js';
import type { BountyClaimDto, SessionBountiesDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import type { FakeNotifier } from '../../helpers/fakes.js';
import { createMember, createSession } from '../../helpers/factories.js';

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
let mod: Member;
let player: Member;
let session: GameSession;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier } = makeTestCtx());
  app = await buildApp(ctx, { oauth });
  await app.ready();
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  player = await createMember(testDb, { displayName: 'An' });
  // 21:00 ngày 22/10 giờ VN — cùng ngày với giờ test mặc định.
  session = await createSession(testDb, { createdById: mod.id });
  await testDb.attendance.create({ data: { sessionId: session.id, memberId: player.id, status: 'going' } });
});

afterEach(async () => {
  await app.close();
});

async function sidFor(member: Member): Promise<string> {
  const s = await createWebSession(ctx, member.id);
  return app.signCookie(s.id);
}

/** POST luôn gửi JSON (`{}` khi không có body) — app chỉ nhận dữ liệu JSON cho route ghi. */
const send = (method: 'GET' | 'POST', url: string, sid?: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    cookies: sid ? { ggd_sid: sid } : {},
    ...(payload === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) }),
  });

async function bountyId(title = 'Bồ Nông nuốt hết vịt'): Promise<number> {
  return (await createBounty(ctx, mod.id, { title, points: 5, roleId: null, sessionId: null })).id;
}

test('member routes need a login; admin routes need a mod', async () => {
  const id = await bountyId();
  expect((await send('GET', `/api/sessions/${session.id}/bounties`)).statusCode).toBe(401);
  expect((await send('POST', `/api/sessions/${session.id}/bounties/${id}/claim`, undefined, {})).statusCode).toBe(401);
  expect((await send('GET', '/api/bounty-claims/mine')).statusCode).toBe(401);
  const sid = await sidFor(player);
  expect((await send('GET', '/api/admin/bounty-claims?status=pending', sid)).statusCode).toBe(403);
  expect((await send('POST', '/api/admin/bounty-claims/1/review', sid, { approve: true })).statusCode).toBe(403);
  expect((await send('POST', '/api/admin/bounty-claims/1/revoke', sid, { reason: 'x' })).statusCode).toBe(403);
});

test('a player sees the session bounties, claims one and finds it in their list', async () => {
  const id = await bountyId();
  const sid = await sidFor(player);

  const before = await send('GET', `/api/sessions/${session.id}/bounties`, sid);
  expect(before.statusCode).toBe(200);
  expect(before.json<SessionBountiesDto>()).toMatchObject({ sessionId: session.id, open: true, bounties: [{ id }], myClaims: [] });

  const claimed = await send('POST', `/api/sessions/${session.id}/bounties/${id}/claim`, sid, {});
  expect(claimed.statusCode).toBe(201);
  const dto = claimed.json<BountyClaimDto>();
  expect(dto).toMatchObject({ bounty: { id }, status: 'pending', source: 'web', points: 5 });

  const again = await send('POST', `/api/sessions/${session.id}/bounties/${id}/claim`, sid, {});
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual({ error: { code: 'BOUNTY_ALREADY_CLAIMED', message: 'Bạn đã nhận mục này ở buổi này rồi' } });

  expect((await send('GET', `/api/sessions/${session.id}/bounties`, sid)).json<SessionBountiesDto>().myClaims).toEqual([dto]);
  const mine = await send('GET', '/api/bounty-claims/mine?limit=10', sid);
  expect(mine.json<BountyClaimDto[]>().map((c) => c.id)).toEqual([dto.id]);
});

test('a member who never joined the session sees the button state and can claim (owner decision 2026-10-30)', async () => {
  const id = await bountyId();
  const stranger = await sidFor(await createMember(testDb));
  const card = await send('GET', `/api/sessions/${session.id}/bounties`, stranger);
  expect(card.json<SessionBountiesDto>()).toMatchObject({ open: true, myClaims: [] });
  const res = await send('POST', `/api/sessions/${session.id}/bounties/${id}/claim`, stranger, {});
  expect(res.statusCode).toBe(201);
  expect(res.json<BountyClaimDto>()).toMatchObject({ bounty: { id }, status: 'pending', source: 'web' });

  // Đã bấm Tham gia rồi huỷ cũng nhận được.
  const left = await createMember(testDb);
  await testDb.attendance.create({ data: { sessionId: session.id, memberId: left.id, status: 'cancelled' } });
  const viaCancelled = await send('POST', `/api/sessions/${session.id}/bounties/${id}/claim`, await sidFor(left), {});
  expect(viaCancelled.statusCode).toBe(201);
});

test('claim errors come back with their Vietnamese message; odd ids are 404', async () => {
  const id = await bountyId();
  const sid = await sidFor(player);
  const res = await send('POST', `/api/sessions/${session.id}/bounties/999999/claim`, sid, {});
  expect(res.statusCode).toBe(400);
  expect(res.json()).toEqual({ error: { code: 'BOUNTY_NOT_APPLICABLE', message: 'Mục treo thưởng không áp dụng cho buổi này' } });

  expect((await send('POST', `/api/sessions/${session.id}/bounties/abc/claim`, sid, {})).statusCode).toBe(404);
  expect((await send('POST', `/api/sessions/0/bounties/${id}/claim`, sid, {})).statusCode).toBe(404);
  expect((await send('GET', '/api/sessions/abc/bounties', sid)).statusCode).toBe(404);
  expect((await send('GET', '/api/sessions/999999/bounties', sid)).statusCode).toBe(404);
});

test('mods list, approve, reject and revoke claims', async () => {
  const sid = await sidFor(player);
  const modSid = await sidFor(mod);
  const x = (await send('POST', `/api/sessions/${session.id}/bounties/${await bountyId('X')}/claim`, sid, {})).json<BountyClaimDto>();
  const y = (await send('POST', `/api/sessions/${session.id}/bounties/${await bountyId('Y')}/claim`, sid, {})).json<BountyClaimDto>();

  const pending = await send('GET', '/api/admin/bounty-claims?status=pending', modSid);
  expect(pending.json<BountyClaimDto[]>().map((c) => c.id)).toEqual([x.id, y.id]);

  expect((await send('POST', `/api/admin/bounty-claims/${x.id}/review`, modSid, { approve: true })).statusCode).toBe(204);
  const noReason = await send('POST', `/api/admin/bounty-claims/${y.id}/review`, modSid, { approve: false });
  expect(noReason.statusCode).toBe(400);
  expect(noReason.json()).toEqual({ error: { code: 'REASON_REQUIRED', message: 'Cần ghi lý do từ chối' } });
  expect((await send('POST', `/api/admin/bounty-claims/${y.id}/review`, modSid, { approve: false, reason: 'Sai' })).statusCode).toBe(204);
  expect(notifier.bountyCompletions).toEqual([{ memberName: 'An', bountyTitle: 'X', points: 5 }]);

  const approved = await send('GET', '/api/admin/bounty-claims?status=approved', modSid);
  expect(approved.json<BountyClaimDto[]>()).toMatchObject([{ id: x.id, status: 'approved', reviewedBy: { id: mod.id } }]);

  expect((await send('POST', `/api/admin/bounty-claims/${x.id}/revoke`, modSid, { reason: 'Gian lận' })).statusCode).toBe(204);
  const twice = await send('POST', `/api/admin/bounty-claims/${x.id}/revoke`, modSid, { reason: 'Gian lận' });
  expect(twice.statusCode).toBe(409);
  expect(twice.json()).toMatchObject({ error: { code: 'NOT_APPROVED' } });
});

test('admin bodies and queries are strict', async () => {
  const modSid = await sidFor(mod);
  expect((await send('GET', '/api/admin/bounty-claims', modSid)).statusCode).toBe(400);
  expect((await send('GET', '/api/admin/bounty-claims?status=rejected', modSid)).statusCode).toBe(400);
  expect((await send('POST', '/api/admin/bounty-claims/1/review', modSid, { approve: true, extra: 1 })).statusCode).toBe(400);
  expect((await send('POST', '/api/admin/bounty-claims/1/revoke', modSid, {})).statusCode).toBe(400);
  expect((await send('POST', '/api/admin/bounty-claims/abc/review', modSid, { approve: true })).statusCode).toBe(404);
  expect((await send('POST', '/api/admin/bounty-claims/999999/review', modSid, { approve: true })).statusCode).toBe(404);
});
