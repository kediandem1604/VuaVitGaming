import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import type { RoleDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, roleByKey } from '../../helpers/factories.js';
import { dateOnlyToDb } from '../../../src/server/lib/time.js';

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

/** Cookie phiên (đã ký) của một thành viên — không qua OAuth. */
async function sidFor(member: Member): Promise<string> {
  const session = await createWebSession(ctx, member.id);
  return app.signCookie(session.id);
}

const memberWithSid = async (p: Parameters<typeof createMember>[1] = {}) => {
  const member = await createMember(testDb, p);
  return { member, sid: await sidFor(member) };
};

const cookies = (sid?: string) => (sid ? { ggd_sid: sid } : {});

const get = (url: string, sid?: string, headers: Record<string, string> = {}) => app.inject({ url, cookies: cookies(sid), headers });

const send = (method: 'POST' | 'PATCH', url: string, sid: string | undefined, payload?: unknown) =>
  app.inject({
    method,
    url,
    cookies: cookies(sid),
    headers: { 'content-type': 'application/json' },
    payload: payload === undefined ? '' : JSON.stringify(payload),
  });
const post = (url: string, sid: string | undefined, payload?: unknown) => send('POST', url, sid, payload);
const patch = (url: string, sid: string | undefined, payload?: unknown) => send('PATCH', url, sid, payload);

/** PUT ảnh thô với content-type `type`. */
const putImage = (id: number | string, sid: string | undefined, body: Buffer | string, type = 'image/png') =>
  app.inject({ method: 'PUT', url: `/api/admin/roles/${id}/image`, cookies: cookies(sid), headers: { 'content-type': type }, payload: body });
const deleteImage = (id: number | string, sid?: string) =>
  app.inject({ method: 'DELETE', url: `/api/admin/roles/${id}/image`, cookies: cookies(sid) });

const errorBody = (code: string, message: string) => ({ error: { code, message } });
const FORBIDDEN = errorBody('FORBIDDEN', 'Bạn không có quyền làm việc này');
const INVALID = errorBody('VALIDATION', 'Dữ liệu không hợp lệ');
const NOT_FOUND = errorBody('NOT_FOUND', 'Không tìm thấy');
const INVALID_IMAGE = errorBody('INVALID_IMAGE', 'Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB');

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

const newRole = {
  key: 'test_role',
  faction: 'duck',
  nameVi: 'Role thử',
  nameEn: 'Test Role',
  description: 'Chỉ để thử.',
  metricLabel: 'Số lần thử',
  maxPerGame: 5,
  icon: '🧪',
};

// ---------------------------------------------------------------------------
// Phân quyền
// ---------------------------------------------------------------------------

test('role routes need a login; admin routes refuse members and mods', async () => {
  const swordsman = await roleByKey(testDb, 'swordsman');
  expect((await get('/api/roles')).statusCode).toBe(401);
  expect((await get(`/api/roles/${swordsman.id}/image`)).statusCode).toBe(401);

  const { sid: memberSid } = await memberWithSid();
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const calls = [
    (who?: string) => post('/api/admin/roles', who, newRole),
    (who?: string) => patch(`/api/admin/roles/${swordsman.id}`, who, { nameVi: 'X' }),
    (who?: string) => putImage(swordsman.id, who, png),
    (who?: string) => deleteImage(swordsman.id, who),
  ];
  for (const call of calls) {
    for (const sid of [memberSid, modSid]) {
      const forbidden = await call(sid);
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json()).toEqual(FORBIDDEN);
    }
    expect((await call()).statusCode).toBe(401);
  }

  // Không gì thay đổi.
  expect(await testDb.role.count()).toBe(91);
  expect(await roleByKey(testDb, 'swordsman')).toMatchObject({ nameVi: 'Kiếm sĩ', image: null, imageMime: null });
});

// ---------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------

