/**
 * Mục treo thưởng (spec treo thưởng §3, §5): mod/admin thêm, sửa, tắt/bật, xoá trên web.
 *
 * Một mục có điểm 1–50, gắn một role (điểm vào bảng của role đó) hoặc không (chỉ vào Tổng
 * "Cả 3 phe"), áp dụng cho một buổi hoặc mọi buổi (`sessionId` null). Mục đã có lần nhận —
 * kể cả bị từ chối — không xoá được, chỉ tắt (khoá ngoại RESTRICT của `bounty_claims` chặn cả
 * khi có lần nhận chen vào giữa lúc kiểm tra và lúc xoá). Lần nhận chép `roleId`/`points`
 * của mục lúc nhận, nên sửa mục không đổi điểm đã có.
 *
 * Mọi thay đổi mục bật `bounty_dirty` (cùng giao dịch) trên các buổi chưa kết thúc bị ảnh
 * hưởng — buổi của mục (cả buổi cũ lẫn mới khi đổi), hoặc mọi buổi `scheduled` với mục mọi
 * buổi — để bộ hẹn giờ sửa tin trong `#treo-thưởng` (Task 3).
 *
 * "Mục áp dụng cho buổi S" (`bountiesForSession`) = mục đang bật có `sessionId = S` hoặc
 * null, theo điểm giảm dần rồi id.
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { BountyDto, BountyInput, BountyPatch } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { toVnDate } from '../../lib/time.js';

/** Client thường hoặc client trong giao dịch. */
type DbClient = Ctx['db'] | Prisma.TransactionClient;

const WITH_REFS = {
  role: { select: { id: true, nameVi: true, icon: true, faction: true } },
  session: { select: { id: true, startsAt: true, mode: { select: { nameVi: true } } } },
} satisfies Prisma.BountyInclude;

type BountyWithRefs = Prisma.BountyGetPayload<{ include: typeof WITH_REFS }>;

function toDto(b: BountyWithRefs, approvedClaims: number): BountyDto {
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    points: b.points,
    role: b.role,
    session: b.session ? { id: b.session.id, startsAt: b.session.startsAt.toISOString(), modeName: b.session.mode.nameVi } : null,
    active: b.active,
    approvedClaims,
  };
}

/** Số lần nhận đã duyệt của từng mục — một truy vấn gộp cho cả danh sách. */
async function approvedCounts(db: DbClient, ids: number[]): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const groups = await db.bountyClaim.groupBy({
    by: ['bountyId'],
    where: { bountyId: { in: ids }, status: 'approved' },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.bountyId, g._count._all]));
}

async function withCounts(db: DbClient, rows: BountyWithRefs[]): Promise<BountyDto[]> {
  const counts = await approvedCounts(db, rows.map((r) => r.id));
  return rows.map((r) => toDto(r, counts.get(r.id) ?? 0));
}

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

/** Mọi mục cho trang quản trị: đang bật trước, rồi đã tắt; trong mỗi nhóm mới nhất trước. */
export async function listBounties(ctx: Ctx): Promise<BountyDto[]> {
  const rows = await ctx.db.bounty.findMany({ include: WITH_REFS, orderBy: [{ active: 'desc' }, { id: 'desc' }] });
  return withCounts(ctx.db, rows);
}

/** Mục áp dụng cho buổi `sessionId`: đang bật, riêng buổi đó hoặc mọi buổi; điểm giảm dần rồi id. Không kiểm tra buổi có tồn tại. */
export async function bountiesForSession(ctx: Ctx, sessionId: number): Promise<BountyDto[]> {
  const rows = await ctx.db.bounty.findMany({
    where: { active: true, OR: [{ sessionId }, { sessionId: null }] },
    include: WITH_REFS,
    orderBy: [{ points: 'desc' }, { id: 'asc' }],
  });
  return withCounts(ctx.db, rows);
}

// ---------------------------------------------------------------------------
// Thêm / sửa / xoá
// ---------------------------------------------------------------------------

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Tên mục treo thưởng không được để trống')
  .max(80, 'Tên mục treo thưởng tối đa 80 ký tự');
const descriptionSchema = z.string().trim().max(200, 'Mô tả tối đa 200 ký tự').nullish();
const POINTS_MESSAGE = 'Điểm phải từ 1 đến 50';
const pointsSchema = z.number({ invalid_type_error: POINTS_MESSAGE }).int(POINTS_MESSAGE).min(1, POINTS_MESSAGE).max(50, POINTS_MESSAGE);
const idSchema = z.number().int().positive().max(2_147_483_647);

const createSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  points: pointsSchema,
  roleId: idSchema.nullable(),
  sessionId: idSchema.nullable(),
});

const patchSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema,
  points: pointsSchema.optional(),
  roleId: idSchema.nullable().optional(),
  sessionId: idSchema.nullable().optional(),
  active: z.boolean().optional(),
});

/** Lỗi zod không có thông báo riêng (sai kiểu…) → thông báo chung tiếng Việt. */
const defaultErrorMap: z.ZodErrorMap = () => ({ message: 'Dữ liệu không hợp lệ' });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  return parsed.data;
}

