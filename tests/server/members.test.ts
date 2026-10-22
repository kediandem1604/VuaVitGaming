import type { PrismaClient } from '@prisma/client';
import { beforeEach, expect, test } from 'vitest';
import {
  accessLevelFromRoles,
  buildWelcomeText,
  formatMemberCode,
  listMembers,
  markMemberLeft,
  recordOAuthEmail,
  syncGuildMembers,
  updateProfile,
  upsertMemberFromGuild,
} from '../../src/server/modules/members/service.js';
import type { GuildMemberInfo } from '../../src/server/ports.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember } from '../helpers/factories.js';

beforeEach(resetDb);

const info = (id: string, roles: string[] = []): GuildMemberInfo => ({
  discordId: id,
  displayName: `User ${id}`,
  avatarUrl: null,
  roleIds: roles,
});

const addWebSession = (memberId: number) =>
  testDb.webSession.create({ data: { memberId, expiresAt: new Date('2026-10-23T12:00:00Z') } });

const webSessionCount = (memberId: number) => testDb.webSession.count({ where: { memberId } });

// ---------------------------------------------------------------------------
// Mã thành viên và quyền
// ---------------------------------------------------------------------------

test('formatMemberCode pads to 4 digits and leaves longer numbers alone', () => {
  expect(formatMemberCode(1)).toBe('GGD-0001');
  expect(formatMemberCode(42)).toBe('GGD-0042');
  expect(formatMemberCode(9999)).toBe('GGD-9999');
  expect(formatMemberCode(10000)).toBe('GGD-10000');
  expect(() => formatMemberCode(0)).toThrow();
  expect(() => formatMemberCode(1.5)).toThrow();
});

test('access level from roles', () => {
  const cfg = { adminRoleIds: ['r-admin'], modRoleIds: ['r-mod'] };
  expect(accessLevelFromRoles(['r-mod', 'r-admin'], cfg)).toBe('admin');
  expect(accessLevelFromRoles(['r-mod'], cfg)).toBe('mod');
  expect(accessLevelFromRoles([], cfg)).toBe('member');
  expect(accessLevelFromRoles(['r-other'], cfg)).toBe('member');
  // Nhiều role cùng cấp: khớp bất kỳ role nào là đủ.
  expect(accessLevelFromRoles(['b'], { adminRoleIds: ['a', 'b'], modRoleIds: [] })).toBe('admin');
});

// ---------------------------------------------------------------------------
// upsertMemberFromGuild
// ---------------------------------------------------------------------------

test('codes are sequential', async () => {
  const { ctx } = makeTestCtx();
  const first = await upsertMemberFromGuild(ctx, info('1'));
  const second = await upsertMemberFromGuild(ctx, info('2', ['r-mod']));

  expect(first.member.memberCode).toBe('GGD-0001');
  expect(second.member.memberCode).toBe('GGD-0002');
  expect(first).toMatchObject({ created: true, reactivated: false });
  expect(first.member).toMatchObject({
    discordId: '1',
    displayName: 'User 1',
    avatarUrl: null,
    status: 'active',
    accessLevel: 'member',
    email: null,
    leftAt: null,
  });
  expect(first.member.joinedAt.toISOString()).toBe('2026-10-22T12:00:00.000Z');
  expect(second.member.accessLevel).toBe('mod');
});

test('existing member updated, no new code', async () => {
  const { ctx } = makeTestCtx();
  const created = await upsertMemberFromGuild(ctx, info('1'));
  const updated = await upsertMemberFromGuild(ctx, {
    ...info('1', ['r-admin']),
    displayName: 'Tên mới',
    avatarUrl: 'https://cdn.example/a.png',
  });

  expect(updated).toMatchObject({ created: false, reactivated: false });
  expect(updated.member).toMatchObject({
    id: created.member.id,
    memberCode: 'GGD-0001',
    displayName: 'Tên mới',
    avatarUrl: 'https://cdn.example/a.png',
    accessLevel: 'admin',
    status: 'active',
  });
  expect(await testDb.member.count()).toBe(1);
  // Cập nhật không tiêu số nào của sequence.
  expect((await upsertMemberFromGuild(ctx, info('2'))).member.memberCode).toBe('GGD-0002');
});

