import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import type { AdminOfflineEventDto, OfflineEventDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember } from '../../helpers/factories.js';
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

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier } = makeTestCtx());
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

const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, sid?: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    cookies: sid ? { ggd_sid: sid } : {},
    ...(payload === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) }),
  });

const body = { title: 'Cafe Ngỗng', startsAt: '2026-10-24T18:30', place: 'Quận 1' };

test('the offline admin API is for mods and admins; members get 403, guests 401', async () => {
  const memberSid = await sidFor(await createMember(testDb));
  expect((await send('GET', '/api/admin/offline-events')).statusCode).toBe(401);
  for (const [method, url] of [
    ['GET', '/api/admin/offline-events'],
    ['POST', '/api/admin/offline-events'],
    ['PATCH', '/api/admin/offline-events/1'],
    ['DELETE', '/api/admin/offline-events/1'],
  ] as const) {
    const res = await send(method, url, memberSid, method === 'GET' || method === 'DELETE' ? undefined : body);
    expect(res.statusCode).toBe(403);
  }
  expect((await send('GET', '/api/offline-events/upcoming')).statusCode).toBe(401);
  expect(await testDb.offlineEvent.count()).toBe(0);
});

test('mods create, list, edit, close and delete events; errors carry the spec texts', async () => {
  for (const level of ['mod', 'admin'] as const) {
    await resetDb();
    notifier.announcements.length = 0;
    const sid = await sidFor(await createMember(testDb, { accessLevel: level }));
    const created = await send('POST', '/api/admin/offline-events', sid, { ...body, description: 'Vui', voteDeadline: '2026-10-24T12:00' });
    expect(created.statusCode).toBe(201);
    const dto = created.json<AdminOfflineEventDto>();
    expect(dto).toMatchObject({ title: 'Cafe Ngỗng', startsAt: '2026-10-24T11:30:00.000Z', voteDeadline: '2026-10-24T05:00:00.000Z', past: false });
    expect(notifier.announcements).toHaveLength(1);

    const list = await send('GET', '/api/admin/offline-events', sid);
    expect(list.json<AdminOfflineEventDto[]>().map((e) => e.id)).toEqual([dto.id]);

    const bad = await send('POST', '/api/admin/offline-events', sid, { ...body, place: '' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: { code: 'VALIDATION', message: 'Địa điểm 1–120 ký tự' } });
    const late = await send('PATCH', `/api/admin/offline-events/${dto.id}`, sid, { voteDeadline: '2026-10-25T00:00' });
    expect(late.json()).toEqual({ error: { code: 'VALIDATION', message: 'Hạn vote phải trước giờ sự kiện' } });
    // Khoá lạ bị từ chối.
    expect((await send('POST', '/api/admin/offline-events', sid, { ...body, extra: 1 })).statusCode).toBe(400);

    const closed = await send('PATCH', `/api/admin/offline-events/${dto.id}`, sid, { closed: true });
    expect(closed.json<AdminOfflineEventDto>().closed).toBe(true);
    expect((await send('PATCH', '/api/admin/offline-events/abc', sid, { closed: true })).statusCode).toBe(404);

    expect((await send('DELETE', `/api/admin/offline-events/${dto.id}`, sid)).statusCode).toBe(204);
    expect((await send('DELETE', `/api/admin/offline-events/${dto.id}`, sid)).statusCode).toBe(404);
  }
});

test('members see upcoming events and vote; a closed event answers "Đã hết hạn vote"', async () => {
  const mod = await createMember(testDb, { accessLevel: 'mod' });
  const member = await createMember(testDb, { displayName: 'An' });
  const modSid = await sidFor(mod);
  const sid = await sidFor(member);
  const { id } = (await send('POST', '/api/admin/offline-events', modSid, body)).json<AdminOfflineEventDto>();

  const voted = await send('PUT', `/api/offline-events/${id}/vote`, sid, { going: true });
  expect(voted.statusCode).toBe(200);
  expect(voted.json<OfflineEventDto>()).toMatchObject({ id, myVote: true, open: true, going: [{ memberId: member.id, displayName: 'An' }] });

  const upcoming = await send('GET', '/api/offline-events/upcoming', sid);
  expect(upcoming.json<OfflineEventDto[]>()).toMatchObject([{ id, myVote: true }]);

  expect((await send('PUT', `/api/offline-events/${id}/vote`, sid, { going: 'yes' })).statusCode).toBe(400);
  expect((await send('PUT', `/api/offline-events/0/vote`, sid, { going: true })).statusCode).toBe(404);

  await send('PATCH', `/api/admin/offline-events/${id}`, modSid, { closed: true });
  const refused = await send('PUT', `/api/offline-events/${id}/vote`, sid, { going: false });
  expect(refused.statusCode).toBe(409);
  expect(refused.json()).toEqual({ error: { code: 'OFFLINE_VOTE_CLOSED', message: 'Đã hết hạn vote' } });
});