test('members see only active roles', async () => {
  const { sid } = await memberWithSid();
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });
  const swordsman = await roleByKey(testDb, 'swordsman');

  const res = await get('/api/roles', sid);
  expect(res.statusCode).toBe(200);
  const roles = res.json<RoleDto[]>();
  expect(roles).toHaveLength(71);
  expect(roles.map((r) => r.faction)).toEqual([...Array<string>(30).fill('goose'), ...Array<string>(31).fill('duck'), ...Array<string>(10).fill('neutral')]);
  expect(roles.find((r) => r.key === 'swordsman')).toEqual({
    id: swordsman.id,
    key: 'swordsman',
    faction: 'duck',
    nameVi: 'Kiếm sĩ',
    nameEn: 'Swordsman',
    description: 'Vung kiếm chém mọi người đứng gần.',
    metricLabel: 'Số mạng chém',
    maxPerGame: 15,
    points: 1,
    extraMetricLabel: null,
    extraMaxPerGame: null,
    extraPoints: null,
    penaltyMetricLabel: null,
    penaltyMaxPerGame: null,
    penaltyPoints: null,
    mapNote: 'Có từ v4.10 (08/2026)',
    modeKey: null,
    icon: '⚔️',
    hasImage: false,
    active: true,
    sortOrder: swordsman.sortOrder,
  });
  expect(roles.some((r) => r.modeKey !== null || !r.active)).toBe(false);
  for (const r of roles) expect(r).not.toHaveProperty('image');

  // `?all=1`: thành viên vẫn chỉ thấy role bật; admin thấy cả 20 role chế độ đặc biệt.
  expect((await get('/api/roles?all=1', sid)).json<RoleDto[]>()).toEqual(roles);
  const all = (await get('/api/roles?all=1', adminSid)).json<RoleDto[]>();
  expect(all).toHaveLength(91);
  expect(all.find((r) => r.key === 'inquisitor')).toMatchObject({ faction: 'goose', modeKey: 'corruption', active: false });
  expect((await get('/api/roles', adminSid)).json<RoleDto[]>()).toEqual(roles);
  expect((await get('/api/roles?all=yes', adminSid)).statusCode).toBe(400);

  // Admin bật một role chế độ đặc biệt → thành viên thấy nó.
  const owl = await roleByKey(testDb, 'owl');
  expect((await patch(`/api/admin/roles/${owl.id}`, adminSid, { active: true })).statusCode).toBe(200);
  expect((await get('/api/roles', sid)).json<RoleDto[]>().find((r) => r.key === 'owl')).toMatchObject({ active: true, modeKey: 'hoot_seek' });
});

// ---------------------------------------------------------------------------
// Ảnh
// ---------------------------------------------------------------------------

test('image served with stored mime', async () => {
  const { sid } = await memberWithSid();
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });
  const swordsman = await roleByKey(testDb, 'swordsman');
  const url = `/api/roles/${swordsman.id}/image`;

  const put = await putImage(swordsman.id, adminSid, png);
  expect(put.statusCode).toBe(204);
  expect(put.body).toBe('');

  const res = await get(url, sid);
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('image/png');
  expect(res.headers['cache-control']).toBe('public, max-age=300');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-length']).toBe(String(png.length));
  expect(res.rawPayload.equals(png)).toBe(true);
  const etag = res.headers.etag;
  expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
  expect((await get('/api/roles', sid)).json<RoleDto[]>().find((r) => r.key === 'swordsman')?.hasImage).toBe(true);

  // ETag khớp → 304 không thân; không khớp → 200 ảnh.
  const cached = await get(url, sid, { 'if-none-match': String(etag) });
  expect(cached.statusCode).toBe(304);
  expect(cached.body).toBe('');
  expect(cached.headers.etag).toBe(etag);
  expect((await get(url, sid, { 'if-none-match': `W/${etag}, "other"` })).statusCode).toBe(304);
  expect((await get(url, sid, { 'if-none-match': '"stale"' })).statusCode).toBe(200);

  // Mime lưu theo nội dung, không theo header gửi lên.
  expect((await putImage(swordsman.id, adminSid, jpg, 'image/png')).statusCode).toBe(204);
  const asJpeg = await get(url, sid);
  expect(asJpeg.headers['content-type']).toBe('image/jpeg');
  expect(asJpeg.headers.etag).not.toBe(etag);
  expect((await get(url, sid, { 'if-none-match': String(etag) })).statusCode).toBe(200);

  // Xoá → 404; xoá lần nữa vẫn 204.
  const del = await deleteImage(swordsman.id, adminSid);
  expect(del.statusCode).toBe(204);
  const gone = await get(url, sid);
  expect(gone.statusCode).toBe(404);
  expect(gone.json()).toEqual(NOT_FOUND);
  expect((await get('/api/roles', sid)).json<RoleDto[]>().find((r) => r.key === 'swordsman')?.hasImage).toBe(false);
  expect((await deleteImage(swordsman.id, adminSid)).statusCode).toBe(204);
  expect((await deleteImage(9999, adminSid)).statusCode).toBe(404);
  expect((await deleteImage('abc', adminSid)).statusCode).toBe(400);
});