test('rejoin keeps code', async () => {
  const { ctx, setNow } = makeTestCtx();
  const original = await upsertMemberFromGuild(ctx, info('1'));
  setNow('2026-10-22T13:00:00Z');
  await markMemberLeft(ctx, '1');
  expect(await testDb.member.findUniqueOrThrow({ where: { discordId: '1' } })).toMatchObject({
    status: 'left',
    leftAt: new Date('2026-10-22T13:00:00Z'),
  });

  setNow('2026-10-22T14:00:00Z');
  const r = await upsertMemberFromGuild(ctx, info('1'));
  expect(r).toMatchObject({
    created: false,
    reactivated: true,
    member: { memberCode: 'GGD-0001', status: 'active', leftAt: null },
  });
  // Ngày vào hội giữ nguyên lần đầu, không bị đặt lại khi quay lại.
  expect(r.member.joinedAt).toEqual(original.member.joinedAt);
  expect(await testDb.member.count()).toBe(1);
});

test('losing a creation race falls back to updating the winner row', async () => {
  const { ctx } = makeTestCtx();
  let raced = false;
  // Chen một dòng cho cùng discordId ngay sau khi service thấy "chưa có" — mô phỏng
  // bot join và bấm nút đến cùng lúc, một cách tất định.
  const db = testDb.$extends({
    query: {
      member: {
        async findUnique({ args, query }) {
          const found = await query(args);
          if (!found && !raced) {
            raced = true;
            await createMember(testDb, { discordId: 'race', displayName: 'Bên thắng' });
          }
          return found;
        },
      },
    },
  }) as unknown as PrismaClient;

  const r = await upsertMemberFromGuild({ ...ctx, db }, info('race', ['r-mod']));
  expect(raced).toBe(true);
  expect(r).toMatchObject({
    created: false,
    reactivated: false,
    member: { discordId: 'race', displayName: 'User race', memberCode: 'GGD-0001', accessLevel: 'mod' },
  });
  expect(await testDb.member.count()).toBe(1);
});

test('concurrent upserts for a new discordId yield one row and one code', async () => {
  const { ctx } = makeTestCtx();
  const results = await Promise.all(Array.from({ length: 5 }, () => upsertMemberFromGuild(ctx, info('1'))));

  const rows = await testDb.member.findMany({ where: { discordId: '1' } });
  expect(rows).toHaveLength(1);
  expect(results.filter((r) => r.created)).toHaveLength(1);
  expect(new Set(results.map((r) => r.member.id)).size).toBe(1);
  expect(new Set(results.map((r) => r.member.memberCode)).size).toBe(1);
  expect(rows[0]?.memberCode).toMatch(/^GGD-\d{4}$/);

  // Người tiếp theo vẫn nhận mã khác — không có hai dòng chung một mã.
  const next = await upsertMemberFromGuild(ctx, info('2'));
  expect(next.member.memberCode).not.toBe(rows[0]?.memberCode);
  expect(await testDb.member.count()).toBe(2);
});

// ---------------------------------------------------------------------------
// markMemberLeft / syncGuildMembers
// ---------------------------------------------------------------------------

test('markMemberLeft deletes web sessions, keeps first leftAt, ignores unknown ids', async () => {
  const { ctx, setNow } = makeTestCtx();
  const a = (await upsertMemberFromGuild(ctx, info('1'))).member;
  const b = (await upsertMemberFromGuild(ctx, info('2'))).member;
  await addWebSession(a.id);
  await addWebSession(a.id);
  await addWebSession(b.id);

  setNow('2026-10-22T13:00:00Z');
  await markMemberLeft(ctx, '1');
  expect(await webSessionCount(a.id)).toBe(0);
  expect(await webSessionCount(b.id)).toBe(1);
  expect(await testDb.member.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
    status: 'left',
    leftAt: new Date('2026-10-22T13:00:00Z'),
  });

  // Đã rời rồi thì giữ mốc rời ban đầu.
  setNow('2026-10-22T14:00:00Z');
  await markMemberLeft(ctx, '1');
  expect((await testDb.member.findUniqueOrThrow({ where: { id: a.id } })).leftAt).toEqual(
    new Date('2026-10-22T13:00:00Z'),
  );

  await expect(markMemberLeft(ctx, 'không-có')).resolves.toBeUndefined();
  expect(await testDb.member.count({ where: { status: 'active' } })).toBe(1);
  expect(await webSessionCount(b.id)).toBe(1);
});

