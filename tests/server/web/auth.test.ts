import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import type { OAuthClient, OAuthProfile } from '../../../src/server/modules/auth/oauth.js';
import {
  createWebSession,
  deleteWebSession,
  resolveWebSession,
} from '../../../src/server/modules/auth/sessions.js';
import { markMemberLeft } from '../../../src/server/modules/members/service.js';
import type { GuildMemberInfo } from '../../../src/server/ports.js';
import { buildApp } from '../../../src/server/web/app.js';
import { requireAdmin, requireMember, requireMod } from '../../../src/server/web/auth-plugin.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember } from '../../helpers/factories.js';
import type { FakeDirectory } from '../../helpers/fakes.js';
import { patchDelegate } from '../../helpers/prisma.js';

/** OAuth giả: `profiles` ánh xạ mã → hồ sơ; mã lạ thì ném lỗi như Discord từ chối. */
class FakeOAuth implements OAuthClient {
  profiles = new Map<string, OAuthProfile>();
  exchanged: string[] = [];

  authorizeUrl(state: string): string {
    return `https://discord.test/authorize?state=${encodeURIComponent(state)}`;
  }

  async exchange(code: string): Promise<OAuthProfile> {
    this.exchanged.push(code);
    const profile = this.profiles.get(code);
    if (!profile) throw new Error('FakeOAuth: mã không hợp lệ');
    return profile;
  }
}

let ctx: Ctx;
let directory: FakeDirectory;
let setNow: (iso: string) => void;
let oauth: FakeOAuth;
let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  ({ ctx, directory, setNow } = makeTestCtx());
  oauth = new FakeOAuth();
  app = await buildApp(ctx, { oauth });
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