test('role images have their own rate-limit bucket', async () => {
  const { sid } = await memberWithSid();
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });
  const swordsman = await roleByKey(testDb, 'swordsman');
  expect((await putImage(swordsman.id, adminSid, png)).statusCode).toBe(204);

  // Cùng một IP (vd nhiều người sau một NAT) tải ảnh 600 lần trong một phút: đều được.
  const ip = '203.0.113.7';
  const getImage = () => app.inject({ url: `/api/roles/${swordsman.id}/image`, cookies: cookies(sid), remoteAddress: ip });
  const statuses: number[] = [];
  for (let batch = 0; batch < 6; batch += 1) {
    const results = await Promise.all(Array.from({ length: 100 }, getImage));
    statuses.push(...results.map((r) => r.statusCode));
  }
  expect(statuses.every((s) => s === 200 || s === 304)).toBe(true);

  // Ảnh không ăn vào bucket chung: các route khác từ IP đó vẫn chạy (vượt xa 120/phút nếu tính chung).
  const me = await app.inject({ url: '/api/me', cookies: cookies(sid), remoteAddress: ip });
  expect(me.statusCode).toBe(200);

  // Lần thứ 601 trong phút → 429 với thân lỗi của app; bucket chung vẫn chưa cạn.
  const limited = await getImage();
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toEqual(errorBody('RATE_LIMITED', 'Bạn thao tác quá nhanh, thử lại sau'));
  expect((await app.inject({ url: '/api/roles', cookies: cookies(sid), remoteAddress: ip })).statusCode).toBe(200);
});

test('image of a role without one is 404 JSON', async () => {
  const { sid } = await memberWithSid();
  const goose = await roleByKey(testDb, 'goose');
  const res = await get(`/api/roles/${goose.id}/image`, sid);
  expect(res.statusCode).toBe(404);
  expect(res.headers['content-type']).toMatch(/^application\/json/);
  expect(res.json()).toEqual(NOT_FOUND);
  expect((await get('/api/roles/9999/image', sid)).statusCode).toBe(404);
  expect((await get('/api/roles/abc/image', sid)).statusCode).toBe(400);
});

test('text file disguised as png rejected via API', async () => {
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });
  const swordsman = await roleByKey(testDb, 'swordsman');

  const fake = await putImage(swordsman.id, adminSid, 'hello', 'image/png');
  expect(fake.statusCode).toBe(400);
  expect(fake.json()).toEqual(INVALID_IMAGE);

  // Quá 1 MiB nhưng dưới bodyLimit → service từ chối; quá bodyLimit → Fastify chặn, vẫn báo INVALID_IMAGE.
  const slightlyOver = await putImage(swordsman.id, adminSid, Buffer.concat([png, Buffer.alloc(1_048_577 - png.length)]));
  expect(slightlyOver.statusCode).toBe(400);
  expect(slightlyOver.json()).toEqual(INVALID_IMAGE);
  const huge = await putImage(swordsman.id, adminSid, Buffer.concat([png, Buffer.alloc(1_100_001 - png.length)]));
  expect(huge.statusCode).toBe(400);
  expect(huge.json()).toEqual(INVALID_IMAGE);

  // Body rỗng, body JSON → không phải ảnh; content-type khác → 415 như mọi route ghi.
  expect((await putImage(swordsman.id, adminSid, Buffer.alloc(0))).json()).toEqual(INVALID_IMAGE);
  expect((await putImage(swordsman.id, adminSid, '{"a":1}', 'application/json')).json()).toEqual(INVALID_IMAGE);
  const svg = await putImage(swordsman.id, adminSid, '<svg></svg>', 'image/svg+xml');
  expect(svg.statusCode).toBe(415);
  expect(svg.json()).toEqual(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Chỉ nhận dữ liệu JSON'));
  expect((await putImage(swordsman.id, adminSid, 'hello', 'text/plain')).statusCode).toBe(415);

  expect((await putImage(9999, adminSid, png)).statusCode).toBe(404);
  expect((await putImage('abc', adminSid, png)).statusCode).toBe(400);
  expect(await roleByKey(testDb, 'swordsman')).toMatchObject({ image: null, imageMime: null });

  // Đúng 1 MiB vẫn nhận.
  expect((await putImage(swordsman.id, adminSid, Buffer.concat([png, Buffer.alloc(1_048_576 - png.length)]))).statusCode).toBe(204);
});

// ---------------------------------------------------------------------------
// Quản trị role
// ---------------------------------------------------------------------------