test('sync marks absent members left and kills their web sessions', async () => {
  const { ctx, setNow } = makeTestCtx();
  const m1 = (await upsertMemberFromGuild(ctx, info('1'))).member;
  const m2 = (await upsertMemberFromGuild(ctx, info('2'))).member;
  await addWebSession(m1.id);
  await addWebSession(m2.id);

  setNow('2026-10-22T13:00:00Z');
  expect(await syncGuildMembers(ctx, [info('1'), info('3')])).toEqual({ created: 1, left: 1 });

  expect(await testDb.member.findUniqueOrThrow({ where: { id: m2.id } })).toMatchObject({
    status: 'left',
    leftAt: new Date('2026-10-22T13:00:00Z'),
  });
  expect(await webSessionCount(m2.id)).toBe(0);
  expect(await webSessionCount(m1.id)).toBe(1);
  expect(await testDb.member.findUniqueOrThrow({ where: { discordId: '3' } })).toMatchObject({
    memberCode: 'GGD-0003',
    status: 'active',
  });

  // Chạy lại cùng danh sách: không tạo, không đếm lại người đã rời.
  expect(await syncGuildMembers(ctx, [info('1'), info('3')])).toEqual({ created: 0, left: 0 });

  // Người đã rời xuất hiện lại: kích hoạt lại, không phải "tạo mới".
  expect(await syncGuildMembers(ctx, [info('1'), info('2'), info('3')])).toEqual({ created: 0, left: 0 });
  expect(await testDb.member.findUniqueOrThrow({ where: { id: m2.id } })).toMatchObject({
    memberCode: 'GGD-0002',
    status: 'active',
    leftAt: null,
  });
});

test('sync with an empty list marks everyone left', async () => {
  const { ctx } = makeTestCtx();
  await upsertMemberFromGuild(ctx, info('1'));
  await upsertMemberFromGuild(ctx, info('2'));
  expect(await syncGuildMembers(ctx, [])).toEqual({ created: 0, left: 2 });
  expect(await testDb.member.count({ where: { status: 'active' } })).toBe(0);
});

// ---------------------------------------------------------------------------
// Hồ sơ và email
// ---------------------------------------------------------------------------

test('updateProfile trims, clears and stores email and notify flags', async () => {
  const { ctx } = makeTestCtx();
  const m = (await upsertMemberFromGuild(ctx, info('1'))).member;

  const withEmail = await updateProfile(ctx, m.id, { email: '  An.Nguyen@Example.VN  ' });
  // Cắt khoảng trắng, giữ nguyên chữ hoa/thường.
  expect(withEmail.email).toBe('An.Nguyen@Example.VN');
  expect(withEmail).toMatchObject({ id: m.id, notifyEmail: true, notifyDm: true });

  const flags = await updateProfile(ctx, m.id, { notifyEmail: false, notifyDm: false });
  expect(flags).toMatchObject({ email: 'An.Nguyen@Example.VN', notifyEmail: false, notifyDm: false });

  expect((await updateProfile(ctx, m.id, { email: '' })).email).toBeNull();
  await updateProfile(ctx, m.id, { email: 'a@x.vn' });
  expect((await updateProfile(ctx, m.id, { email: null })).email).toBeNull();

  // Patch rỗng: không đổi gì, vẫn trả về thành viên.
  expect(await updateProfile(ctx, m.id, {})).toMatchObject({ email: null, notifyEmail: false, notifyDm: false });
});

test('invalid email rejected', async () => {
  const { ctx } = makeTestCtx();
  const m = (await upsertMemberFromGuild(ctx, info('1'))).member;
  await expect(updateProfile(ctx, m.id, { email: 'abc' })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Email không hợp lệ',
  });
  await expect(updateProfile(ctx, m.id, { email: 'a@' })).rejects.toMatchObject({ code: 'VALIDATION' });
  // Kiểu sai (từ body JSON) cũng bị chặn ở service.
  await expect(
    updateProfile(ctx, m.id, { notifyDm: 'có' as unknown as boolean }),
  ).rejects.toMatchObject({ code: 'VALIDATION' });
  expect((await testDb.member.findUniqueOrThrow({ where: { id: m.id } })).email).toBeNull();
});