/** Thư mục build web giả (index.html + một file JS) cho `fn`; xoá khi xong. */
async function withWebBuild(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ggd-web-'));
  try {
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>GGD Hub</title>');
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const guildInfo = (discordId: string, roleIds: string[] = []): GuildMemberInfo => ({
  discordId,
  displayName: `User ${discordId}`,
  avatarUrl: null,
  roleIds,
});

const cookieNamed = (res: LightMyRequestResponse, name: string) => res.cookies.find((c) => c.name === name);

function mustCookie(res: LightMyRequestResponse, name: string) {
  const c = cookieNamed(res, name);
  if (!c) throw new Error(`Không có cookie ${name} trong phản hồi`);
  return c;
}

/** Đi qua callback với state khớp (cookie đã ký); trả về giá trị cookie ggd_sid (đã ký). */
async function loginAs(discordId: string, profile: Partial<OAuthProfile> = {}): Promise<string> {
  await app.ready();
  const code = `code-${discordId}`;
  oauth.profiles.set(code, { discordId, email: null, emailVerified: false, ...profile });
  const state = `state-${discordId}`;
  const res = await app.inject({
    url: `/auth/callback?code=${code}&state=${state}`,
    cookies: { ggd_oauth_state: app.signCookie(state) },
  });
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe('/');
  return mustCookie(res, 'ggd_sid').value;
}

const getMe = (sid: string) => app.inject({ url: '/api/me', cookies: { ggd_sid: sid } });

const patchMe = (sid: string, payload: unknown, contentType = 'application/json') =>
  app.inject({
    method: 'PATCH',
    url: '/api/me',
    cookies: { ggd_sid: sid },
    headers: { 'content-type': contentType },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

const errorBody = (code: string, message: string) => ({ error: { code, message } });

// ---------------------------------------------------------------------------
// /auth/login
// ---------------------------------------------------------------------------

test('GET /auth/login sets a signed state cookie and redirects to Discord', async () => {
  await app.ready();
  const res = await app.inject({ url: '/auth/login' });
  expect(res.statusCode).toBe(302);

  const stateCookie = mustCookie(res, 'ggd_oauth_state');
  expect(stateCookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 600 });
  expect(stateCookie.secure).toBeFalsy(); // publicUrl là http://

  const unsigned = app.unsignCookie(stateCookie.value);
  expect(unsigned.valid).toBe(true);
  const state = unsigned.valid ? unsigned.value : '';
  expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 byte base64url
  expect(res.headers.location).toBe(oauth.authorizeUrl(state));

  // Mỗi lần một state khác nhau.
  const again = await app.inject({ url: '/auth/login' });
  expect(mustCookie(again, 'ggd_oauth_state').value).not.toBe(stateCookie.value);
});

test('cookies are secure when the public URL is https', async () => {
  const https = await buildApp({ ...ctx, config: { ...ctx.config, publicUrl: 'https://ggd.example' } }, { oauth });
  try {
    const res = await https.inject({ url: '/auth/login' });
    expect(mustCookie(res, 'ggd_oauth_state').secure).toBe(true);
  } finally {
    await https.close();
  }
});

// ---------------------------------------------------------------------------
// /auth/callback — các đường thất bại
// ---------------------------------------------------------------------------

test('state mismatch', async () => {
  await app.ready();
  const res = await app.inject({
    url: '/auth/callback?code=c&state=bad',
    cookies: { ggd_oauth_state: app.signCookie('good') },
  });
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe('/login?error=state');
  expect(cookieNamed(res, 'ggd_sid')).toBeUndefined();
  expect(oauth.exchanged).toEqual([]);
});

test('unsigned, missing or stale state cookie is rejected without touching Discord', async () => {
  await app.ready();
  // Cookie không ký (giả mạo) → coi như không có.
  const unsigned = await app.inject({ url: '/auth/callback?code=c&state=good', cookies: { ggd_oauth_state: 'good' } });
  expect(unsigned.statusCode).toBe(302);
  expect(unsigned.headers.location).toBe('/login?error=state');

  const missing = await app.inject({ url: '/auth/callback?code=c&state=good' });
  expect(missing.headers.location).toBe('/login?error=state');

  const noCode = await app.inject({
    url: '/auth/callback?state=good',
    cookies: { ggd_oauth_state: app.signCookie('good') },
  });
  expect(noCode.headers.location).toBe('/login?error=state');

  expect(oauth.exchanged).toEqual([]);
});

test('callback clears the state cookie even when it fails', async () => {
  await app.ready();
  const res = await app.inject({
    url: '/auth/callback?code=c&state=bad',
    cookies: { ggd_oauth_state: app.signCookie('good') },
  });
  const cleared = mustCookie(res, 'ggd_oauth_state');
  expect(cleared.value).toBe('');
  expect(cleared.expires?.getTime()).toBeLessThan(Date.now());
});

test('oauth exchange failure redirects to /login?error=oauth', async () => {
  await app.ready();
  const res = await app.inject({
    url: '/auth/callback?code=unknown&state=s',
    cookies: { ggd_oauth_state: app.signCookie('s') },
  });
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe('/login?error=oauth');
  expect(cookieNamed(res, 'ggd_sid')).toBeUndefined();
  expect(oauth.exchanged).toEqual(['unknown']);
});

test('a failure after the code exchange (e.g. creating the web session) redirects to /login?error=oauth', async () => {
  await app.ready();
  oauth.profiles.set('code-ok', { discordId: '42', email: null, emailVerified: false });
  directory.members.set('42', guildInfo('42'));
  const restore = patchDelegate(testDb.webSession, 'create', () => (() => Promise.reject(new Error('db hiccup'))) as never);
  let res: LightMyRequestResponse;
  try {
    res = await app.inject({ url: '/auth/callback?code=code-ok&state=s', cookies: { ggd_oauth_state: app.signCookie('s') } });
  } finally {
    restore();
  }
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe('/login?error=oauth');
  expect(cookieNamed(res, 'ggd_sid')).toBeUndefined();
  expect(await testDb.webSession.count()).toBe(0);
});

test('request logs never contain the OAuth code or state (query strings are dropped), but keep the client IP', async () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });
  const logged = await buildApp(ctx, { oauth, logger: { level: 'info', stream } });
  try {
    await logged.ready();
    await logged.inject({
      url: '/auth/callback?code=SECRET-CODE-123&state=SECRET-STATE-456',
      remoteAddress: '203.0.113.9',
      cookies: { ggd_oauth_state: logged.signCookie('other') },
    });
    await logged.inject({ url: '/api/admin/members?q=ten-rieng-tu' });
  } finally {
    await logged.close();
  }
  const text = lines.join('');
  expect(text).toContain('"url":"/auth/callback"');
  expect(text).toContain('"url":"/api/admin/members"');
  expect(text).toContain('"remoteAddress":"203.0.113.9"');
  for (const secret of ['SECRET-CODE-123', 'SECRET-STATE-456', 'ten-rieng-tu']) expect(text).not.toContain(secret);
});

