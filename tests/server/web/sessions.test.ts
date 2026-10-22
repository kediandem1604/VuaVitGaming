import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { createSession, setAttendance } from '../../../src/server/modules/sessions/service.js';
import type { SessionDto } from '../../../src/shared/api-types.js';
import { buildApp } from '../../../src/server/web/app.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, createSession as insertSession } from '../../helpers/factories.js';
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
let setNow: (iso: string) => void;
let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  app = await buildApp(ctx, { oauth });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
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

/** 21:00 ngày 22/10/2026 giờ VN = now mặc định + 2 giờ. */
const startsAt = new Date('2026-10-22T14:00:00Z');

async function classicId(): Promise<number> {
  return (await testDb.gameMode.findUniqueOrThrow({ where: { key: 'classic' } })).id;
}

// ---------------------------------------------------------------------------
// GET /api/modes
// ---------------------------------------------------------------------------

test('GET /api/modes lists active modes by id and needs a login', async () => {
  expect((await get('/api/modes')).statusCode).toBe(401);

  const { sid } = await memberWithSid();
  await testDb.gameMode.update({ where: { key: 'draft' }, data: { active: false } });

  const res = await get('/api/modes', sid);
  expect(res.statusCode).toBe(200);
  const modes = res.json<{ id: number; key: string; nameVi: string }[]>();
  expect(modes).toHaveLength(9);
  expect(modes.map((m) => m.key)).not.toContain('draft');
  expect(modes.map((m) => m.id)).toEqual([...modes].map((m) => m.id).sort((a, b) => a - b));
  expect(modes[0]).toEqual({ id: 1, key: 'classic', nameVi: 'Cổ điển (Classic)' });
  // Không lộ cột khác (nameEn, active).
  expect(Object.keys(modes[0] ?? {})).toEqual(['id', 'key', 'nameVi']);
});

// ---------------------------------------------------------------------------
// GET /api/sessions
// ---------------------------------------------------------------------------

test('GET /api/sessions defaults to today in VN and maps the DTO with avatars and myStatus', async () => {
  const { member: me, sid } = await memberWithSid({ displayName: 'Tôi', avatarUrl: 'https://cdn/me.png' });
  const other = await createMember(testDb, { displayName: 'Bạn', avatarUrl: null });
  const admin = await createMember(testDb, { accessLevel: 'admin' });

  const s = await createSession(ctx, admin.id, { startsAt, modeId: await classicId(), roomCode: 'ABC', note: 'Ghi chú' });
  // Bạn đăng ký trước tôi: danh sách theo thứ tự đăng ký, không theo id.
  setNow('2026-10-22T12:01:00Z');
  await setAttendance(ctx, s.id, other.id, true);
  setNow('2026-10-22T12:02:00Z');
  await setAttendance(ctx, s.id, me.id, true);
  // Buổi ngày mai (00:30 ngày 23/10 giờ VN — vẫn là 22/10 theo UTC) không nằm trong hôm nay.
  const tomorrow = await insertSession(testDb, { startsAt: new Date('2026-10-22T17:30:00Z') });

  const res = await get('/api/sessions', sid);
  expect(res.statusCode).toBe(200);
  expect(res.json<SessionDto[]>()).toEqual([
    {
      id: s.id,
      startsAt: '2026-10-22T14:00:00.000Z',
      modeName: 'Cổ điển (Classic)',
      capacity: 16,
      roomCode: 'ABC',
      note: 'Ghi chú',
      status: 'scheduled',
      attendees: [
        { memberId: other.id, displayName: 'Bạn', avatarUrl: null },
        { memberId: me.id, displayName: 'Tôi', avatarUrl: 'https://cdn/me.png' },
      ],
      myStatus: 'going',
    },
  ]);

  const next = await get('/api/sessions?date=2026-10-23', sid);
  expect(next.json<SessionDto[]>().map((v) => v.id)).toEqual([tomorrow.id]);
  expect(next.json<SessionDto[]>()[0]).toMatchObject({ attendees: [], myStatus: null });

  // Người khác xem: không tham gia → myStatus null, danh sách vẫn đầy đủ.
  const { sid: otherSid } = await memberWithSid();
  const asOther = await get('/api/sessions?date=2026-10-22', otherSid);
  expect(asOther.json<SessionDto[]>()[0]).toMatchObject({ myStatus: null });
  expect(asOther.json<SessionDto[]>()[0]?.attendees).toHaveLength(2);

  expect((await get('/api/sessions')).statusCode).toBe(401);
});

test('bad date rejected', async () => {
  const { sid } = await memberWithSid();
  for (const date of ['abc', '22/10/2026', '2026-02-30', '2026-10-2', '']) {
    const res = await get(`/api/sessions?date=${encodeURIComponent(date)}`, sid);
    expect(res.statusCode, date).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION');
  }
});

