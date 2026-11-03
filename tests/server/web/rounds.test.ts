import type { GameSession, Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { dateOnlyToDb } from '../../../src/server/lib/time.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { buildApp } from '../../../src/server/web/app.js';
import type { ReportDto, RoundDto, SessionRoundsDto } from '../../../src/shared/api-types.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, createSession, roleByKey } from '../../helpers/factories.js';

const oauth: OAuthClient = {
  authorizeUrl: () => 'https://discord.test/authorize',
  exchange: async () => {
    throw new Error('không dùng');
  },
};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

let ctx: Ctx;
let setNow: (iso: string) => void;
let app: FastifyInstance;
let session: GameSession;
let member: Member;
let memberSid: string;
let modSid: string;
let adminSid: string;

beforeEach(async () => {
  await resetDb();
  ({ ctx, setNow } = makeTestCtx());
  setNow('2026-11-05T05:00:00Z');
  app = await buildApp(ctx, { oauth });
  await app.ready();
  const mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  const admin = await createMember(testDb, { accessLevel: 'admin', displayName: 'Admin' });
  member = await createMember(testDb, { displayName: 'An' });
  modSid = await sidFor(mod);
  adminSid = await sidFor(admin);
  memberSid = await sidFor(member);
  session = await createSession(testDb, { startsAt: new Date('2026-11-05T14:00:00Z'), createdById: mod.id });
});

afterEach(async () => {
  await app.close();
});

async function sidFor(m: Member): Promise<string> {
  const s = await createWebSession(ctx, m.id);
  return app.signCookie(s.id);
}

const cookies = (sid?: string) => (sid ? { ggd_sid: sid } : {});

const addRound = (sid: string | undefined, body: Buffer | string = PNG, type = 'image/png', query = '') =>
  app.inject({
    method: 'POST',
    url: `/api/admin/sessions/${session.id}/rounds${query}`,
    cookies: cookies(sid),
    headers: { 'content-type': type },
    payload: body,
  });

const putImage = (id: number, sid: string | undefined, body: Buffer | string, type = 'image/png') =>
  app.inject({ method: 'PUT', url: `/api/admin/rounds/${id}/image`, cookies: cookies(sid), headers: { 'content-type': type }, payload: body });

const patchRound = (id: number, sid: string | undefined, payload: unknown) =>
  app.inject({ method: 'PATCH', url: `/api/admin/rounds/${id}`, cookies: cookies(sid), headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });

test('thêm ván: mod và admin được, thành viên 403, chưa đăng nhập 401', async () => {
  expect((await addRound(undefined)).statusCode).toBe(401);
  expect((await addRound(memberSid)).statusCode).toBe(403);
  const byMod = await addRound(modSid, PNG, 'image/png', '?winnerFaction=duck');
  expect(byMod.statusCode).toBe(201);
  expect(byMod.json<RoundDto>()).toMatchObject({ number: 1, winnerFaction: 'duck', sessionId: session.id });
  const byAdmin = await addRound(adminSid, WEBP, 'image/webp');
  expect(byAdmin.json<RoundDto>()).toMatchObject({ number: 2, winnerFaction: null });
  expect((await addRound(modSid, PNG, 'image/png', '?winnerFaction=chicken')).json()).toMatchObject({ error: { code: 'VALIDATION' } });
});

test('ảnh sai loại / quá lớn / không phải ảnh → câu của spec; JSON hay text/plain', async () => {
  const gif = await addRound(modSid, Buffer.from('GIF89a....'), 'image/gif');
  expect(gif.statusCode).toBe(400);
  expect(gif.json()).toEqual({ error: { code: 'INVALID_IMAGE', message: 'Chỉ nhận ảnh PNG, JPG hoặc WebP' } });
  // Đuôi/content-type nói PNG nhưng nội dung không phải.
  expect((await addRound(modSid, Buffer.from('not an image'), 'image/png')).json()).toMatchObject({ error: { message: 'Chỉ nhận ảnh PNG, JPG hoặc WebP' } });
  expect((await addRound(modSid, Buffer.from('xx'), 'application/octet-stream')).json()).toMatchObject({ error: { message: 'Chỉ nhận ảnh PNG, JPG hoặc WebP' } });
  const big = await addRound(modSid, Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]));
  expect(big.statusCode).toBe(400);
  expect(big.json()).toEqual({ error: { code: 'INVALID_IMAGE', message: 'Ảnh tối đa 5 MB' } });
  const json = await addRound(modSid, '{}', 'application/json');
  expect(json.json()).toMatchObject({ error: { message: 'Chỉ nhận ảnh PNG, JPG hoặc WebP' } });
  expect((await addRound(modSid, 'x', 'text/plain')).statusCode).toBe(415);
  expect(await testDb.gameRound.count()).toBe(0);
});