test('not in guild', async () => {
  await app.ready();
  // Người từng là thành viên nhưng nay không còn trong server: bị đánh dấu rời hội.
  const stale = await createMember(testDb, { discordId: '9' });
  await testDb.webSession.create({ data: { memberId: stale.id, expiresAt: new Date('2026-11-01T00:00:00Z') } });

  oauth.profiles.set('code-9', { discordId: '9', email: 'x@example.com', emailVerified: true });
  const res = await app.inject({
    url: '/auth/callback?code=code-9&state=s',
    cookies: { ggd_oauth_state: app.signCookie('s') },
  });
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe('/login?error=not_member');
  expect(cookieNamed(res, 'ggd_sid')).toBeUndefined();

  expect(await testDb.member.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({
    status: 'left',
    leftAt: new Date('2026-10-22T12:00:00Z'),
  });
  expect(await testDb.webSession.count()).toBe(0);
  expect(await testDb.member.count()).toBe(1); // không tạo thêm ai
});

// ---------------------------------------------------------------------------
// /auth/callback — đăng nhập thành công
// ---------------------------------------------------------------------------

test('login refreshes access level and stores email', async () => {
  directory.members.set('1', { discordId: '1', displayName: 'Kẹ', avatarUrl: null, roleIds: ['r-mod'] });
  const sid = await loginAs('1', { email: 'ke@example.com', emailVerified: true });

  const res = await getMe(sid);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    id: 1,
    memberCode: 'GGD-0001',
    displayName: 'Kẹ',
    avatarUrl: null,
    email: 'ke@example.com',
    notifyEmail: true,
    notifyDm: true,
    accessLevel: 'mod',
  });

  // Role Discord đổi → lần đăng nhập sau cập nhật quyền; email đã có thì giữ nguyên.
  directory.members.set('1', { discordId: '1', displayName: 'Kẹ', avatarUrl: 'https://cdn/a.png', roleIds: [] });
  const sid2 = await loginAs('1', { email: 'other@example.com', emailVerified: true });
  expect((await getMe(sid2)).json()).toMatchObject({
    memberCode: 'GGD-0001',
    accessLevel: 'member',
    avatarUrl: 'https://cdn/a.png',
    email: 'ke@example.com',
  });
  // Phiên cũ vẫn dùng được (đăng nhập ở máy khác không đá máy này).
  expect((await getMe(sid)).statusCode).toBe(200);
  expect(await testDb.webSession.count()).toBe(2);
});

test('session cookie attributes and lifetime', async () => {
  directory.members.set('1', guildInfo('1'));
  await app.ready();
  oauth.profiles.set('code-1', { discordId: '1', email: null, emailVerified: false });
  const res = await app.inject({
    url: '/auth/callback?code=code-1&state=s',
    cookies: { ggd_oauth_state: app.signCookie('s') },
  });
  expect(res.statusCode).toBe(302);

  const sid = mustCookie(res, 'ggd_sid');
  expect(sid).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 30 * 24 * 60 * 60 });
  expect(sid.secure).toBeFalsy();
  const unsigned = app.unsignCookie(sid.value);
  expect(unsigned.valid).toBe(true);
  const id = unsigned.valid ? unsigned.value : '';
  expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 byte base64url

  // State cookie bị xoá sau callback.
  expect(mustCookie(res, 'ggd_oauth_state').value).toBe('');

  const row = await testDb.webSession.findUniqueOrThrow({ where: { id } });
  expect(row.expiresAt).toEqual(new Date('2026-11-21T12:00:00Z'));
});

