/**
 * Danh mục role (spec §4.6, §6): 71 role chính của ba phe nạp sẵn và bật; 20 role
 * riêng của chế độ đặc biệt nạp sẵn nhưng tắt, admin xác nhận rồi bật. Admin sửa
 * tên, mô tả, chỉ số, giới hạn, biểu tượng, thứ tự, bật/tắt và thêm role mới khi
 * game cập nhật; `key` đặt một lần khi tạo. Ảnh tuỳ chỉnh ở `image.ts`.
 *
 * Thứ tự hiển thị mọi nơi: phe Ngỗng → Vịt → Phe thứ 3, rồi `sortOrder`, rồi `id`.
 * DTO không bao giờ chứa ảnh (không kéo 91 blob khi liệt kê).
 */

import { Prisma } from '@prisma/client';
import type { Faction } from '@prisma/client';
import { z } from 'zod';
import type { RoleDto } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';

const FACTION_RANK: Record<Faction, number> = { goose: 0, duck: 1, neutral: 2 };

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/** Mọi cột trừ `image`, kèm key chế độ chơi. `imageMime` thay cho "có ảnh" (xem `hasImage`). */
const ROLE_SELECT = {
  id: true,
  key: true,
  faction: true,
  nameVi: true,
  nameEn: true,
  description: true,
  metricLabel: true,
  maxPerGame: true,
  mapNote: true,
  icon: true,
  active: true,
  sortOrder: true,
  imageMime: true,
  mode: { select: { key: true } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

/**
 * `hasImage` suy từ `imageMime`: `image.ts` luôn ghi và xoá hai cột `image`/`imageMime`
 * cùng nhau, nên không cần tải blob để biết role có ảnh hay không.
 */
function toRoleDto(r: RoleRow): RoleDto {
  return {
    id: r.id,
    key: r.key,
    faction: r.faction,
    nameVi: r.nameVi,
    nameEn: r.nameEn,
    description: r.description,
    metricLabel: r.metricLabel,
    maxPerGame: r.maxPerGame,
    mapNote: r.mapNote,
    modeKey: r.mode?.key ?? null,
    icon: r.icon,
    hasImage: r.imageMime !== null,
    active: r.active,
    sortOrder: r.sortOrder,
  };
}

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

/** Role đang bật (hoặc tất cả với `includeInactive`), theo phe → sortOrder → id. */
export async function listRoles(ctx: Ctx, opts: { includeInactive?: boolean } = {}): Promise<RoleDto[]> {
  const rows = await ctx.db.role.findMany({
    where: opts.includeInactive ? {} : { active: true },
    select: ROLE_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  // Sắp xếp ổn định: giữ thứ tự sortOrder/id của DB bên trong mỗi phe.
  rows.sort((a, b) => FACTION_RANK[a.faction] - FACTION_RANK[b.faction]);
  return rows.map(toRoleDto);
}

// ---------------------------------------------------------------------------
// Thêm / sửa
// ---------------------------------------------------------------------------

export interface RoleInput {
  /** Chữ thường, số, gạch dưới; bắt đầu bằng chữ; 2–40 ký tự. Không sửa được sau khi tạo. */
  key: string;
  faction: Faction;
  /** Cắt khoảng trắng, 1–60 ký tự. */
  nameVi: string;
  /** Cắt khoảng trắng, 1–60 ký tự. */
  nameEn: string;
  /** Cắt khoảng trắng, tối đa 300 ký tự; mặc định rỗng. */
  description?: string;
  /** Cắt khoảng trắng, 1–60 ký tự. */
  metricLabel: string;
  /** 1–100. */
  maxPerGame: number;
  /** Cắt khoảng trắng, tối đa 80 ký tự; rỗng → null. */
  mapNote?: string | null;
  /** Emoji, 1–8 ký tự (đơn vị UTF-16). */
  icon: string;
  /** Mặc định bật. */
  active?: boolean;
  /** Mặc định: sau role cuối cùng của phe. */
  sortOrder?: number;
  /** Key chế độ chơi với role riêng của chế độ đặc biệt; phải tồn tại. */
  modeKey?: string | null;
}

/** Các trường sửa được: không có `key`, `modeKey` và ảnh. */
export type RolePatch = Partial<Omit<RoleInput, 'key' | 'modeKey'>>;

const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Key chỉ gồm chữ thường, số và gạch dưới, bắt đầu bằng chữ, 2–40 ký tự');
const factionSchema = z.enum(['goose', 'duck', 'neutral']);
const nameViSchema = z.string().trim().min(1, 'Tên tiếng Việt phải từ 1 đến 60 ký tự').max(60, 'Tên tiếng Việt phải từ 1 đến 60 ký tự');
const nameEnSchema = z.string().trim().min(1, 'Tên tiếng Anh phải từ 1 đến 60 ký tự').max(60, 'Tên tiếng Anh phải từ 1 đến 60 ký tự');
const descriptionSchema = z.string().trim().max(300, 'Mô tả tối đa 300 ký tự');
const metricLabelSchema = z.string().trim().min(1, 'Tên chỉ số phải từ 1 đến 60 ký tự').max(60, 'Tên chỉ số phải từ 1 đến 60 ký tự');
const maxPerGameSchema = z
  .number()
  .int('Tối đa mỗi trận phải từ 1 đến 100')
  .min(1, 'Tối đa mỗi trận phải từ 1 đến 100')
  .max(100, 'Tối đa mỗi trận phải từ 1 đến 100');
const mapNoteSchema = z.string().trim().max(80, 'Ghi chú bản đồ tối đa 80 ký tự').nullish();
const iconSchema = z.string().trim().min(1, 'Biểu tượng phải từ 1 đến 8 ký tự').max(8, 'Biểu tượng phải từ 1 đến 8 ký tự');
const sortOrderSchema = z.number().int('Thứ tự không hợp lệ').min(INT32_MIN, 'Thứ tự không hợp lệ').max(INT32_MAX, 'Thứ tự không hợp lệ');
const modeKeySchema = z.string().nullish();

const createSchema = z
  .object({
    key: keySchema,
    faction: factionSchema,
    nameVi: nameViSchema,
    nameEn: nameEnSchema,
    description: descriptionSchema.default(''),
    metricLabel: metricLabelSchema,
    maxPerGame: maxPerGameSchema,
    mapNote: mapNoteSchema,
    icon: iconSchema,
    active: z.boolean().default(true),
    sortOrder: sortOrderSchema.optional(),
    modeKey: modeKeySchema,
  })
  .strict();

const patchSchema = z
  .object({
    faction: factionSchema.optional(),
    nameVi: nameViSchema.optional(),
    nameEn: nameEnSchema.optional(),
    description: descriptionSchema.optional(),
    metricLabel: metricLabelSchema.optional(),
    maxPerGame: maxPerGameSchema.optional(),
    mapNote: mapNoteSchema,
    icon: iconSchema.optional(),
    active: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict();

/** Lỗi zod không có thông báo riêng (sai kiểu, trường lạ…) → thông báo chung tiếng Việt. */
const defaultErrorMap: z.ZodErrorMap = () => ({ message: 'Dữ liệu không hợp lệ' });

/** Tạo role mới. Dữ liệu sai → `VALIDATION` (key trùng: 'Key đã tồn tại'); `modeKey` không có → `VALIDATION`. */
export async function createRole(ctx: Ctx, input: RoleInput): Promise<RoleDto> {
  const parsed = createSchema.safeParse(input, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  const { modeKey, mapNote, sortOrder, ...fields } = parsed.data;

  const modeId = modeKey ? await modeIdByKey(ctx, modeKey) : null;
  const order = sortOrder ?? (await nextSortOrder(ctx, fields.faction));
  try {
    const row = await ctx.db.role.create({
      data: { ...fields, modeId, mapNote: emptyToNull(mapNote), sortOrder: order },
      select: ROLE_SELECT,
    });
    return toRoleDto(row);
  } catch (err) {
    // `key` là cột unique duy nhất của roles → trùng key, kể cả khi hai admin tạo cùng lúc.
    if (isUniqueViolation(err)) throw appError('VALIDATION', 'Key đã tồn tại');
    throw err;
  }
}

/**
 * Sửa các trường được truyền (trường vắng mặt giữ nguyên); `key`, chế độ chơi và
 * ảnh không sửa qua đây. Role không có → `NOT_FOUND`.
 */
export async function updateRole(ctx: Ctx, id: number, patch: RolePatch): Promise<RoleDto> {
  const parsed = patchSchema.safeParse(patch, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  const { mapNote, ...rest } = parsed.data;

  const data: Prisma.RoleUncheckedUpdateInput = { ...rest };
  if (mapNote !== undefined) data.mapNote = emptyToNull(mapNote);

  const existing = await ctx.db.role.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw appError('NOT_FOUND');
  return toRoleDto(await ctx.db.role.update({ where: { id }, data, select: ROLE_SELECT }));
}

async function modeIdByKey(ctx: Ctx, key: string): Promise<number> {
  const mode = await ctx.db.gameMode.findUnique({ where: { key }, select: { id: true } });
  if (!mode) throw appError('VALIDATION', 'Chế độ chơi không hợp lệ');
  return mode.id;
}

/** Sau role cuối cùng của phe (role tắt cũng tính). */
async function nextSortOrder(ctx: Ctx, faction: Faction): Promise<number> {
  const { _max } = await ctx.db.role.aggregate({ where: { faction }, _max: { sortOrder: true } });
  return (_max.sortOrder ?? 0) + 1;
}

function emptyToNull(s: string | null | undefined): string | null {
  return s ? s : null;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