test('admin edits metric', async () => {
  const { sid } = await memberWithSid();
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });
  const swordsman = await roleByKey(testDb, 'swordsman');

  const res = await patch(`/api/admin/roles/${swordsman.id}`, adminSid, { metricLabel: 'Số người bị chém', maxPerGame: 16 });
  expect(res.statusCode).toBe(200);
  const dto = res.json<RoleDto>();
  expect(dto).toMatchObject({ id: swordsman.id, key: 'swordsman', metricLabel: 'Số người bị chém', maxPerGame: 16, hasImage: false });
  expect((await get('/api/roles', sid)).json<RoleDto[]>().find((r) => r.key === 'swordsman')).toEqual(dto);

  const tooLow = await patch(`/api/admin/roles/${swordsman.id}`, adminSid, { maxPerGame: 0 });
  expect(tooLow.statusCode).toBe(400);
  expect(tooLow.json()).toEqual(errorBody('VALIDATION', 'Tối đa mỗi trận phải từ 1 đến 100'));

  // Dạng sai hoặc trường không sửa được → 400 chung.
  for (const body of [undefined, { nameVi: 1 }, { active: 'no' }, { key: 'x' }, { id: 5 }, { hasImage: true }, { modeKey: 'corruption' }, { extra: 1 }, { maxPerGame: '5' }]) {
    const bad = await patch(`/api/admin/roles/${swordsman.id}`, adminSid, body);
    expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    expect(bad.json(), JSON.stringify(body)).toEqual(INVALID);
  }
  expect((await patch(`/api/admin/roles/${swordsman.id}`, adminSid, {})).statusCode).toBe(200);
  const missing = await patch('/api/admin/roles/9999', adminSid, { nameVi: 'X' });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual(NOT_FOUND);
  expect((await patch('/api/admin/roles/abc', adminSid, { nameVi: 'X' })).statusCode).toBe(400);
  expect(await roleByKey(testDb, 'swordsman')).toMatchObject({ key: 'swordsman', maxPerGame: 16, modeId: null });
});

test('admin manages the secondary metric over HTTP', async () => {
  const { sid } = await memberWithSid();
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });
  const extra = { extraMetricLabel: 'Số lần ám sát trong cuộc họp', extraMaxPerGame: 2, extraPoints: 3 };
  const noExtra = { extraMetricLabel: null, extraMaxPerGame: null, extraPoints: null };
  const incomplete = errorBody('VALIDATION', 'Chỉ số phụ cần đủ cả ba: tên, tối đa mỗi trận và điểm mỗi lần');

  // Thành viên thấy chỉ số phụ của Ám sát trong danh mục.
  const assassin = (await get('/api/roles', sid)).json<RoleDto[]>().find((r) => r.key === 'assassin');
  expect(assassin).toMatchObject({ metricLabel: 'Số mạng đã giết', maxPerGame: 15, ...extra });

  // Tạo với đủ ba trường / thiếu một trường.
  const created = await post('/api/admin/roles', adminSid, { ...newRole, ...extra });
  expect(created.statusCode).toBe(201);
  expect(created.json<RoleDto>()).toMatchObject({ key: 'test_role', ...extra });
  const partial = await post('/api/admin/roles', adminSid, { ...newRole, key: 'other_role', extraMetricLabel: 'Số lần thử lại', extraPoints: 2 });
  expect(partial.statusCode).toBe(400);
  expect(partial.json()).toEqual(incomplete);
  expect((await post('/api/admin/roles', adminSid, { ...newRole, key: 'other_role', ...extra, extraPoints: 101 })).json()).toEqual(
    errorBody('VALIDATION', 'Điểm mỗi lần của chỉ số phụ phải từ 1 đến 100'),
  );
  // Sai kiểu → 400 chung.
  for (const body of [{ ...newRole, key: 'other_role', ...extra, extraPoints: '3' }, { ...newRole, key: 'other_role', ...extra, extraMaxPerGame: 2.5 }, { ...newRole, key: 'other_role', ...extra, extraMetricLabel: 7 }]) {
    const bad = await post('/api/admin/roles', adminSid, body);
    expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    expect(bad.json(), JSON.stringify(body)).toEqual(INVALID);
  }

  // Bật trên role có sẵn, sửa một trường, tắt khi chưa có lần khai dùng.
  const swordsman = await roleByKey(testDb, 'swordsman');
  const enabled = await patch(`/api/admin/roles/${swordsman.id}`, adminSid, { extraMetricLabel: 'Số lần chém đôi', extraMaxPerGame: 5, extraPoints: 2 });
  expect(enabled.statusCode).toBe(200);
  expect(enabled.json<RoleDto>()).toMatchObject({ key: 'swordsman', extraMetricLabel: 'Số lần chém đôi', extraMaxPerGame: 5, extraPoints: 2 });
  expect((await get('/api/roles', sid)).json<RoleDto[]>().find((r) => r.key === 'swordsman')).toEqual(enabled.json());
  expect((await patch(`/api/admin/roles/${swordsman.id}`, adminSid, { extraPoints: 4 })).json<RoleDto>()).toMatchObject({ extraMetricLabel: 'Số lần chém đôi', extraPoints: 4 });
  const halfOff = await patch(`/api/admin/roles/${swordsman.id}`, adminSid, { extraPoints: null });
  expect(halfOff.statusCode).toBe(400);
  expect(halfOff.json()).toEqual(incomplete);
  expect((await patch(`/api/admin/roles/${swordsman.id}`, adminSid, { ...noExtra })).json<RoleDto>()).toMatchObject(noExtra);
  for (const body of [{ extraPoints: '3' }, { extraMetricLabel: 7 }, { extraMaxPerGame: 2.5 }]) {
    const bad = await patch(`/api/admin/roles/${swordsman.id}`, adminSid, body);
    expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    expect(bad.json(), JSON.stringify(body)).toEqual(INVALID);
  }

  // Ám sát đã có lần khai dùng chỉ số phụ → không tắt được; đổi điểm vẫn được.
  const { member } = await memberWithSid();
  await testDb.statReport.create({ data: { memberId: member.id, roleId: assassin!.id, playedOn: dateOnlyToDb('2026-10-10'), value: 0, extraValue: 1 } });
  const blocked = await patch(`/api/admin/roles/${assassin!.id}`, adminSid, { ...noExtra });
  expect(blocked.statusCode).toBe(400);
  expect(blocked.json()).toEqual(errorBody('VALIDATION', 'Role đã có lần khai dùng chỉ số phụ, không tắt được'));
  expect((await patch(`/api/admin/roles/${assassin!.id}`, adminSid, { extraPoints: 5 })).json<RoleDto>()).toMatchObject({ ...extra, extraPoints: 5 });
});