test('unverified oauth email is not stored', async () => {
  directory.members.set('1', guildInfo('1'));
  const sid = await loginAs('1', { email: 'ke@example.com', emailVerified: false });
  expect((await getMe(sid)).json()).toMatchObject({ email: null });
});

test('directory down falls back to active DB member, with a warning naming the error', async () => {
  await createMember(testDb, { discordId: '1', displayName: 'Đã có', accessLevel: 'admin' });
  directory.down = true;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const sid = await loginAs('1');
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]?.[0])).toContain('FakeDirectory: Discord đang sập');
  expect((await getMe(sid)).json()).toMatchObject({
    memberCode: 'GGD-0001',
    displayName: 'Đã có',
    accessLevel: 'admin',
  });
});

test('directory down with no active record is not_member', async () => {
  await app.ready();
  const left = await createMember(testDb, { discordId: '2', status: 'left', leftAt: new Date('2026-10-01T00:00:00Z') });
  directory.down = true;

  for (const discordId of ['2', '3']) {
    oauth.profiles.set(`code-${discordId}`, { discordId, email: null, emailVerified: false });
    const res = await app.inject({
      url: `/auth/callback?code=code-${discordId}&state=s`,
      cookies: { ggd_oauth_state: app.signCookie('s') },
    });
    expect(res.headers.location).toBe('/login?error=not_member');
    expect(cookieNamed(res, 'ggd_sid')).toBeUndefined();
  }
  // Không tạo người mới, không đổi mốc rời của người đã rời.
  expect(await testDb.member.count()).toBe(1);
  expect((await testDb.member.findUniqueOrThrow({ where: { id: left.id } })).leftAt).toEqual(
    new Date('2026-10-01T00:00:00Z'),
  );
});

// ---------------------------------------------------------------------------
// Phiên
// ---------------------------------------------------------------------------

test('member who left is logged out', async () => {
  directory.members.set('1', guildInfo('1'));
  const sid = await loginAs('1');
  expect((await getMe(sid)).statusCode).toBe(200);

  await markMemberLeft(ctx, '1');
  const res = await getMe(sid);
  expect(res.statusCode).toBe(401);
  expect(res.json()).toEqual(errorBody('UNAUTHENTICATED', 'Bạn cần đăng nhập'));
});

test('expired session is rejected and removed', async () => {
  directory.members.set('1', guildInfo('1'));
  const sid = await loginAs('1');

  setNow('2026-11-21T11:59:59Z');
  expect((await getMe(sid)).statusCode).toBe(200);

  setNow('2026-11-21T12:00:00Z');
  expect((await getMe(sid)).statusCode).toBe(401);
  expect(await testDb.webSession.count()).toBe(0);
});

test('tampered or foreign-signed session cookie is treated as absent', async () => {
  directory.members.set('1', guildInfo('1'));
  const sid = await loginAs('1');
  const unsigned = app.unsignCookie(sid);
  const id = unsigned.valid ? unsigned.value : '';

  expect((await getMe(id)).statusCode).toBe(401); // không có chữ ký
  expect((await getMe(`${id}.sai-chu-ky`)).statusCode).toBe(401);
  expect((await getMe('rác')).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
  // Phiên vẫn còn — cookie hỏng không xoá phiên thật.
  expect((await getMe(sid)).statusCode).toBe(200);
});

test('logout deletes the session and clears the cookie', async () => {
  directory.members.set('1', guildInfo('1'));
  const sid = await loginAs('1');

  const res = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { ggd_sid: sid } });
  expect(res.statusCode).toBe(204);
  expect(res.body).toBe('');
  const cleared = mustCookie(res, 'ggd_sid');
  expect(cleared.value).toBe('');
  expect(cleared.path).toBe('/');
  expect(cleared.expires?.getTime()).toBeLessThan(Date.now());

  expect(await testDb.webSession.count()).toBe(0);
  expect((await getMe(sid)).statusCode).toBe(401);

  // Không có phiên vẫn 204; body JSON rỗng cũng được.
  expect((await app.inject({ method: 'POST', url: '/auth/logout' })).statusCode).toBe(204);
  const emptyJson = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { 'content-type': 'application/json' },
    payload: '',
  });
  expect(emptyJson.statusCode).toBe(204);
});

