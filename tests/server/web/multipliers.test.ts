import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { dateOnlyToDb } from '../../../src/server/lib/time.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import type { AdminMultiplierDayDto, MultiplierDayDto } from '../../../src/shared/api-types.js';
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

const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, sid?: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    cookies: sid ? { ggd_sid: sid } : {},
    ...(payload === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) }),
  });

test('the multiplier-days admin API is for admins only (mods get 403)', async () => {
  const memberSid = await sidFor(await createMember(testDb));
  const modSid = await sidFor(await createMember(testDb, { accessLevel: 'mod' }));
  const body = { day: '2026-10-24', multiplier: 2 };
  expect((await send('GET', '/api/admin/multiplier-days')).statusCode).toBe(401);
  for (const sid of [memberSid, modSid]) {
    for (const [method, url] of [
      ['GET', '/api/admin/multiplier-days'],
      ['POST', '/api/admin/multiplier-days'],
      ['PATCH', '/api/admin/multiplier-days/1'],
      ['DELETE', '/api/admin/multiplier-days/1'],
    ] as const) {
      const res = await send(method, url, sid, method === 'GET' || method === 'DELETE' ? undefined : body);
      expect(res.statusCode).toBe(403);
    }
  }
  expect(await testDb.scoreMultiplierDay.count()).toBe(0);
});

test('admins create, list, edit and delete multiplier days; errors carry the spec texts', async () => {
  const admin = await createMember(testDb, { accessLevel: 'admin' });
  const sid = await sidFor(admin);

  const created = await send('POST', '/api/admin/multiplier-days', sid, { day: '2026-10-24', multiplier: 3, message: 'Vui' });
  expect(created.statusCode).toBe(201);
  const dto = created.json<AdminMultiplierDayDto>();
  expect(dto).toEqual({ id: expect.any(Number), day: '2026-10-24', multiplier: 3, message: 'Vui', past: false });
  expect(notifier.announcements).toEqual(['🔥 Thứ Bảy 24/10: điểm cộng ×3!\nVui']);

  const dup = await send('POST', '/api/admin/multiplier-days', sid, { day: '2026-10-24', multiplier: 2 });
  expect(dup.statusCode).toBe(409);
  expect(dup.json()).toEqual({ error: { code: 'MULTIPLIER_DAY_TAKEN', message: 'Ngày này đã có hệ số nhân' } });
  const past = await send('POST', '/api/admin/multiplier-days', sid, { day: '2026-10-21', multiplier: 2 });
  expect(past.statusCode).toBe(400);
  expect(past.json().error.message).toBe('Chỉ đặt được cho hôm nay hoặc sau này');
  const range = await send('POST', '/api/admin/multiplier-days', sid, { day: '2026-10-25', multiplier: 6 });
  expect(range.statusCode).toBe(400);
  expect(range.json().error.message).toBe('Hệ số phải từ ×2 đến ×5');
  // Hệ số không phải số (chuỗi, null, thiếu) cũng báo đúng câu của hệ số.
  for (const body of [{ day: '2026-10-25', multiplier: '3' }, { day: '2026-10-25', multiplier: null }, { day: '2026-10-25' }]) {
    const bad = await send('POST', '/api/admin/multiplier-days', sid, body);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toBe('Hệ số phải từ ×2 đến ×5');
  }
  const long = await send('POST', '/api/admin/multiplier-days', sid, { day: '2026-10-25', multiplier: 2, message: 'x'.repeat(101) });
  expect(long.json().error.message).toBe('Lời nhắn tối đa 100 ký tự');
  // Body strict: khoá lạ → 400.
  expect((await send('POST', '/api/admin/multiplier-days', sid, { day: '2026-10-25', multiplier: 2, extra: 1 })).statusCode).toBe(400);

  const edited = await send('PATCH', `/api/admin/multiplier-days/${dto.id}`, sid, { multiplier: 5 });
  expect(edited.statusCode).toBe(200);
  expect(edited.json<AdminMultiplierDayDto>()).toMatchObject({ multiplier: 5, message: 'Vui' });
  const badPatch = await send('PATCH', `/api/admin/multiplier-days/${dto.id}`, sid, { multiplier: '3' });
  expect(badPatch.statusCode).toBe(400);
  expect(badPatch.json().error.message).toBe('Hệ số phải từ ×2 đến ×5');

  const list = await send('GET', '/api/admin/multiplier-days', sid);
  expect(list.statusCode).toBe(200);
  expect(list.json<AdminMultiplierDayDto[]>().map((d) => [d.day, d.multiplier, d.past])).toEqual([['2026-10-24', 5, false]]);

  expect((await send('DELETE', `/api/admin/multiplier-days/${dto.id}`, sid)).statusCode).toBe(204);
  expect((await send('DELETE', `/api/admin/multiplier-days/${dto.id}`, sid)).statusCode).toBe(404);
  expect((await send('PATCH', '/api/admin/multiplier-days/abc', sid, { multiplier: 2 })).statusCode).toBe(404);

  // Ngày đã qua: khoá.
  const old = await testDb.scoreMultiplierDay.create({ data: { day: dateOnlyToDb('2026-10-20'), multiplier: 2, createdById: admin.id } });
  const locked = await send('DELETE', `/api/admin/multiplier-days/${old.id}`, sid);
  expect(locked.statusCode).toBe(409);
  expect(locked.json().error.message).toBe('Ngày đã qua không sửa/xoá được');
});

test('members read upcoming multiplier days nearest first', async () => {
  expect((await send('GET', '/api/multiplier-days/upcoming')).statusCode).toBe(401);
  const admin = await createMember(testDb, { accessLevel: 'admin' });
  const memberSid = await sidFor(await createMember(testDb));
  for (const [day, multiplier] of [
    ['2026-10-30', 4],
    ['2026-10-20', 2],
    ['2026-10-22', 3],
  ] as const) {
    await testDb.scoreMultiplierDay.create({ data: { day: dateOnlyToDb(day), multiplier, createdById: admin.id } });
  }
  const res = await send('GET', '/api/multiplier-days/upcoming', memberSid);
  expect(res.statusCode).toBe(200);
  expect(res.json<MultiplierDayDto[]>()).toEqual([
    { id: expect.any(Number), day: '2026-10-22', multiplier: 3, message: null },
    { id: expect.any(Number), day: '2026-10-30', multiplier: 4, message: null },
  ]);
});