// ---------------------------------------------------------------------------
// POST /api/sessions/:id/attendance
// ---------------------------------------------------------------------------

test('attendance via API reports myStatus', async () => {
  const { member: me, sid } = await memberWithSid({ displayName: 'Tôi' });
  const admin = await createMember(testDb, { accessLevel: 'admin' });
  const s = await createSession(ctx, admin.id, { startsAt, modeId: await classicId() });

  const joined = await post(`/api/sessions/${s.id}/attendance`, sid, { going: true });
  expect(joined.statusCode).toBe(200);
  expect(joined.json<SessionDto>()).toMatchObject({
    id: s.id,
    myStatus: 'going',
    attendees: [{ memberId: me.id, displayName: 'Tôi', avatarUrl: null }],
  });
  // Tin Discord được sửa như khi bấm nút.
  expect(notifier.updated).toHaveLength(1);

  const left = await post(`/api/sessions/${s.id}/attendance`, sid, { going: false });
  expect(left.statusCode).toBe(200);
  expect(left.json<SessionDto>()).toMatchObject({ myStatus: null, attendees: [] });

  expect((await get('/api/sessions', sid)).json<SessionDto[]>()[0]).toMatchObject({ myStatus: null });
});

test('attendance validation, auth and business errors', async () => {
  const { sid } = await memberWithSid();
  const admin = await createMember(testDb, { accessLevel: 'admin' });
  const s = await createSession(ctx, admin.id, { startsAt, modeId: await classicId(), capacity: 1 });

  expect((await post(`/api/sessions/${s.id}/attendance`, undefined, { going: true })).statusCode).toBe(401);

  for (const body of [{}, { going: 'yes' }, { going: true, extra: 1 }, [], null]) {
    const res = await post(`/api/sessions/${s.id}/attendance`, sid, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json()).toEqual(errorBody('VALIDATION', 'Dữ liệu không hợp lệ'));
  }
  for (const id of ['abc', '0', '-1', '1.5', '99999999999']) {
    const res = await post(`/api/sessions/${id}/attendance`, sid, { going: true });
    expect(res.statusCode, id).toBe(400);
    expect(res.json()).toEqual(errorBody('VALIDATION', 'Dữ liệu không hợp lệ'));
  }

  const missing = await post('/api/sessions/999/attendance', sid, { going: true });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual(errorBody('NOT_FOUND', 'Không tìm thấy'));

  // Hết chỗ.
  await setAttendance(ctx, s.id, admin.id, true);
  const full = await post(`/api/sessions/${s.id}/attendance`, sid, { going: true });
  expect(full.statusCode).toBe(409);
  expect(full.json()).toEqual(errorBody('SESSION_FULL', 'Đã đủ người'));

  // Buổi đã huỷ.
  const cancelled = await insertSession(testDb, { status: 'cancelled' });
  const closed = await post(`/api/sessions/${cancelled.id}/attendance`, sid, { going: true });
  expect(closed.statusCode).toBe(409);
  expect(closed.json()).toEqual(errorBody('SESSION_NOT_OPEN', 'Buổi chơi đã kết thúc hoặc bị huỷ'));
});

// ---------------------------------------------------------------------------
// POST /api/admin/sessions
// ---------------------------------------------------------------------------

