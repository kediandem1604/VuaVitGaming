import { beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { clearRoleImage, detectImageMime, getRoleImage, setRoleImage } from '../../src/server/modules/roles/image.js';
import { createRole, listRoles, updateRole } from '../../src/server/modules/roles/service.js';
import type { RoleDto } from '../../src/shared/api-types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { roleByKey } from '../helpers/factories.js';

let ctx: Ctx;

beforeEach(async () => {
  await resetDb();
  ({ ctx } = makeTestCtx());
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

const DTO_KEYS = [
  'active',
  'description',
  'faction',
  'hasImage',
  'icon',
  'id',
  'key',
  'mapNote',
  'maxPerGame',
  'metricLabel',
  'modeKey',
  'nameEn',
  'nameVi',
  'sortOrder',
];

/** Dữ liệu tạo role hợp lệ tối thiểu; ghi đè từng trường qua `p`. */
const validInput = (p: Record<string, unknown> = {}) => ({
  key: 'test_role',
  faction: 'goose' as const,
  nameVi: 'Role thử',
  nameEn: 'Test Role',
  metricLabel: 'Số lần thử',
  maxPerGame: 5,
  icon: '🧪',
  ...p,
});

// ---------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------

test('lists active roles by faction then sortOrder, without image bytes', async () => {
  const roles = await listRoles(ctx);
  expect(roles).toHaveLength(71);

  // Phe theo thứ tự Ngỗng → Vịt → Phe thứ 3; trong phe theo sortOrder.
  const factions = roles.map((r) => r.faction);
  expect(factions.slice(0, 30).every((f) => f === 'goose')).toBe(true);
  expect(factions.slice(30, 61).every((f) => f === 'duck')).toBe(true);
  expect(factions.slice(61).every((f) => f === 'neutral')).toBe(true);
  for (const faction of ['goose', 'duck', 'neutral'] as const) {
    const orders = roles.filter((r) => r.faction === faction).map((r) => r.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  }

  // Role chế độ đặc biệt (tắt) không có; DTO đúng các khoá, không có `image`.
  expect(roles.some((r) => r.modeKey !== null)).toBe(false);
  for (const r of roles) expect(Object.keys(r).sort()).toEqual(DTO_KEYS);

  const swordsman = await roleByKey(testDb, 'swordsman');
  expect(roles.find((r) => r.key === 'swordsman')).toEqual({
    id: swordsman.id,
    key: 'swordsman',
    faction: 'duck',
    nameVi: 'Kiếm sĩ',
    nameEn: 'Swordsman',
    description: 'Vung kiếm chém mọi người đứng gần.',
    metricLabel: 'Số mạng chém',
    maxPerGame: 15,
    mapNote: 'Có từ v4.10 (08/2026)',
    modeKey: null,
    icon: '⚔️',
    hasImage: false,
    active: true,
    sortOrder: swordsman.sortOrder,
  });
});

test('includeInactive adds the special-mode roles with their mode key', async () => {
  const all = await listRoles(ctx, { includeInactive: true });
  expect(all).toHaveLength(91);
  expect(all.filter((r) => !r.active)).toHaveLength(20);
  expect(all.find((r) => r.key === 'inquisitor')).toMatchObject({ faction: 'goose', modeKey: 'corruption', active: false });
  expect(all.find((r) => r.key === 'hoot_sniper')).toMatchObject({ faction: 'duck', modeKey: 'hoot_seek', active: false });
  // Vẫn theo phe rồi sortOrder: role tắt của phe Ngỗng xếp chung phe Ngỗng.
  const firstDuck = all.findIndex((r) => r.faction === 'duck');
  expect(all.slice(0, firstDuck).every((r) => r.faction === 'goose')).toBe(true);
  expect(all.slice(firstDuck).some((r) => r.faction === 'goose')).toBe(false);

  // Admin bật một role chế độ đặc biệt → thành viên thấy nó.
  const owl = await roleByKey(testDb, 'owl');
  await updateRole(ctx, owl.id, { active: true });
  expect((await listRoles(ctx)).find((r) => r.key === 'owl')).toMatchObject({ active: true, modeKey: 'hoot_seek' });
});

// ---------------------------------------------------------------------------
// Thêm / sửa
// ---------------------------------------------------------------------------

test('createRole fills defaults and resolves the mode key', async () => {
  const created = await createRole(ctx, validInput());
  expect(created).toEqual({
    id: created.id,
    key: 'test_role',
    faction: 'goose',
    nameVi: 'Role thử',
    nameEn: 'Test Role',
    description: '',
    metricLabel: 'Số lần thử',
    maxPerGame: 5,
    mapNote: null,
    modeKey: null,
    icon: '🧪',
    hasImage: false,
    active: true,
    sortOrder: 31, // sau 30 role Ngỗng
  });
  // Đứng cuối phe Ngỗng (vị trí 31), trước role Vịt đầu tiên.
  const listed = await listRoles(ctx);
  expect(listed.at(30)?.key).toBe('test_role');
  expect(listed.at(31)?.faction).toBe('duck');

  const special = await createRole(
    ctx,
    validInput({
      key: 'ghost_duck',
      faction: 'duck',
      nameVi: '  Vịt ma  ',
      description: '  Vịt đã chết vẫn ám  ',
      mapNote: '   ',
      modeKey: 'corruption',
      active: false,
      sortOrder: 0,
    }),
  );
  expect(special).toMatchObject({
    key: 'ghost_duck',
    faction: 'duck',
    nameVi: 'Vịt ma',
    description: 'Vịt đã chết vẫn ám',
    mapNote: null,
    modeKey: 'corruption',
    active: false,
    sortOrder: 0,
  });
  expect((await testDb.role.findUniqueOrThrow({ where: { key: 'ghost_duck' }, include: { mode: true } })).mode?.key).toBe('corruption');
  expect(await testDb.role.count()).toBe(93);
});

test('createRole validation', async () => {
  const reject = (p: Record<string, unknown>, message: string) =>
    expect(createRole(ctx, validInput(p))).rejects.toMatchObject({ code: 'VALIDATION', message });

  await reject({ key: 'swordsman' }, 'Key đã tồn tại');
  for (const key of ['', 'a', 'A_role', '1role', 'role-x', 'rôle', 'a'.repeat(41)]) {
    await expect(createRole(ctx, validInput({ key })), key).rejects.toMatchObject({ code: 'VALIDATION' });
  }
  await reject({ nameVi: '  ' }, 'Tên tiếng Việt phải từ 1 đến 60 ký tự');
  await reject({ nameEn: 'x'.repeat(61) }, 'Tên tiếng Anh phải từ 1 đến 60 ký tự');
  await reject({ description: 'x'.repeat(301) }, 'Mô tả tối đa 300 ký tự');
  await reject({ metricLabel: '' }, 'Tên chỉ số phải từ 1 đến 60 ký tự');
  await reject({ maxPerGame: 0 }, 'Tối đa mỗi trận phải từ 1 đến 100');
  await reject({ maxPerGame: 101 }, 'Tối đa mỗi trận phải từ 1 đến 100');
  await reject({ maxPerGame: 1.5 }, 'Tối đa mỗi trận phải từ 1 đến 100');
  await reject({ mapNote: 'x'.repeat(81) }, 'Ghi chú bản đồ tối đa 80 ký tự');
  await reject({ icon: '' }, 'Biểu tượng phải từ 1 đến 8 ký tự');
  await reject({ icon: '🪿🪿🪿🪿🪿' }, 'Biểu tượng phải từ 1 đến 8 ký tự');
  await reject({ sortOrder: 2_147_483_648 }, 'Thứ tự không hợp lệ');
  await reject({ sortOrder: 1.5 }, 'Thứ tự không hợp lệ');
  await reject({ modeKey: 'no_such_mode' }, 'Chế độ chơi không hợp lệ');
  // Sai kiểu → thông báo chung.
  await reject({ faction: 'alien' }, 'Dữ liệu không hợp lệ');
  await reject({ nameVi: 1 }, 'Dữ liệu không hợp lệ');

  expect(await testDb.role.count()).toBe(91);
});

test('updateRole changes the editable fields only', async () => {
  const swordsman = await roleByKey(testDb, 'swordsman');
  const updated = await updateRole(ctx, swordsman.id, { metricLabel: ' Số người bị chém ', maxPerGame: 16, mapNote: null });
  expect(updated).toMatchObject({ id: swordsman.id, key: 'swordsman', metricLabel: 'Số người bị chém', maxPerGame: 16, mapNote: null });
  expect((await listRoles(ctx)).find((r) => r.key === 'swordsman')).toEqual(updated);

  // Tắt → biến mất khỏi danh sách thành viên; đổi phe → xếp lại.
  const hidden = await updateRole(ctx, swordsman.id, { active: false });
  expect(hidden.active).toBe(false);
  expect((await listRoles(ctx)).some((r) => r.key === 'swordsman')).toBe(false);
  const moved = await updateRole(ctx, swordsman.id, { active: true, faction: 'neutral', sortOrder: 0 });
  expect(moved).toMatchObject({ faction: 'neutral', sortOrder: 0 });
  const roles = await listRoles(ctx);
  expect(roles.findIndex((r) => r.key === 'swordsman')).toBe(roles.findIndex((r) => r.faction === 'neutral'));

  // Patch rỗng: không đổi gì.
  expect(await updateRole(ctx, swordsman.id, {})).toEqual(moved);

  await expect(updateRole(ctx, swordsman.id, { maxPerGame: 0 })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Tối đa mỗi trận phải từ 1 đến 100',
  });
  await expect(updateRole(ctx, swordsman.id, { nameVi: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateRole(ctx, 9999, { nameVi: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  // Key, id và ảnh không sửa qua đây (kiểu đã chặn; thêm trường lạ cũng bị từ chối).
  await expect(updateRole(ctx, swordsman.id, { key: 'other' } as never)).rejects.toMatchObject({ code: 'VALIDATION' });
  expect((await roleByKey(testDb, 'swordsman')).maxPerGame).toBe(16);
});

// ---------------------------------------------------------------------------
// Ảnh
// ---------------------------------------------------------------------------

test('magic bytes', () => {
  expect(detectImageMime(png)).toBe('image/png');
  expect(detectImageMime(jpg)).toBe('image/jpeg');
  expect(detectImageMime(webp)).toBe('image/webp');
  expect(detectImageMime(Buffer.from('<svg></svg>'))).toBeNull();
  expect(detectImageMime(Buffer.alloc(0))).toBeNull();
  // Thiếu một byte của chữ ký → không nhận; 'RIFF' mà không phải WEBP (vd WAV) → không nhận.
  expect(detectImageMime(png.subarray(0, 7))).toBeNull();
  expect(detectImageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]))).toBeNull();
});

test('oversized image rejected', async () => {
  const r = await roleByKey(testDb, 'swordsman');
  await expect(setRoleImage(ctx, r.id, Buffer.concat([png, Buffer.alloc(1_048_577)]))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  // Đúng 1 MiB thì được.
  await setRoleImage(ctx, r.id, Buffer.concat([png, Buffer.alloc(1_048_576 - png.length)]));
  expect((await getRoleImage(ctx, r.id))?.buf.length).toBe(1_048_576);
});

test('image round trip stores the detected mime', async () => {
  const r = await roleByKey(testDb, 'swordsman');
  expect(await getRoleImage(ctx, r.id)).toBeNull();

  await setRoleImage(ctx, r.id, png);
  const stored = await getRoleImage(ctx, r.id);
  expect(stored?.mime).toBe('image/png');
  expect(Buffer.isBuffer(stored?.buf)).toBe(true);
  expect(stored?.buf.equals(png)).toBe(true);
  expect((await listRoles(ctx)).find((x) => x.key === 'swordsman')?.hasImage).toBe(true);

  // Đổi ảnh: mime đổi theo nội dung.
  await setRoleImage(ctx, r.id, webp);
  expect(await getRoleImage(ctx, r.id)).toEqual({ buf: webp, mime: 'image/webp' });

  // File giả ảnh → từ chối, ảnh cũ giữ nguyên.
  await expect(setRoleImage(ctx, r.id, Buffer.from('hello'))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  expect((await getRoleImage(ctx, r.id))?.mime).toBe('image/webp');

  await clearRoleImage(ctx, r.id);
  expect(await getRoleImage(ctx, r.id)).toBeNull();
  expect(await testDb.role.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ image: null, imageMime: null });
  expect((await listRoles(ctx)).find((x) => x.key === 'swordsman')?.hasImage).toBe(false);
  // Xoá lần nữa vô hại.
  await clearRoleImage(ctx, r.id);

  // Role không có → NOT_FOUND khi ghi/xoá, null khi đọc.
  await expect(setRoleImage(ctx, 9999, png)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(clearRoleImage(ctx, 9999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await getRoleImage(ctx, 9999)).toBeNull();
});

test('createRole and updateRole never return image bytes', async () => {
  const r = await roleByKey(testDb, 'swordsman');
  await setRoleImage(ctx, r.id, jpg);
  const dto: RoleDto = await updateRole(ctx, r.id, { nameVi: 'Kiếm sĩ' });
  expect(Object.keys(dto).sort()).toEqual(DTO_KEYS);
  expect(dto.hasImage).toBe(true);
  expect(Object.keys(await createRole(ctx, validInput())).sort()).toEqual(DTO_KEYS);
});