/** Tạo mục (đang bật). Dữ liệu sai, role không có/đang tắt, buổi không chọn được → `VALIDATION`. */
export async function createBounty(ctx: Ctx, createdById: number, input: BountyInput): Promise<BountyDto> {
  const p = parse(createSchema, input);
  if (p.roleId !== null) await assertRole(ctx, p.roleId);
  if (p.sessionId !== null) await assertSession(ctx, p.sessionId);

  const row = await ctx.db.$transaction(async (tx) => {
    const created = await tx.bounty.create({
      data: {
        title: p.title,
        description: emptyToNull(p.description),
        points: p.points,
        roleId: p.roleId,
        sessionId: p.sessionId,
        createdById,
      },
      include: WITH_REFS,
    });
    await markSessionsDirty(tx, [created.sessionId]);
    return created;
  });
  return toDto(row, 0);
}

/**
 * Sửa các trường được gửi (vắng mặt giữ nguyên); `active` để tắt/bật. Role/buổi chỉ kiểm tra khi
 * đổi (giữ nguyên role đã tắt sau đó vẫn được). Mục không có → `NOT_FOUND`.
 */
export async function updateBounty(ctx: Ctx, id: number, patch: BountyPatch): Promise<BountyDto> {
  const p = parse(patchSchema, patch);
  const existing = await ctx.db.bounty.findUnique({ where: { id }, select: { roleId: true, sessionId: true } });
  if (!existing) throw appError('NOT_FOUND');
  if (p.roleId != null && p.roleId !== existing.roleId) await assertRole(ctx, p.roleId);
  if (p.sessionId != null && p.sessionId !== existing.sessionId) await assertSession(ctx, p.sessionId);

  const data: Prisma.BountyUncheckedUpdateInput = {};
  if (p.title !== undefined) data.title = p.title;
  if (p.description !== undefined) data.description = emptyToNull(p.description);
  if (p.points !== undefined) data.points = p.points;
  if (p.roleId !== undefined) data.roleId = p.roleId;
  if (p.sessionId !== undefined) data.sessionId = p.sessionId;
  if (p.active !== undefined) data.active = p.active;

  const row = await ctx.db.$transaction(async (tx) => {
    const updated = await tx.bounty.update({ where: { id }, data, include: WITH_REFS });
    await markSessionsDirty(tx, [existing.sessionId, updated.sessionId]);
    return updated;
  });
  return (await withCounts(ctx.db, [row]))[0] as BountyDto;
}

/** Xoá mục chưa có lần nhận nào. Mục không có → `NOT_FOUND`; đã có lần nhận → `BOUNTY_HAS_CLAIMS`. */
export async function deleteBounty(ctx: Ctx, id: number): Promise<void> {
  const existing = await ctx.db.bounty.findUnique({ where: { id }, select: { sessionId: true, _count: { select: { claims: true } } } });
  if (!existing) throw appError('NOT_FOUND');
  if (existing._count.claims > 0) throw appError('BOUNTY_HAS_CLAIMS');
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.bounty.delete({ where: { id } });
      await markSessionsDirty(tx, [existing.sessionId]);
    });
  } catch (err) {
    // Lần nhận chen vào sau khi đếm: khoá ngoại RESTRICT chặn xoá.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw appError('BOUNTY_HAS_CLAIMS');
    // Bên khác vừa xoá trước.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw appError('NOT_FOUND');
    throw err;
  }
}

/**
 * Bật `bounty_dirty` trên các buổi `scheduled` bị ảnh hưởng: `null` trong danh sách = mục mọi
 * buổi → mọi buổi `scheduled`; còn lại chỉ các buổi được nêu.
 */
async function markSessionsDirty(tx: Prisma.TransactionClient, sessionIds: (number | null)[]): Promise<void> {
  const everySession = sessionIds.includes(null);
  const ids = [...new Set(sessionIds.filter((s): s is number => s !== null))];
  await tx.gameSession.updateMany({
    where: everySession ? { status: 'scheduled' } : { status: 'scheduled', id: { in: ids } },
    data: { bountyDirty: true },
  });
}

/** Role phải có và đang bật. */
async function assertRole(ctx: Ctx, roleId: number): Promise<void> {
  const role = await ctx.db.role.findUnique({ where: { id: roleId }, select: { active: true } });
  if (!role?.active) throw appError('VALIDATION', 'Role không hợp lệ');
}

/** Buổi chọn được: chưa kết thúc (`scheduled`), hoặc đã kết thúc nhưng diễn ra hôm nay (giờ VN). Buổi huỷ không chọn được. */
async function assertSession(ctx: Ctx, sessionId: number): Promise<void> {
  const s = await ctx.db.gameSession.findUnique({ where: { id: sessionId }, select: { status: true, startsAt: true } });
  const ok = s !== null && (s.status === 'scheduled' || (s.status === 'ended' && toVnDate(s.startsAt) === toVnDate(ctx.now())));
  if (!ok) throw appError('VALIDATION', 'Buổi chơi không hợp lệ');
}

function emptyToNull(s: string | null | undefined): string | null {
  return s ? s : null;
}