test('ảnh ván: cần đăng nhập, private cache 5 phút, ETag theo mốc đổi ảnh, 304, đổi ảnh → ETag mới', async () => {
  const round = (await addRound(modSid)).json<RoundDto>();
  const url = `/api/rounds/${round.id}/image`;
  expect((await app.inject({ url })).statusCode).toBe(401);

  const res = await app.inject({ url, cookies: cookies(memberSid) });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('image/png');
  expect(res.headers['cache-control']).toBe('private, max-age=300');
  expect(res.rawPayload.equals(PNG)).toBe(true);
  const etag = res.headers.etag as string;
  expect(etag).toBe(`"round-${round.id}-${new Date('2026-11-05T05:00:00Z').getTime()}"`);

  const again = await app.inject({ url, cookies: cookies(memberSid), headers: { 'if-none-match': etag } });
  expect(again.statusCode).toBe(304);
  expect(again.body).toBe('');

  setNow('2026-11-05T05:10:00Z');
  expect((await putImage(round.id, memberSid, WEBP, 'image/webp')).statusCode).toBe(403);
  const changed = await putImage(round.id, modSid, WEBP, 'image/webp');
  expect(changed.statusCode).toBe(200);
  expect(changed.json<RoundDto>().imageUrl).toBe(`/api/rounds/${round.id}/image?v=${new Date('2026-11-05T05:10:00Z').getTime()}`);
  const fresh = await app.inject({ url, cookies: cookies(memberSid), headers: { 'if-none-match': etag } });
  expect(fresh.statusCode).toBe(200);
  expect(fresh.headers['content-type']).toBe('image/webp');
  expect(fresh.headers.etag).not.toBe(etag);
  expect((await putImage(round.id, modSid, Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]))).json()).toMatchObject({ error: { message: 'Ảnh tối đa 5 MB' } });
  expect((await app.inject({ url: '/api/rounds/999/image', cookies: cookies(memberSid) })).statusCode).toBe(404);
});

test('sửa và xoá ván qua API; trang buổi cho mọi thành viên', async () => {
  const round = (await addRound(modSid)).json<RoundDto>();
  const pelican = await roleByKey(testDb, 'pelican');
  await testDb.statReport.create({
    data: { memberId: member.id, roleId: pelican.id, roundId: round.id, sessionId: session.id, playedOn: dateOnlyToDb('2026-11-05'), value: 1, createdAt: ctx.now() },
  });
  expect((await patchRound(round.id, memberSid, { winnerFaction: 'neutral' })).statusCode).toBe(403);
  const patched = await patchRound(round.id, modSid, { winnerFaction: 'neutral', winnerIds: [member.id] });
  expect(patched.statusCode).toBe(200);
  expect(patched.json<RoundDto>()).toMatchObject({ winnerFaction: 'neutral', winnerIds: [member.id] });

  const page = await app.inject({ url: `/api/sessions/${session.id}/rounds`, cookies: cookies(memberSid) });
  expect(page.statusCode).toBe(200);
  const dto = page.json<SessionRoundsDto>();
  expect(dto.rounds[0]!.reports[0]).toMatchObject({ member: { id: member.id, displayName: 'An' }, status: 'pending', won: true, mine: { value: 1 } });
  expect((await app.inject({ url: `/api/sessions/${session.id}/rounds` })).statusCode).toBe(401);

  const del = (sid: string) => app.inject({ method: 'DELETE', url: `/api/admin/rounds/${round.id}`, cookies: cookies(sid) });
  expect((await del(memberSid)).statusCode).toBe(403);
  const blocked = await del(modSid);
  expect(blocked.statusCode).toBe(409);
  expect(blocked.json()).toMatchObject({ error: { code: 'ROUND_HAS_REPORTS' } });
  await testDb.statReport.deleteMany({});
  expect((await del(adminSid)).statusCode).toBe(204);
});

const json = (method: 'POST' | 'PATCH', url: string, sid: string | undefined, payload: unknown) =>
  app.inject({ method, url, cookies: cookies(sid), headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });

