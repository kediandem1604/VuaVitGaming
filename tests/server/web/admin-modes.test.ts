import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import type { AdminModeDto, ModeDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember } from '../../helpers/factories.js';

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

const sidOf = async (accessLevel: Member['accessLevel']) => sidFor(await createMember(testDb, { accessLevel }));
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

const errorBody = (code: string, message: string) => ({ error: { code, message } });
const classic = () => testDb.gameMode.findUniqueOrThrow({ where: { key: 'classic' } });

test('modes admin API is admin only', async () => {
  const memberSid = await sidOf('member');
  const modSid = await sidOf('mod');
  const { id } = await classic();

  for (const sid of [memberSid, modSid]) {
    const read = await get('/api/admin/modes', sid);
    expect(read.statusCode).toBe(403);
    expect(read.json()).toEqual(errorBody('FORBIDDEN', 'Bạn không có quyền làm việc này'));
    const write = await patch(`/api/admin/modes/${id}`, sid, { nameVi: 'Cổ điển' });
    expect(write.statusCode).toBe(403);
  }
  expect((await get('/api/admin/modes')).statusCode).toBe(401);
  expect((await patch(`/api/admin/modes/${id}`, undefined, { nameVi: 'Cổ điển' })).statusCode).toBe(401);
  expect((await classic()).nameVi).toBe('Cổ điển (Classic)');
});

test('admins list every mode, rename it and switch it off; the public list shows active modes only', async () => {
  const adminSid = await sidOf('admin');
  const memberSid = await sidOf('member');
  const mode = await classic();
  await testDb.gameMode.update({ where: { key: 'hanging_out' }, data: { active: false } });

  const list = await get('/api/admin/modes', adminSid);
  expect(list.statusCode).toBe(200);
  const modes = list.json<AdminModeDto[]>();
  expect(modes).toHaveLength(10);
  expect(modes[0]).toEqual({ id: mode.id, key: 'classic', nameVi: 'Cổ điển (Classic)', nameEn: 'Classic', active: true });
  expect(modes.find((m) => m.key === 'hanging_out')).toMatchObject({ active: false });
  expect(modes.map((m) => m.id)).toEqual([...modes.map((m) => m.id)].sort((x, y) => x - y));

  const renamed = await patch(`/api/admin/modes/${mode.id}`, adminSid, { nameVi: '  Cổ điển  ' });
  expect(renamed.statusCode).toBe(200);
  expect(renamed.json<AdminModeDto>()).toEqual({ id: mode.id, key: 'classic', nameVi: 'Cổ điển', nameEn: 'Classic', active: true });

  const off = await patch(`/api/admin/modes/${mode.id}`, adminSid, { active: false });
  expect(off.json<AdminModeDto>()).toMatchObject({ nameVi: 'Cổ điển', active: false });
  const publicList = (await get('/api/modes', memberSid)).json<ModeDto[]>();
  expect(publicList.map((m) => m.key)).not.toContain('classic');
  expect(publicList.map((m) => m.key)).not.toContain('hanging_out');
  expect((await get('/api/admin/modes', adminSid)).json<AdminModeDto[]>()).toHaveLength(10);

  await patch(`/api/admin/modes/${mode.id}`, adminSid, { active: true, nameVi: 'Cổ điển (Classic)' });
  expect((await get('/api/modes', memberSid)).json<ModeDto[]>()[0]).toEqual({ id: mode.id, key: 'classic', nameVi: 'Cổ điển (Classic)' });
});

test('mode patch validation', async () => {
  const adminSid = await sidOf('admin');
  const { id } = await classic();
  const INVALID = errorBody('VALIDATION', 'Dữ liệu không hợp lệ');
  const NAME = errorBody('VALIDATION', 'Tên tiếng Việt phải từ 1 đến 60 ký tự');

  for (const [body, expected] of [
    [{ nameVi: '   ' }, NAME],
    [{ nameVi: 'x'.repeat(61) }, NAME],
    [{ nameVi: 5 }, INVALID],
    [{ active: 'no' }, INVALID],
    [{ key: 'other' }, INVALID],
    [{ nameEn: 'Classic 2' }, INVALID],
    [undefined, INVALID],
  ] as const) {
    const res = await patch(`/api/admin/modes/${id}`, adminSid, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json(), JSON.stringify(body)).toEqual(expected);
  }
  // 60 ký tự là biên hợp lệ; patch rỗng không đổi gì.
  expect((await patch(`/api/admin/modes/${id}`, adminSid, { nameVi: 'x'.repeat(60) })).statusCode).toBe(200);
  expect((await patch(`/api/admin/modes/${id}`, adminSid, {})).json<AdminModeDto>()).toMatchObject({ nameVi: 'x'.repeat(60) });

  const missing = await patch('/api/admin/modes/9999', adminSid, { active: false });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
  expect((await patch('/api/admin/modes/abc', adminSid, { active: false })).statusCode).toBe(400);
});