test('updateProfile on unknown member is NOT_FOUND', async () => {
  const { ctx } = makeTestCtx();
  await expect(updateProfile(ctx, 999, { notifyDm: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('OAuth email never overwrites user email and ignores unverified', async () => {
  const { ctx } = makeTestCtx();
  const m = (await upsertMemberFromGuild(ctx, info('1'))).member;
  await updateProfile(ctx, m.id, { email: 'a@x.vn' });
  await recordOAuthEmail(ctx, m.id, 'b@x.vn', true);
  expect((await testDb.member.findUniqueOrThrow({ where: { id: m.id } })).email).toBe('a@x.vn');

  const fresh = (await upsertMemberFromGuild(ctx, info('2'))).member;
  await recordOAuthEmail(ctx, fresh.id, 'c@x.vn', false);
  expect((await testDb.member.findUniqueOrThrow({ where: { id: fresh.id } })).email).toBeNull();
  await recordOAuthEmail(ctx, fresh.id, null, true);
  await recordOAuthEmail(ctx, fresh.id, '', true);
  await recordOAuthEmail(ctx, fresh.id, 'không phải email', true);
  expect((await testDb.member.findUniqueOrThrow({ where: { id: fresh.id } })).email).toBeNull();

  await recordOAuthEmail(ctx, fresh.id, ' c@x.vn ', true);
  expect((await testDb.member.findUniqueOrThrow({ where: { id: fresh.id } })).email).toBe('c@x.vn');
});

// ---------------------------------------------------------------------------
// listMembers
// ---------------------------------------------------------------------------

test('listMembers filters by status and searches name, code and discordId', async () => {
  const { ctx } = makeTestCtx();
  // Tạo ngược thứ tự tên để chắc rằng kết quả sắp theo mã, không theo tên hay id.
  const c = await createMember(testDb, { displayName: 'Cường', discordId: 'snowflake-999' });
  const b = await createMember(testDb, { displayName: 'bình an', discordId: 'id-b' });
  const a = await createMember(testDb, { displayName: 'Ánh Dương', discordId: 'id-a' });
  await markMemberLeft(ctx, 'id-b');

  const codes = (rows: { memberCode: string }[]) => rows.map((r) => r.memberCode);
  expect(codes(await listMembers(ctx, {}))).toEqual([c.memberCode, b.memberCode, a.memberCode]);
  expect(codes(await listMembers(ctx, { status: 'active' }))).toEqual([c.memberCode, a.memberCode]);
  expect(codes(await listMembers(ctx, { status: 'left' }))).toEqual([b.memberCode]);

  expect(codes(await listMembers(ctx, { q: 'BÌNH' }))).toEqual([b.memberCode]); // tên, không phân biệt hoa thường
  expect(codes(await listMembers(ctx, { q: 'Dương' }))).toEqual([a.memberCode]);
  expect(codes(await listMembers(ctx, { q: 'ggd-0002' }))).toEqual([b.memberCode]); // mã
  expect(codes(await listMembers(ctx, { q: 'SNOW' }))).toEqual([c.memberCode]); // discordId
  expect(codes(await listMembers(ctx, { q: 'ggd-' }))).toHaveLength(3);
  expect(codes(await listMembers(ctx, { q: 'ggd-', status: 'left' }))).toEqual([b.memberCode]);
  expect(await listMembers(ctx, { q: 'không có ai' })).toEqual([]);
  // Chuỗi tìm toàn khoảng trắng = không lọc; ký tự đặc biệt của LIKE không phải wildcard.
  expect(codes(await listMembers(ctx, { q: '   ' }))).toHaveLength(3);
  expect(await listMembers(ctx, { q: '%' })).toEqual([]);
  expect(await listMembers(ctx, { q: 'ggd_0002' })).toEqual([]);
  expect(await listMembers(ctx, { q: '\\' })).toEqual([]);
});

// ---------------------------------------------------------------------------
// Lời chào
// ---------------------------------------------------------------------------

test('welcome text has code and link', async () => {
  const { ctx } = makeTestCtx();
  const member = (await upsertMemberFromGuild(ctx, { ...info('1'), displayName: 'An' })).member;

  const fresh = buildWelcomeText(member, 'http://localhost:3000', false);
  expect(fresh).toContain('GGD-0001');
  expect(fresh).toBe(
    'Chào mừng An đến với hội Goose Goose Duck! 🪿\n' +
      'Mã thành viên của bạn: GGD-0001\n' +
      'Đăng nhập hệ thống: http://localhost:3000',
  );

  const back = buildWelcomeText(member, 'http://localhost:3000', true);
  expect(back).toContain('Chào mừng trở lại');
  expect(back).toBe(
    'Chào mừng trở lại, An!\nMã thành viên của bạn: GGD-0001\nĐăng nhập hệ thống: http://localhost:3000',
  );
});