test('web session helpers: create, resolve, expire, delete', async () => {
  const m = await createMember(testDb, { discordId: '1' });
  const session = await createWebSession(ctx, m.id);
  expect(session.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(session.expiresAt).toEqual(new Date('2026-11-21T12:00:00Z'));
  expect((await createWebSession(ctx, m.id)).id).not.toBe(session.id);

  expect(await resolveWebSession(ctx, session.id)).toMatchObject({ id: m.id, discordId: '1' });
  expect(await resolveWebSession(ctx, 'không-có')).toBeNull();

  await testDb.member.update({ where: { id: m.id }, data: { status: 'left' } });
  expect(await resolveWebSession(ctx, session.id)).toBeNull();
  await testDb.member.update({ where: { id: m.id }, data: { status: 'active' } });

  setNow('2026-11-21T12:00:00Z');
  expect(await resolveWebSession(ctx, session.id)).toBeNull();
  expect(await testDb.webSession.findUnique({ where: { id: session.id } })).toBeNull();

  await expect(deleteWebSession(ctx, session.id)).resolves.toBeUndefined(); // đã xoá rồi: không lỗi
  expect(await testDb.webSession.count()).toBe(1); // phiên thứ hai vẫn còn
});

// ---------------------------------------------------------------------------
// /api/me
// ---------------------------------------------------------------------------

test('mutations require JSON', async () => {
  directory.members.set('1', guildInfo('1'));
  const sid = await loginAs('1');

  const res = await patchMe(sid, 'x', 'text/plain');
  expect(res.statusCode).toBe(415);
  expect(res.json()).toEqual(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Chỉ nhận dữ liệu JSON'));

  const noType = await app.inject({ method: 'PATCH', url: '/api/me', cookies: { ggd_sid: sid }, payload: '{}' });
  expect(noType.statusCode).toBe(415);

  // Tham số charset vẫn là JSON.
  expect((await patchMe(sid, {}, 'application/json; charset=utf-8')).statusCode).toBe(200);
  expect((await patchMe(sid, {}, 'APPLICATION/JSON')).statusCode).toBe(200);

  // Chưa đăng nhập cũng bị chặn ở lớp content-type trước.
  expect((await patchMe('', 'x', 'text/plain')).statusCode).toBe(415);
});

test('JSON guard: DELETE without a body may omit content-type; role image upload accepts images', async () => {
  // Không có route nào → 404 JSON, chứng tỏ guard đã cho qua.
  const del = await app.inject({ method: 'DELETE', url: '/api/nothing' });
  expect(del.statusCode).toBe(404);
  expect((await app.inject({ method: 'DELETE', url: '/api/nothing', headers: { 'content-type': 'text/plain' }, payload: 'x' })).statusCode).toBe(415);

  // Guard cho qua → tới bước đăng nhập của route ảnh (401 vì chưa đăng nhập), không phải 415.
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    const res = await app.inject({ method: 'PUT', url: '/api/admin/roles/12/image', headers: { 'content-type': type } });
    expect(res.statusCode).toBe(401);
  }
  expect((await app.inject({ method: 'PUT', url: '/api/admin/roles/12/image', headers: { 'content-type': 'image/gif' } })).statusCode).toBe(415);
  expect((await app.inject({ method: 'PUT', url: '/api/admin/roles/12/image', headers: { 'content-type': 'text/plain' } })).statusCode).toBe(415);
  expect((await app.inject({ method: 'PUT', url: '/api/admin/roles/12/other', headers: { 'content-type': 'image/png' } })).statusCode).toBe(415);
  expect((await app.inject({ method: 'POST', url: '/api/admin/roles/12/image', headers: { 'content-type': 'image/png' } })).statusCode).toBe(415);

  // Ngoài /api không áp dụng guard.
  expect((await app.inject({ method: 'POST', url: '/auth/logout', headers: { 'content-type': 'text/plain' }, payload: 'x' })).statusCode).toBe(204);
});

test('profile update persists', async () => {
  directory.members.set('1', guildInfo('1'));
  const sid = await loginAs('1');

  const res = await patchMe(sid, { notifyEmail: false });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ memberCode: 'GGD-0001', notifyEmail: false, notifyDm: true });
  expect((await getMe(sid)).json()).toMatchObject({ notifyEmail: false, notifyDm: true });

  expect((await patchMe(sid, { email: ' an@example.vn ', notifyDm: false })).json()).toMatchObject({
    email: 'an@example.vn',
    notifyEmail: false,
    notifyDm: false,
  });
  expect((await patchMe(sid, { email: null })).json()).toMatchObject({ email: null });
  expect((await testDb.member.findUniqueOrThrow({ where: { discordId: '1' } })).email).toBeNull();
});

