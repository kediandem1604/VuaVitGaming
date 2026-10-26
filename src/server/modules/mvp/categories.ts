/**
 * Hạng mục tri ân (spec §4.5): admin thêm / sửa / ẩn trên web; ba phạm vi:
 * `always` (buổi nào cũng có), `mode` (chỉ buổi đúng chế độ chơi — phải có `modeId`),
 * `optional` (theo role, admin tick thêm khi kết thúc buổi).
 *
 * Hạng mục "áp dụng" cho một buổi = đang bật và (always | mode khớp | optional).
 * Hạng mục "mặc định" (tick sẵn, dùng khi buổi tự kết thúc) = always + mode khớp.
 * Thứ tự hiển thị mọi nơi: `sortOrder` rồi `id`.
 */

import type { AwardCategory, BadgeGroup, CategoryScope, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';

const CATEGORY_ORDER = [{ sortOrder: 'asc' }, { id: 'asc' }] satisfies Prisma.AwardCategoryOrderByWithRelationInput[];

/** Chế độ chơi đi kèm (chỉ hạng mục `mode` có), đủ cho trang quản trị hiển thị. */
const WITH_MODE = { mode: { select: { id: true, key: true, nameVi: true } } } satisfies Prisma.AwardCategoryInclude;

/** Hạng mục kèm chế độ chơi của nó (null khi không theo chế độ) — dạng trang quản trị cần. */
export type AwardCategoryWithMode = Prisma.AwardCategoryGetPayload<{ include: typeof WITH_MODE }>;

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

/** Mọi hạng mục đang bật (hoặc tất cả với `includeInactive`), kèm chế độ chơi, theo sortOrder rồi id. */
export function listCategories(ctx: Ctx, opts: { includeInactive?: boolean } = {}): Promise<AwardCategoryWithMode[]> {
  return ctx.db.awardCategory.findMany({
    where: opts.includeInactive ? {} : { active: true },
    include: WITH_MODE,
    orderBy: CATEGORY_ORDER,
  });
}

/** Hạng mục áp dụng được cho một buổi chế độ `modeId`, theo sortOrder rồi id. */
export function listApplicableCategories(ctx: Ctx, modeId: number): Promise<AwardCategory[]> {
  return ctx.db.awardCategory.findMany({
    where: { active: true, OR: [{ scope: 'always' }, { scope: 'mode', modeId }, { scope: 'optional' }] },
    orderBy: CATEGORY_ORDER,
  });
}

/** Id các hạng mục tick sẵn cho buổi chế độ `modeId`: always + mode khớp, đang bật, theo sortOrder rồi id. */
export async function defaultCategoryIds(ctx: Ctx, modeId: number): Promise<number[]> {
  const rows = await ctx.db.awardCategory.findMany({
    where: { active: true, OR: [{ scope: 'always' }, { scope: 'mode', modeId }] },
    select: { id: true },
    orderBy: CATEGORY_ORDER,
  });
  return rows.map((r) => r.id);
}

export interface EndOption {
  id: number;
  name: string;
  scope: CategoryScope;
  /** Tick sẵn: always và mode khớp; optional để trống cho admin tick thêm. */
  preselected: boolean;
}

/** Danh sách hạng mục cho form "Kết thúc buổi" của buổi `sessionId`; buổi không có → `NOT_FOUND`. */
export async function endOptions(ctx: Ctx, sessionId: number): Promise<EndOption[]> {
  const session = await ctx.db.gameSession.findUnique({ where: { id: sessionId }, select: { modeId: true } });
  if (!session) throw appError('NOT_FOUND');
  const rows = await listApplicableCategories(ctx, session.modeId);
  return rows.map((c) => ({ id: c.id, name: c.name, scope: c.scope, preselected: c.scope !== 'optional' }));
}

// ---------------------------------------------------------------------------
// Thêm / sửa
// ---------------------------------------------------------------------------

export interface CategoryInput {
  scope: CategoryScope;
  /** Bắt buộc với `mode`, phải để trống với phạm vi khác. */
  modeId?: number | null;
  /** Cắt khoảng trắng, 1–80 ký tự. */
  name: string;
  /** Cắt khoảng trắng, tối đa 200 ký tự; rỗng → null. */
  description?: string | null;
  /** Mặc định khi tạo: sau hạng mục cuối cùng hiện có. */
  sortOrder?: number;
  /** Tính cho danh hiệu tháng: `mvp` (Khen), `fun` (Vui), `none` (không tính — mặc định khi tạo). */
  badgeGroup?: BadgeGroup;
}

export interface CategoryPatch extends Partial<CategoryInput> {
  active?: boolean;
}

const scopeSchema = z.enum(['always', 'mode', 'optional']);
const badgeGroupSchema = z.enum(['mvp', 'fun', 'none']);
const modeIdSchema = z.number().int().nullish();
const nameSchema = z
  .string()
  .trim()
  .min(1, 'Tên hạng mục không được để trống')
  .max(80, 'Tên hạng mục tối đa 80 ký tự');
const descriptionSchema = z.string().trim().max(200, 'Mô tả tối đa 200 ký tự').nullish();
const sortOrderSchema = z.number().int('Thứ tự phải là số nguyên');

const createSchema = z.object({
  scope: scopeSchema,
  modeId: modeIdSchema,
  name: nameSchema,
  description: descriptionSchema,
  sortOrder: sortOrderSchema.optional(),
  badgeGroup: badgeGroupSchema.optional(),
});

const patchSchema = z.object({
  scope: scopeSchema.optional(),
  modeId: modeIdSchema,
  name: nameSchema.optional(),
  description: descriptionSchema,
  sortOrder: sortOrderSchema.optional(),
  active: z.boolean().optional(),
  badgeGroup: badgeGroupSchema.optional(),
});

/** Lỗi zod không có thông báo riêng (sai kiểu…) → thông báo chung tiếng Việt. */
const defaultErrorMap: z.ZodErrorMap = () => ({ message: 'Dữ liệu không hợp lệ' });

/** Tạo hạng mục (trả về kèm chế độ chơi). Dữ liệu sai hoặc vi phạm quy tắc phạm vi ⇔ chế độ → `VALIDATION`. */
export async function createCategory(ctx: Ctx, input: CategoryInput): Promise<AwardCategoryWithMode> {
  const parsed = createSchema.safeParse(input, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  const { scope, name, description, sortOrder, badgeGroup } = parsed.data;
  const modeId = parsed.data.modeId ?? null;

  checkScopeMode(scope, modeId);
  if (modeId !== null) await assertModeExists(ctx, modeId);

  return ctx.db.awardCategory.create({
    data: {
      scope,
      modeId,
      name,
      description: emptyToNull(description),
      sortOrder: sortOrder ?? (await nextSortOrder(ctx)),
      badgeGroup: badgeGroup ?? 'none',
    },
    include: WITH_MODE,
  });
}

/**
 * Sửa các trường được truyền (trường vắng mặt giữ nguyên). Quy tắc phạm vi ⇔ chế độ
 * được kiểm tra trên dòng sau khi gộp: đổi `scope` sang khác `mode` thì phải gửi
 * kèm `modeId: null`. Hạng mục không có → `NOT_FOUND`. Trả về kèm chế độ chơi.
 */
export async function updateCategory(ctx: Ctx, id: number, patch: CategoryPatch): Promise<AwardCategoryWithMode> {
  const parsed = patchSchema.safeParse(patch, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  const p = parsed.data;

  const existing = await ctx.db.awardCategory.findUnique({ where: { id } });
  if (!existing) throw appError('NOT_FOUND');

  const scope = p.scope ?? existing.scope;
  const modeId = p.modeId === undefined ? existing.modeId : p.modeId;
  checkScopeMode(scope, modeId);
  if (modeId !== null && modeId !== existing.modeId) await assertModeExists(ctx, modeId);

  const data: Prisma.AwardCategoryUncheckedUpdateInput = { scope, modeId };
  if (p.name !== undefined) data.name = p.name;
  if (p.description !== undefined) data.description = emptyToNull(p.description);
  if (p.sortOrder !== undefined) data.sortOrder = p.sortOrder;
  if (p.active !== undefined) data.active = p.active;
  if (p.badgeGroup !== undefined) data.badgeGroup = p.badgeGroup;

  return ctx.db.awardCategory.update({ where: { id }, data, include: WITH_MODE });
}

/** Ràng buộc CHECK trong DB: `scope = 'mode'` ⇔ `modeId` khác null — báo lỗi tiếng Việt trước khi DB từ chối. */
function checkScopeMode(scope: CategoryScope, modeId: number | null): void {
  if (scope === 'mode' && modeId === null) throw appError('VALIDATION', 'Hạng mục theo chế độ phải chọn chế độ chơi');
  if (scope !== 'mode' && modeId !== null) throw appError('VALIDATION', 'Chỉ hạng mục theo chế độ mới có chế độ chơi');
}

async function assertModeExists(ctx: Ctx, modeId: number): Promise<void> {
  const mode = await ctx.db.gameMode.findUnique({ where: { id: modeId }, select: { id: true } });
  if (!mode) throw appError('VALIDATION', 'Chế độ chơi không hợp lệ');
}

async function nextSortOrder(ctx: Ctx): Promise<number> {
  const { _max } = await ctx.db.awardCategory.aggregate({ _max: { sortOrder: true } });
  return (_max.sortOrder ?? 0) + 1;
}

function emptyToNull(s: string | null | undefined): string | null {
  return s ? s : null;
}