test('khai theo ván qua API: 201 ReportDto có round; trùng 409; body có ngày/buổi 400; PATCH không đổi ván', async () => {
  const round = (await addRound(modSid, PNG, 'image/png', '?winnerFaction=duck')).json<RoundDto>();
  const duck = await roleByKey(testDb, 'duck');
  const url = `/api/rounds/${round.id}/reports`;
  expect((await json('POST', url, undefined, { roleId: duck.id, value: 1 })).statusCode).toBe(401);
  expect((await json('POST', url, memberSid, { roleId: duck.id, value: 1, playedOn: '2026-11-05' })).statusCode).toBe(400);
  expect((await json('POST', url, memberSid, { roleId: duck.id, value: 1, sessionId: session.id })).statusCode).toBe(400);

  const res = await json('POST', url, memberSid, { roleId: duck.id, value: 2, note: 'ok' });
  expect(res.statusCode).toBe(201);
  const dto = res.json<ReportDto>();
  expect(dto).toMatchObject({
    status: 'pending',
    playedOn: '2026-11-05',
    sessionId: session.id,
    value: 2,
    note: 'ok',
    round: {
      id: round.id,
      number: 1,
      sessionId: session.id,
      sessionStartsAt: '2026-11-05T14:00:00.000Z',
      winnerFaction: 'duck',
      won: true,
      imageUrl: round.imageUrl,
    },
  });

  const dup = await json('POST', url, memberSid, { roleId: duck.id, value: 0 });
  expect(dup.statusCode).toBe(409);
  expect(dup.json()).toEqual({ error: { code: 'ROUND_REPORT_DUPLICATE', message: 'Bạn đã khai ván này rồi' } });
  const missing = await json('POST', '/api/rounds/999999/reports', memberSid, { roleId: duck.id, value: 0 });
  expect(missing.json()).toEqual({ error: { code: 'ROUND_REPORT_CLOSED', message: 'Ván này không còn nhận khai' } });

  // Sửa: đổi giá trị được, gửi roundId → 400.
  const patched = await json('PATCH', `/api/reports/${dto.id}`, memberSid, { value: 1 });
  expect(patched.statusCode).toBe(200);
  expect(patched.json<ReportDto>()).toMatchObject({ value: 1, round: { id: round.id } });
  const other = (await addRound(modSid)).json<RoundDto>();
  expect((await json('PATCH', `/api/reports/${dto.id}`, memberSid, { roundId: other.id })).statusCode).toBe(400);
  expect((await testDb.statReport.findUniqueOrThrow({ where: { id: dto.id } })).roundId).toBe(round.id);
});

test('POST /api/reports theo ngày cho ngày mùa luật ván → 400 VALIDATION với câu của spec', async () => {
  const duck = await roleByKey(testDb, 'duck');
  const res = await json('POST', '/api/reports', memberSid, { roleId: duck.id, value: 1, playedOn: '2026-11-04' });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toEqual({ error: { code: 'VALIDATION', message: 'Từ tháng 11 khai điểm theo ván — chọn buổi và ván để khai' } });
  expect(await testDb.statReport.count()).toBe(0);
});

const putThumb = (id: number, sid: string | undefined, body: Buffer | string, type = 'image/webp') =>
  app.inject({ method: 'PUT', url: `/api/admin/rounds/${id}/thumbnail`, cookies: cookies(sid), headers: { 'content-type': type }, payload: body });