test('profile validation errors are Vietnamese 400s', async () => {
  directory.members.set('1', guildInfo('1'));
  const sid = await loginAs('1');

  const badEmail = await patchMe(sid, { email: 'abc' });
  expect(badEmail.statusCode).toBe(400);
  expect(badEmail.json()).toEqual(errorBody('VALIDATION', 'Email không hợp lệ'));

  const unknownKey = await patchMe(sid, { memberCode: 'GGD-9999' });
  expect(unknownKey.statusCode).toBe(400);
  expect(unknownKey.json()).toEqual(errorBody('VALIDATION', 'Dữ liệu không hợp lệ'));

  expect((await patchMe(sid, { notifyDm: 'có' })).json()).toEqual(errorBody('VALIDATION', 'Dữ liệu không hợp lệ'));
  expect((await patchMe(sid, [1, 2])).statusCode).toBe(400);

  const malformed = await patchMe(sid, '{bad json');
  expect(malformed.statusCode).toBe(400);
  expect(malformed.json()).toEqual(errorBody('BAD_REQUEST', 'Yêu cầu không hợp lệ'));

  // Không có gì đổi.
  expect((await getMe(sid)).json()).toMatchObject({ email: null, notifyEmail: true, notifyDm: true });
  expect((await patchMe('', { notifyDm: false })).statusCode).toBe(401);
});

// ---------------------------------------------------------------------------
// Lỗi, 404, phân quyền
// ---------------------------------------------------------------------------

test('internal errors hide details', async () => {
  app.get('/api/__boom', async () => {
    throw new Error('db secret');
  });
  const res = await app.inject({ url: '/api/__boom' });
  expect(res.statusCode).toBe(500);
  expect(res.json()).toEqual(errorBody('INTERNAL', 'Có lỗi xảy ra, thử lại sau'));
  expect(res.body).not.toContain('db secret');
  expect(res.body).not.toContain('stack');
});

test('unknown /api and /auth routes are JSON 404s', async () => {
  for (const url of ['/api/nope', '/api', '/auth/nope']) {
    const res = await app.inject({ url });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
  }
  // Không có thư mục web: mọi đường dẫn khác cũng 404 JSON.
  const res = await app.inject({ url: '/anything' });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
});