test('member cannot create session, mod can', async () => {
  const { sid: memberSid } = await memberWithSid();
  const { member: mod, sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const body = { date: '2026-10-22', time: '21:00', modeId: await classicId(), capacity: 10, roomCode: 'ABC', note: 'Ghi chú' };

  const forbidden = await post('/api/admin/sessions', memberSid, body);
  expect(forbidden.statusCode).toBe(403);
  expect(forbidden.json()).toEqual(errorBody('FORBIDDEN', 'Bạn không có quyền làm việc này'));
  expect((await post('/api/admin/sessions', undefined, body)).statusCode).toBe(401);
  expect(await testDb.gameSession.count()).toBe(0);

  const created = await post('/api/admin/sessions', modSid, body);
  expect(created.statusCode).toBe(201);
  const dto = created.json<SessionDto>();
  expect(dto).toEqual({
    id: dto.id,
    startsAt: '2026-10-22T14:00:00.000Z', // 21:00 giờ VN
    modeName: 'Cổ điển (Classic)',
    capacity: 10,
    roomCode: 'ABC',
    note: 'Ghi chú',
    status: 'scheduled',
    attendees: [],
    myStatus: null,
  });
  expect(await testDb.gameSession.findUniqueOrThrow({ where: { id: dto.id } })).toMatchObject({
    createdById: mod.id,
    discordMessageId: 'msg-1',
  });
  expect(notifier.published).toHaveLength(1);

  // Chỉ cần ngày, giờ và chế độ; sức chứa mặc định 16, mã phòng/ghi chú null.
  const minimal = await post('/api/admin/sessions', modSid, { date: '2026-10-23', time: '09:05', modeId: body.modeId });
  expect(minimal.statusCode).toBe(201);
  expect(minimal.json<SessionDto>()).toMatchObject({
    startsAt: '2026-10-23T02:05:00.000Z',
    capacity: 16,
    roomCode: null,
    note: null,
  });
  // null cũng được cho mã phòng và ghi chú.
  const withNulls = await post('/api/admin/sessions', modSid, { ...body, roomCode: null, note: null });
  expect(withNulls.statusCode).toBe(201);
  expect(withNulls.json<SessionDto>()).toMatchObject({ roomCode: null, note: null });
});

test('create session validation', async () => {
  const { sid } = await memberWithSid({ accessLevel: 'admin' });
  const modeId = await classicId();
  const good = { date: '2026-10-22', time: '21:00', modeId };

  const generic = async (body: unknown) => {
    const res = await post('/api/admin/sessions', sid, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json(), JSON.stringify(body)).toEqual(errorBody('VALIDATION', 'Dữ liệu không hợp lệ'));
  };
  await generic({ ...good, time: '25:00' });
  await generic({ ...good, time: '21:60' });
  await generic({ ...good, time: '9:05' });
  await generic({ ...good, date: '22/10/2026' });
  await generic({ ...good, date: '2026-1-2' });
  await generic({ ...good, modeId: 'classic' });
  await generic({ ...good, modeId: 1.5 });
  await generic({ ...good, capacity: '10' });
  await generic({ ...good, extra: 1 });
  await generic({ time: '21:00', modeId });
  await generic(undefined);

  // Ngày đúng dạng nhưng không tồn tại.
  const noDay = await post('/api/admin/sessions', sid, { ...good, date: '2026-02-30' });
  expect(noDay.statusCode).toBe(400);
  expect(noDay.json()).toEqual(errorBody('VALIDATION', 'Ngày không hợp lệ'));

  // Lỗi nghiệp vụ của service giữ nguyên thông báo.
  const past = await post('/api/admin/sessions', sid, { ...good, time: '18:00' }); // now = 19:00 VN
  expect(past.statusCode).toBe(400);
  expect(past.json()).toEqual(errorBody('VALIDATION', 'Giờ bắt đầu đã qua'));
  expect((await post('/api/admin/sessions', sid, { ...good, capacity: 26 })).json()).toEqual(
    errorBody('VALIDATION', 'Sức chứa phải từ 1 đến 25'),
  );
  expect((await post('/api/admin/sessions', sid, { ...good, modeId: 9999 })).json()).toEqual(
    errorBody('VALIDATION', 'Chế độ chơi không hợp lệ'),
  );
  expect((await post('/api/admin/sessions', sid, { ...good, roomCode: 'x'.repeat(21) })).statusCode).toBe(400);

  expect(await testDb.gameSession.count()).toBe(0);
  expect(notifier.published).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// POST /api/admin/sessions/:id/cancel
// ---------------------------------------------------------------------------

test('mod can cancel; attendees are DMed and the message updated', async () => {
  const { member: me, sid: memberSid } = await memberWithSid({ discordId: 'd-me' });
  const { sid: modSid } = await memberWithSid({ accessLevel: 'mod' });
  const s = await createSession(ctx, me.id, { startsAt, modeId: await classicId() });
  await setAttendance(ctx, s.id, me.id, true);

  const forbidden = await post(`/api/admin/sessions/${s.id}/cancel`, memberSid);
  expect(forbidden.statusCode).toBe(403);
  expect((await post(`/api/admin/sessions/${s.id}/cancel`, undefined)).statusCode).toBe(401);

  const res = await post(`/api/admin/sessions/${s.id}/cancel`, modSid);
  expect(res.statusCode).toBe(204);
  expect(res.body).toBe('');
  expect(notifier.dms).toEqual([{ discordId: 'd-me', text: 'Buổi chơi Cổ điển (Classic) lúc 21:00 ngày 22/10 đã bị huỷ.' }]);
  expect(notifier.updated.at(-1)?.view).toMatchObject({ id: s.id, status: 'cancelled' });
  expect((await get('/api/sessions', memberSid)).json<SessionDto[]>()[0]).toMatchObject({
    id: s.id,
    status: 'cancelled',
    myStatus: 'going', // lịch sử đăng ký vẫn hiện trên buổi đã huỷ
  });

  // Huỷ lần nữa → 409; buổi không có → 404; id hỏng → 400.
  const again = await post(`/api/admin/sessions/${s.id}/cancel`, modSid);
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual(errorBody('SESSION_NOT_OPEN', 'Buổi chơi đã kết thúc hoặc bị huỷ'));
  expect((await post('/api/admin/sessions/999/cancel', modSid)).statusCode).toBe(404);
  expect((await post('/api/admin/sessions/abc/cancel', modSid)).statusCode).toBe(400);
  expect(notifier.dms).toHaveLength(1);
});
