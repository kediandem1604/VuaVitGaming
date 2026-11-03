/**
 * Danh mục role (spec §4.6, §6): 71 role chính của ba phe nạp sẵn và bật; 20 role
 * riêng của chế độ đặc biệt nạp sẵn nhưng tắt, admin xác nhận rồi bật. Admin sửa
 * tên, mô tả, chỉ số, giới hạn, biểu tượng, thứ tự, bật/tắt và thêm role mới khi
 * game cập nhật; `key` đặt một lần khi tạo. Ảnh tuỳ chỉnh ở `image.ts`. Role có thể
 * có chỉ số phụ được nhân điểm (ba trường `extra*`, spec chỉ số phụ §3–5), điểm mỗi đơn vị
 * chỉ số chính (`points`, 1–100, mặc định 1) và chỉ số phạt bị TRỪ điểm (ba trường
 * `penalty*`, spec điểm role §3, §5) — admin đặt cả hai khi tạo hoặc sửa role.
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
  points: true,
  extraMetricLabel: true,
  extraMaxPerGame: true,
  extraPoints: true,
  penaltyMetricLabel: true,
  penaltyMaxPerGame: true,
  penaltyPoints: true,
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
    points: r.points,
    extraMetricLabel: r.extraMetricLabel,
    extraMaxPerGame: r.extraMaxPerGame,
    extraPoints: r.extraPoints,
    penaltyMetricLabel: r.penaltyMetricLabel,
    penaltyMaxPerGame: r.penaltyMaxPerGame,
    penaltyPoints: r.penaltyPoints,
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
  /** Điểm mỗi đơn vị chỉ số chính (spec điểm role §3), 1–100; mặc định 1. */
  points?: number;
  /**
   * Chỉ số phụ (spec chỉ số phụ §5): gửi đủ cả ba hoặc bỏ trống/null cả ba; thiếu một → `VALIDATION`.
   * Tên cắt khoảng trắng, 1–60 ký tự; tối đa mỗi trận 1–100; điểm mỗi lần 1–100.
   */
  extraMetricLabel?: string | null;
  extraMaxPerGame?: number | null;
  extraPoints?: number | null;
  /**
   * Chỉ số phạt (spec điểm role §3, §5): cùng luật "đủ cả ba hoặc null cả ba" như chỉ số phụ.
   * Tên cắt khoảng trắng, 1–60 ký tự; tối đa mỗi trận 1–100 (DB không có CHECK cho cột này —
   * chỉ service kiểm); điểm trừ mỗi lần 1–100 (số dương, được TRỪ khi tính điểm).
   */
  penaltyMetricLabel?: string | null;
  penaltyMaxPerGame?: number | null;
  penaltyPoints?: number | null;
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

/**
 * Các trường sửa được: không có `key`, `modeKey` và ảnh. Ba trường chỉ số phụ (và ba trường
 * chỉ số phạt) ghép lên giá trị hiện có của role rồi mới kiểm "cùng có hoặc cùng null": đổi
 * lẻ một trường khi đã bật thì được; bật phải gửi đủ ba; tắt phải gửi null cả ba.
 */
export type RolePatch = Partial<Omit<RoleInput, 'key' | 'modeKey'>>;

/** Ba trường chỉ số phụ sau khi kiểm tra: cùng có hoặc cùng null. */
type ExtraMetric = { extraMetricLabel: string | null; extraMaxPerGame: number | null; extraPoints: number | null };
/** Ba trường chỉ số phạt sau khi kiểm tra: cùng có hoặc cùng null. */
type PenaltyMetric = { penaltyMetricLabel: string | null; penaltyMaxPerGame: number | null; penaltyPoints: number | null };

const EXTRA_INCOMPLETE_MESSAGE = 'Chỉ số phụ cần đủ cả ba: tên, tối đa mỗi trận và điểm mỗi lần';
const EXTRA_IN_USE_MESSAGE = 'Role đã có lần khai dùng chỉ số phụ, không tắt được';
const PENALTY_INCOMPLETE_MESSAGE = 'Chỉ số phạt cần đủ cả ba: tên, tối đa mỗi trận và điểm trừ mỗi lần';
/** Nguyên văn spec điểm role §5. */
const PENALTY_IN_USE_MESSAGE = 'Role đã có lần khai dùng chỉ số phạt, không tắt được';

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
const pointsSchema = z
  .number()
  .int('Điểm mỗi lần phải từ 1 đến 100')
  .min(1, 'Điểm mỗi lần phải từ 1 đến 100')
  .max(100, 'Điểm mỗi lần phải từ 1 đến 100');