test('requireMember / requireMod / requireAdmin', async () => {
  app.get('/api/__member', { preHandler: requireMember }, async (request) => ({ code: request.member?.memberCode }));
  app.get('/api/__mod', { preHandler: requireMod }, async (request) => ({ code: request.member?.memberCode }));
  app.get('/api/__admin', { preHandler: requireAdmin }, async (request) => ({ code: request.member?.memberCode }));

  directory.members.set('m', guildInfo('m'));
  directory.members.set('mod', guildInfo('mod', ['r-mod']));
  directory.members.set('adm', guildInfo('adm', ['r-admin']));
  const member = await loginAs('m');
  const mod = await loginAs('mod');
  const admin = await loginAs('adm');

  const hit = async (url: string, sid?: string) => {
    const res = await app.inject({ url, cookies: sid ? { ggd_sid: sid } : {} });
    return { status: res.statusCode, body: res.json<unknown>() };
  };

  expect(await hit('/api/__member')).toEqual({ status: 401, body: errorBody('UNAUTHENTICATED', 'Bạn cần đăng nhập') });
  expect(await hit('/api/__mod')).toMatchObject({ status: 401 });
  expect(await hit('/api/__admin')).toMatchObject({ status: 401 });

  expect(await hit('/api/__member', member)).toEqual({ status: 200, body: { code: 'GGD-0001' } });
  expect(await hit('/api/__mod', member)).toEqual({
    status: 403,
    body: errorBody('FORBIDDEN', 'Bạn không có quyền làm việc này'),
  });
  expect(await hit('/api/__admin', member)).toMatchObject({ status: 403 });

  expect(await hit('/api/__mod', mod)).toEqual({ status: 200, body: { code: 'GGD-0002' } });
  expect(await hit('/api/__admin', mod)).toMatchObject({ status: 403 });

  expect(await hit('/api/__mod', admin)).toEqual({ status: 200, body: { code: 'GGD-0003' } });
  expect(await hit('/api/__admin', admin)).toEqual({ status: 200, body: { code: 'GGD-0003' } });
});

// ---------------------------------------------------------------------------
// Dev login
// ---------------------------------------------------------------------------

test('dev login absent unless enabled', async () =>
  expect((await app.inject({ url: '/auth/dev-login?discordId=1' })).statusCode).toBe(404));

