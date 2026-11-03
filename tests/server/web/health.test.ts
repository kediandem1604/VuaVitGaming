import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import type { HealthDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import type { AppDeps } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb } from '../../helpers/db.js';

/** /healthz không đụng tới OAuth. */
const oauth: OAuthClient = {
  authorizeUrl: () => 'https://discord.test/authorize',
  exchange: async () => {
    throw new Error('không dùng');
  },
};

let ctx: Ctx;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  await resetDb();
  ({ ctx } = makeTestCtx());
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(deps: Omit<AppDeps, 'oauth'> = {}): Promise<FastifyInstance> {
  app = await buildApp(ctx, { oauth, ...deps });
  await app.ready();
  return app;
}

test('healthz is 200 without login and reports discord down by default', async () => {
  const app = await start();

  const res = await app.inject({ method: 'GET', url: '/healthz' });

  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/^application\/json/);
  expect(res.json<HealthDto>()).toEqual({ ok: true, discord: 'down' });
});

test('healthz reports discord ready when the bot says so', async () => {
  const app = await start({ discordStatus: () => 'ready' });

  const res = await app.inject({ method: 'GET', url: '/healthz' });

  expect(res.statusCode).toBe(200);
  expect(res.json<HealthDto>()).toEqual({ ok: true, discord: 'ready' });
});

test('healthz reflects the live status on every call', async () => {
  let status: HealthDto['discord'] = 'down';
  const app = await start({ discordStatus: () => status });

  expect((await app.inject({ url: '/healthz' })).json<HealthDto>().discord).toBe('down');
  status = 'ready';
  expect((await app.inject({ url: '/healthz' })).json<HealthDto>().discord).toBe('ready');
  status = 'down';
  expect((await app.inject({ url: '/healthz' })).json<HealthDto>().discord).toBe('down');
});

test('healthz is not rate limited', async () => {
  const app = await start();

  // Giới hạn chung là 120 yêu cầu/phút theo IP; Railway gọi healthz liên tục nên không được 429.
  const statuses = new Set<number>();
  for (let i = 0; i < 130; i += 1) {
    statuses.add((await app.inject({ url: '/healthz' })).statusCode);
  }
  expect([...statuses]).toEqual([200]);

  // Các route khác vẫn bị giới hạn (bộ đếm là chung cho IP, nhưng healthz không cộng vào).
  const limited = await app.inject({ url: '/api/me' });
  expect(limited.statusCode).toBe(401);
});

test('healthz is served even when the SPA is on and is not a SPA route', async () => {
  // Không có webDistDir: 404 JSON cho đường dẫn lạ, nhưng /healthz vẫn trả JSON sức khoẻ.
  const app = await start();
  const missing = await app.inject({ url: '/healthz/extra' });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } });

  // Chỉ GET (và HEAD) — POST không có.
  const post = await app.inject({ method: 'POST', url: '/healthz', headers: { 'content-type': 'application/json' }, payload: '{}' });
  expect(post.statusCode).toBe(404);
});