const penaltyMetricLabelSchema = z
  .string()
  .trim()
  .min(1, 'Tên chỉ số phạt phải từ 1 đến 60 ký tự')
  .max(60, 'Tên chỉ số phạt phải từ 1 đến 60 ký tự')
  .nullish();
const penaltyMaxPerGameSchema = z
  .number()
  .int('Tối đa mỗi trận của chỉ số phạt phải từ 1 đến 100')
  .min(1, 'Tối đa mỗi trận của chỉ số phạt phải từ 1 đến 100')
  .max(100, 'Tối đa mỗi trận của chỉ số phạt phải từ 1 đến 100')
  .nullish();
const penaltyPointsSchema = z
  .number()
  .int('Điểm trừ mỗi lần phải từ 1 đến 100')
  .min(1, 'Điểm trừ mỗi lần phải từ 1 đến 100')
  .max(100, 'Điểm trừ mỗi lần phải từ 1 đến 100')
  .nullish();
const extraMetricLabelSchema = z
  .string()
  .trim()
  .min(1, 'Tên chỉ số phụ phải từ 1 đến 60 ký tự')
  .max(60, 'Tên chỉ số phụ phải từ 1 đến 60 ký tự')
  .nullish();
const extraMaxPerGameSchema = z
  .number()
  .int('Tối đa mỗi trận của chỉ số phụ phải từ 1 đến 100')
  .min(1, 'Tối đa mỗi trận của chỉ số phụ phải từ 1 đến 100')
  .max(100, 'Tối đa mỗi trận của chỉ số phụ phải từ 1 đến 100')
  .nullish();