test('dev login signs in an existing active member only', async () => {
  const dev = await buildApp({ ...ctx, config: { ...ctx.config, devLogin: true } }, { oauth });
  try {
    await createMember(testDb, { discordId: '1', displayName: 'Dev' });
    await createMember(testDb, { discordId: '2', status: 'left' });

    const res = await dev.inject({ url: '/auth/dev-login?discordId=1' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const sid = mustCookie(res, 'ggd_sid').value;
    expect((await dev.inject({ url: '/api/me', cookies: { ggd_sid: sid } })).json()).toMatchObject({
      memberCode: 'GGD-0001',
      displayName: 'Dev',
    });

    for (const url of ['/auth/dev-login?discordId=2', '/auth/dev-login?discordId=3']) {
      const miss = await dev.inject({ url });
      expect(miss.statusCode).toBe(404);
      expect(miss.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
    }
    expect((await dev.inject({ url: '/auth/dev-login' })).statusCode).toBe(400);
    expect(await testDb.member.count()).toBe(2); // không tạo người mới
  } finally {
    await dev.close();
  }
});

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

test('rate limit: 120 requests per minute per IP, 429 in Vietnamese', async () => {
  for (let i = 0; i < 120; i += 1) {
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
  }
  const limited = await app.inject({ url: '/api/me' });
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toEqual(errorBody('RATE_LIMITED', 'Bạn thao tác quá nhanh, thử lại sau'));
});

test('rate limit keys on the IP the trusted proxy appended, not one the client supplies', async () => {
  app.get('/api/__ip', async (request) => ({ ip: request.ip }));
  // Một lớp proxy (10.0.0.1) nối IP thật vào CUỐI X-Forwarded-For; phần bên trái do client tự bịa.
  const viaProxy = (url: string, spoofed: string, real = '203.0.113.7') =>
    app.inject({ url, remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': `${spoofed}, ${real}` } });

  for (const spoofed of ['1.2.3.4', '5.6.7.8', '9.9.9.9, 8.8.8.8']) {
    expect((await viaProxy('/api/__ip', spoofed, '198.51.100.5')).json()).toEqual({ ip: '198.51.100.5' });
  }

  // Đổi phần bịa mỗi request vẫn chung một "xô": hết 120 là 429.
  for (let i = 0; i < 120; i += 1) {
    expect((await viaProxy('/api/me', `10.${i}.0.1`)).statusCode).toBe(401);
  }
  expect((await viaProxy('/api/me', '172.16.0.99')).statusCode).toBe(429);

  // Người dùng thật khác (proxy nối IP khác) là xô khác.
  expect((await viaProxy('/api/me', '1.2.3.4', '203.0.113.8')).statusCode).toBe(401);
});

test('static files and the SPA fallback do not use up the API rate limit (shared IPs, CGNAT)', async () => {
  await withWebBuild(async (dir) => {
    const web = await buildApp(ctx, { oauth, webDistDir: dir });
    try {
      for (let i = 0; i < 130; i += 1) expect((await web.inject({ url: '/' })).statusCode).toBe(200);
      for (const url of ['/assets/app.js', '/hom-nay', '/tri-an?ngay=2026-10-22']) {
        for (let i = 0; i < 5; i += 1) expect((await web.inject({ url })).statusCode, url).toBe(200);
      }
      expect((await web.inject({ url: '/api/me' })).statusCode).toBe(401);
      // /auth vẫn tính vào giới hạn (đã dùng 1 lượt cho /api/me ở trên).
      for (let i = 0; i < 119; i += 1) await web.inject({ url: '/auth/login' });
      expect((await web.inject({ url: '/auth/login' })).statusCode).toBe(429);
    } finally {
      await web.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Header bảo mật
// ---------------------------------------------------------------------------

test('every response carries the security headers', async () => {
  await withWebBuild(async (dir) => {
    const web = await buildApp(ctx, { oauth, webDistDir: dir });
    try {
      const urls = ['/', '/assets/app.js', '/hom-nay', '/api/me', '/api/nope', '/auth/login', '/healthz'];
      const responses = [];
      for (const url of urls) responses.push(await web.inject({ url }));
      responses.push(await web.inject({ method: 'POST', url: '/api/me', payload: 'x', headers: { 'content-type': 'text/plain' } }));
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 401, 404, 302, 200, 415]);
      for (const [i, res] of responses.entries()) {
        expect(res.headers, urls[i] ?? 'POST /api/me').toMatchObject({
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'content-security-policy': "frame-ancestors 'none'",
          'referrer-policy': 'same-origin',
        });
      }
    } finally {
      await web.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Static / SPA
// ---------------------------------------------------------------------------

test('serves the web build and falls back to index.html for app routes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ggd-web-'));
  try {
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>GGD Hub</title>');
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');

    const web = await buildApp(ctx, { oauth, webDistDir: dir });
    try {
      const root = await web.inject({ url: '/' });
      expect(root.statusCode).toBe(200);
      expect(root.headers['content-type']).toContain('text/html');
      expect(root.body).toContain('GGD Hub');

      const deep = await web.inject({ url: '/sessions/12?tab=votes' });
      expect(deep.statusCode).toBe(200);
      expect(deep.body).toContain('GGD Hub');

      const asset = await web.inject({ url: '/assets/app.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toBe('console.log(1)');

      // API/auth không bao giờ rơi vào index.html.
      const api = await web.inject({ url: '/api/nope' });
      expect(api.statusCode).toBe(404);
      expect(api.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
      expect((await web.inject({ url: '/auth/nope' })).json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));
      // Chỉ GET mới nhận index.html.
      expect((await web.inject({ method: 'POST', url: '/sessions' })).statusCode).toBe(404);

      // Route API thật vẫn thắng file tĩnh.
      expect((await web.inject({ url: '/api/me' })).statusCode).toBe(401);
    } finally {
      await web.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