test('admin creates a role', async () => {
  const { sid } = await memberWithSid();
  const { sid: adminSid } = await memberWithSid({ accessLevel: 'admin' });

  const created = await post('/api/admin/roles', adminSid, newRole);
  expect(created.statusCode).toBe(201);
  const dto = created.json<RoleDto>();
  expect(dto).toEqual({
    id: dto.id,
    key: 'test_role',
    faction: 'duck',
    nameVi: 'Role thử',
    nameEn: 'Test Role',
    description: 'Chỉ để thử.',
    metricLabel: 'Số lần thử',
    maxPerGame: 5,
    points: 1,
    extraMetricLabel: null,
    extraMaxPerGame: null,
    extraPoints: null,
    penaltyMetricLabel: null,
    penaltyMaxPerGame: null,
    penaltyPoints: null,
    mapNote: null,
    modeKey: null,
    icon: '🧪',
    hasImage: false,
    active: true,
    sortOrder: 32, // sau 31 role Vịt
  });
  expect((await get('/api/roles', sid)).json<RoleDto[]>().find((r) => r.key === 'test_role')).toEqual(dto);

  const special = await post('/api/admin/roles', adminSid, { ...newRole, key: 'ghost_duck', modeKey: 'corruption', active: false, mapNote: 'Chỉ Bloodhaven', sortOrder: 3 });
  expect(special.statusCode).toBe(201);
  expect(special.json<RoleDto>()).toMatchObject({ key: 'ghost_duck', modeKey: 'corruption', active: false, mapNote: 'Chỉ Bloodhaven', sortOrder: 3 });
  expect((await get('/api/roles', sid)).json<RoleDto[]>().some((r) => r.key === 'ghost_duck')).toBe(false);

  const duplicate = await post('/api/admin/roles', adminSid, newRole);
  expect(duplicate.statusCode).toBe(400);
  expect(duplicate.json()).toEqual(errorBody('VALIDATION', 'Key đã tồn tại'));
  const badMode = await post('/api/admin/roles', adminSid, { ...newRole, key: 'other_role', modeKey: 'nope' });
  expect(badMode.json()).toEqual(errorBody('VALIDATION', 'Chế độ chơi không hợp lệ'));
  expect((await post('/api/admin/roles', adminSid, { ...newRole, key: 'other_role', maxPerGame: 101 })).json()).toEqual(
    errorBody('VALIDATION', 'Tối đa mỗi trận phải từ 1 đến 100'),
  );

  for (const body of [undefined, {}, { ...newRole, faction: 'alien' }, { ...newRole, maxPerGame: '5' }, { ...newRole, extra: 1 }, { ...newRole, hasImage: false }, { ...newRole, id: 1 }]) {
    const bad = await post('/api/admin/roles', adminSid, body);
    expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    expect(bad.json(), JSON.stringify(body)).toEqual(INVALID);
  }
  expect(await testDb.role.count()).toBe(93);
});
