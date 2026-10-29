import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { dateOnlyToDb } from '../../../src/server/lib/time.js';
import type { BountyDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, createSession, roleByKey } from '../../helpers/factories.js';

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
  await app.close();
});

async function sidFor(member: Member): Promise<string> {
  const session = await createWebSession(ctx, member.id);
  return app.signCookie(session.id);
}

const cookies = (sid?: string) => (sid ? { ggd_sid: sid } : {});
const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, sid?: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    cookies: cookies(sid),
    ...(payload === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) }),
  });

test('the bounties admin API is for mods and admins only', async () => {
  const memberSid = await sidFor(await createMember(testDb));
  const body = { title: 'Mục', points: 3, roleId: null, sessionId: null };
  expect((await send('GET', '/api/admin/bounties')).statusCode).toBe(401);
  for (const [method, url] of [
    ['GET', '/api/admin/bounties'],
    ['POST', '/api/admin/bounties'],
    ['PATCH', '/api/admin/bounties/1'],
    ['DELETE', '/api/admin/bounties/1'],
  ] as const) {
    const res = await send(method, url, memberSid, method === 'GET' || method === 'DELETE' ? undefined : body);
    expect(res.statusCode).toBe(403);
  }
});

test('mods create, list, edit, switch off and delete bounties', async () => {
  const mod = await createMember(testDb, { accessLevel: 'mod' });
  const modSid = await sidFor(mod);
  const adminSid = await sidFor(await createMember(testDb, { accessLevel: 'admin' }));
  const duck = await roleByKey(testDb, 'duck');
  const session = await createSession(testDb, { createdById: mod.id });

  const created = await send('POST', '/api/admin/bounties', modSid, {
    title: 'Bồ Nông nuốt hết vịt',
    description: 'cả ván',
    points: 5,
    roleId: duck.id,
    sessionId: session.id,
  });
  expect(created.statusCode).toBe(201);
  const dto = created.json<BountyDto>();
  expect(dto).toMatchObject({ title: 'Bồ Nông nuốt hết vịt', points: 5, role: { id: duck.id }, session: { id: session.id }, active: true });

  const list = await send('GET', '/api/admin/bounties', adminSid);
  expect(list.statusCode).toBe(200);
  expect(list.json<BountyDto[]>().map((x) => x.id)).toEqual([dto.id]);

  const edited = await send('PATCH', `/api/admin/bounties/${dto.id}`, modSid, { points: 8, active: false, sessionId: null });
  expect(edited.statusCode).toBe(200);
  expect(edited.json<BountyDto>()).toMatchObject({ points: 8, active: false, session: null });

  // Có lần nhận → không xoá được.
  await testDb.bountyClaim.create({
    data: { bountyId: dto.id, memberId: mod.id, sessionId: session.id, playedOn: dateOnlyToDb('2026-10-22'), roleId: duck.id, points: 5, source: 'web' },
  });
  const refused = await send('DELETE', `/api/admin/bounties/${dto.id}`, modSid);
  expect(refused.statusCode).toBe(409);
  expect(refused.json()).toEqual({ error: { code: 'BOUNTY_HAS_CLAIMS', message: 'Mục đã có lần nhận — chỉ tắt được, không xoá được' } });

  const other = (await send('POST', '/api/admin/bounties', modSid, { title: 'Khác', points: 1, roleId: null, sessionId: null })).json<BountyDto>();
  const deleted = await send('DELETE', `/api/admin/bounties/${other.id}`, modSid);
  expect(deleted.statusCode).toBe(204);
  expect((await send('DELETE', `/api/admin/bounties/${other.id}`, modSid)).statusCode).toBe(404);
});

test('bodies are strict and validated; unknown ids are 404', async () => {
  const modSid = await sidFor(await createMember(testDb, { accessLevel: 'mod' }));
  const extra = await send('POST', '/api/admin/bounties', modSid, { title: 'Mục', points: 3, roleId: null, sessionId: null, active: false });
  expect(extra.statusCode).toBe(400);
  expect(extra.json()).toMatchObject({ error: { code: 'VALIDATION' } });

  const missing = await send('POST', '/api/admin/bounties', modSid, { title: 'Mục', points: 3 });
  expect(missing.statusCode).toBe(400);

  const tooMany = await send('POST', '/api/admin/bounties', modSid, { title: 'Mục', points: 99, roleId: null, sessionId: null });
  expect(tooMany.statusCode).toBe(400);
  expect(tooMany.json()).toEqual({ error: { code: 'VALIDATION', message: 'Điểm phải từ 1 đến 50' } });

  expect((await send('PATCH', '/api/admin/bounties/abc', modSid, { points: 3 })).statusCode).toBe(404);
  expect((await send('PATCH', '/api/admin/bounties/12345', modSid, { points: 3 })).statusCode).toBe(404);
  expect((await send('PATCH', '/api/admin/bounties/12345', modSid, { createdBy: 1 })).statusCode).toBe(400);
});