test('ảnh nhỏ: chưa có → ?size=thumb trả ảnh gốc; mod up ảnh nhỏ (≤ 300 KB, nhận diện theo nội dung); đổi ảnh gốc → xoá ảnh nhỏ', async () => {
  const round = (await addRound(modSid)).json<RoundDto>();
  const t0 = new Date('2026-11-05T05:00:00Z').getTime();
  expect(round.thumbUrl).toBe(`/api/rounds/${round.id}/image?size=thumb&v=${t0}`);
  const thumbUrl = `/api/rounds/${round.id}/image?size=thumb`;
  expect((await app.inject({ url: thumbUrl })).statusCode).toBe(401);

  // Chưa có ảnh nhỏ → ảnh gốc, ETag riêng (khác ETag ảnh gốc) để cache không lẫn.
  const fallback = await app.inject({ url: thumbUrl, cookies: cookies(memberSid) });
  expect(fallback.statusCode).toBe(200);
  expect(fallback.headers['content-type']).toBe('image/png');
  expect(fallback.headers['cache-control']).toBe('private, max-age=300');
  expect(fallback.rawPayload.equals(PNG)).toBe(true);
  const fullEtag = (await app.inject({ url: `/api/rounds/${round.id}/image`, cookies: cookies(memberSid) })).headers.etag;
  expect(fallback.headers.etag).not.toBe(fullEtag);

  // Quyền, loại ảnh, kích thước.
  expect((await putThumb(round.id, undefined, WEBP)).statusCode).toBe(401);
  expect((await putThumb(round.id, memberSid, WEBP)).statusCode).toBe(403);
  expect((await putThumb(round.id, modSid, Buffer.from('GIF89a....'), 'image/gif')).json()).toEqual({
    error: { code: 'INVALID_IMAGE', message: 'Chỉ nhận ảnh PNG, JPG hoặc WebP' },
  });
  const big = await putThumb(round.id, modSid, Buffer.concat([WEBP, Buffer.alloc(300 * 1024)]));
  expect(big.statusCode).toBe(400);
  expect(big.json()).toEqual({ error: { code: 'INVALID_IMAGE', message: 'Ảnh nhỏ tối đa 300 KB' } });
  const tooBigBody = await putThumb(round.id, modSid, Buffer.concat([WEBP, Buffer.alloc(2 * 1024 * 1024)]));
  expect(tooBigBody.json()).toEqual({ error: { code: 'INVALID_IMAGE', message: 'Ảnh nhỏ tối đa 300 KB' } });
  expect((await putThumb(999999, modSid, WEBP)).statusCode).toBe(404);

  setNow('2026-11-05T05:01:00Z');
  const t1 = new Date('2026-11-05T05:01:00Z').getTime();
  const up = await putThumb(round.id, adminSid, WEBP);
  expect(up.statusCode).toBe(200);
  // Up ảnh nhỏ đổi mốc ảnh → cả hai URL đổi `?v=`, người đang xem không dính bản cũ trong cache.
  expect(up.json<RoundDto>()).toMatchObject({ thumbUrl: `/api/rounds/${round.id}/image?size=thumb&v=${t1}`, imageUrl: `/api/rounds/${round.id}/image?v=${t1}` });

  const thumb = await app.inject({ url: thumbUrl, cookies: cookies(memberSid) });
  expect(thumb.statusCode).toBe(200);
  expect(thumb.headers['content-type']).toBe('image/webp');
  expect(thumb.rawPayload.equals(WEBP)).toBe(true);
  const thumbEtag = thumb.headers.etag as string;
  expect(thumbEtag).not.toBe(fallback.headers.etag);
  expect((await app.inject({ url: thumbUrl, cookies: cookies(memberSid), headers: { 'if-none-match': thumbEtag } })).statusCode).toBe(304);
  // Ảnh gốc vẫn là PNG.
  const full = await app.inject({ url: `/api/rounds/${round.id}/image`, cookies: cookies(memberSid) });
  expect(full.headers['content-type']).toBe('image/png');
  expect(full.headers.etag).not.toBe(thumbEtag);
  expect((await app.inject({ url: `/api/rounds/${round.id}/image?size=huge`, cookies: cookies(memberSid) })).statusCode).toBe(400);

  // Đổi ảnh gốc → ảnh nhỏ bị xoá, ?size=thumb trả lại ảnh gốc mới.
  setNow('2026-11-05T05:02:00Z');
  expect((await putImage(round.id, modSid, PNG)).statusCode).toBe(200);
  const row = await testDb.gameRound.findUniqueOrThrow({ where: { id: round.id }, select: { thumb: true, thumbMime: true } });
  expect(row).toEqual({ thumb: null, thumbMime: null });
  const after = await app.inject({ url: thumbUrl, cookies: cookies(memberSid) });
  expect(after.headers['content-type']).toBe('image/png');
  expect(after.headers.etag).not.toBe(thumbEtag);
});

test('lần khai theo ván có round.thumbUrl', async () => {
  const round = (await addRound(modSid, PNG, 'image/png', '?winnerFaction=duck')).json<RoundDto>();
  const duck = await roleByKey(testDb, 'duck');
  const res = await json('POST', `/api/rounds/${round.id}/reports`, memberSid, { roleId: duck.id, value: 1 });
  expect(res.json<ReportDto>().round).toMatchObject({ imageUrl: round.imageUrl, thumbUrl: round.thumbUrl });
});