const extraPointsSchema = z
  .number()
  .int('Điểm mỗi lần của chỉ số phụ phải từ 1 đến 100')
  .min(1, 'Điểm mỗi lần của chỉ số phụ phải từ 1 đến 100')
  .max(100, 'Điểm mỗi lần của chỉ số phụ phải từ 1 đến 100')
  .nullish();
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
    points: pointsSchema.default(1),
    extraMetricLabel: extraMetricLabelSchema,
    extraMaxPerGame: extraMaxPerGameSchema,
    extraPoints: extraPointsSchema,
    penaltyMetricLabel: penaltyMetricLabelSchema,
    penaltyMaxPerGame: penaltyMaxPerGameSchema,
    penaltyPoints: penaltyPointsSchema,
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
    points: pointsSchema.optional(),
    extraMetricLabel: extraMetricLabelSchema,
    extraMaxPerGame: extraMaxPerGameSchema,
    extraPoints: extraPointsSchema,
    penaltyMetricLabel: penaltyMetricLabelSchema,
    penaltyMaxPerGame: penaltyMaxPerGameSchema,
    penaltyPoints: penaltyPointsSchema,
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
  const { modeKey, mapNote, sortOrder, extraMetricLabel, extraMaxPerGame, extraPoints, penaltyMetricLabel, penaltyMaxPerGame, penaltyPoints, ...fields } = parsed.data;
  // Không gửi hoặc null cả ba → role không có chỉ số phụ / chỉ số phạt.
  const extra = checkExtraMetric({ extraMetricLabel: extraMetricLabel ?? null, extraMaxPerGame: extraMaxPerGame ?? null, extraPoints: extraPoints ?? null });
  const penalty = checkPenaltyMetric({
    penaltyMetricLabel: penaltyMetricLabel ?? null,
    penaltyMaxPerGame: penaltyMaxPerGame ?? null,
    penaltyPoints: penaltyPoints ?? null,
  });

  const modeId = modeKey ? await modeIdByKey(ctx, modeKey) : null;
  const order = sortOrder ?? (await nextSortOrder(ctx, fields.faction));
  try {
    const row = await ctx.db.role.create({
      data: { ...fields, ...extra, ...penalty, modeId, mapNote: emptyToNull(mapNote), sortOrder: order },
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
 *
 * Chỉ số phụ: ba trường gửi lên ghép với giá trị hiện có rồi kiểm "cùng có hoặc cùng
 * null" (thiếu một → `VALIDATION`). Tắt (về null cả ba) bị chặn khi role đã có lần khai
 * với `extraValue > 0` — điểm của các lần khai đó sẽ mất; đổi tên/tối đa/điểm vẫn được.
 *
 * Chỉ số phạt: cùng cách ghép và kiểm. Tắt bị chặn khi role đã có lần khai với
 * `penaltyValue > 0` HOẶC có báo cáo người chơi trỏ tới role (spec điểm role §5) — báo cáo
 * đang chờ cần điểm trừ của role để tạo mục trừ khi duyệt.
 */
export async function updateRole(ctx: Ctx, id: number, patch: RolePatch): Promise<RoleDto> {
  const parsed = patchSchema.safeParse(patch, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  const { mapNote, extraMetricLabel, extraMaxPerGame, extraPoints, penaltyMetricLabel, penaltyMaxPerGame, penaltyPoints, ...rest } = parsed.data;

  const data: Prisma.RoleUncheckedUpdateInput = { ...rest };
  if (mapNote !== undefined) data.mapNote = emptyToNull(mapNote);

  const existing = await ctx.db.role.findUnique({
    where: { id },
    select: { extraMetricLabel: true, extraMaxPerGame: true, extraPoints: true, penaltyMetricLabel: true, penaltyMaxPerGame: true, penaltyPoints: true },
  });
  if (!existing) throw appError('NOT_FOUND');

  const touchesExtra = extraMetricLabel !== undefined || extraMaxPerGame !== undefined || extraPoints !== undefined;
  if (touchesExtra) {
    const merged = checkExtraMetric({
      extraMetricLabel: extraMetricLabel === undefined ? existing.extraMetricLabel : extraMetricLabel,
      extraMaxPerGame: extraMaxPerGame === undefined ? existing.extraMaxPerGame : extraMaxPerGame,
      extraPoints: extraPoints === undefined ? existing.extraPoints : extraPoints,
    });
    const disabling = existing.extraMetricLabel !== null && merged.extraMetricLabel === null;
    // Kiểm tra rồi ghi, không khoá: lần khai chen vào giữa hai bước là trường hợp hiếm và
    // chỉ để lại một lần khai có extraValue trên role không còn chỉ số phụ (tính điểm bỏ qua).
    if (disabling && (await ctx.db.statReport.count({ where: { roleId: id, extraValue: { gt: 0 } } })) > 0) {
      throw appError('VALIDATION', EXTRA_IN_USE_MESSAGE);
    }
    Object.assign(data, merged);
  }

  const touchesPenalty = penaltyMetricLabel !== undefined || penaltyMaxPerGame !== undefined || penaltyPoints !== undefined;
  if (touchesPenalty) {
    const merged = checkPenaltyMetric({
      penaltyMetricLabel: penaltyMetricLabel === undefined ? existing.penaltyMetricLabel : penaltyMetricLabel,
      penaltyMaxPerGame: penaltyMaxPerGame === undefined ? existing.penaltyMaxPerGame : penaltyMaxPerGame,
      penaltyPoints: penaltyPoints === undefined ? existing.penaltyPoints : penaltyPoints,
    });
    const disabling = existing.penaltyMetricLabel !== null && merged.penaltyMetricLabel === null;
    if (disabling && (await penaltyMetricInUse(ctx, id))) throw appError('VALIDATION', PENALTY_IN_USE_MESSAGE);
    Object.assign(data, merged);
  }

  return toRoleDto(await ctx.db.role.update({ where: { id }, data, select: ROLE_SELECT }));
}

/** Ba trường chỉ số phụ phải cùng có hoặc cùng null; lẫn lộn → `VALIDATION`. */
function checkExtraMetric(extra: ExtraMetric): ExtraMetric {
  const present = [extra.extraMetricLabel, extra.extraMaxPerGame, extra.extraPoints].filter((v) => v !== null).length;
  if (present !== 0 && present !== 3) throw appError('VALIDATION', EXTRA_INCOMPLETE_MESSAGE);
  return extra;
}

/** Ba trường chỉ số phạt phải cùng có hoặc cùng null; lẫn lộn → `VALIDATION`. */
function checkPenaltyMetric(penalty: PenaltyMetric): PenaltyMetric {
  const present = [penalty.penaltyMetricLabel, penalty.penaltyMaxPerGame, penalty.penaltyPoints].filter((v) => v !== null).length;
  if (present !== 0 && present !== 3) throw appError('VALIDATION', PENALTY_INCOMPLETE_MESSAGE);
  return penalty;
}

/**
 * Role đã có lần khai với `penaltyValue > 0` hoặc báo cáo người chơi (bất kể trạng thái) trỏ tới
 * nó. Kiểm tra rồi ghi, không khoá — như chỉ số phụ: lần khai chen vào giữa hai bước là hiếm.
 */
async function penaltyMetricInUse(ctx: Ctx, roleId: number): Promise<boolean> {
  const [reports, accusations] = await Promise.all([
    ctx.db.statReport.count({ where: { roleId, penaltyValue: { gt: 0 } } }),
    ctx.db.playerAccusation.count({ where: { accusedRoleId: roleId } }),
  ]);
  return reports > 0 || accusations > 0;
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
