/**
 * Khai điểm và duyệt (spec §4.6): người chơi khai giá trị chỉ số của một role cho một
 * trận (ngày chơi, buổi không bắt buộc, ghi chú); mod/admin duyệt hoặc từ chối kèm lý
 * do, người khai nhận DM khi bị từ chối.
 *
 * Quy tắc khai (kiểm tra theo đúng thứ tự này): role đang bật → giá trị nguyên trong
 * `[0, maxPerGame]` → chỉ số phụ nguyên trong `[0, extraMaxPerGame]` (role không có chỉ số
 * phụ thì phải là 0) → ngày chơi trong `[hôm nay − 3, hôm nay]` giờ VN → mùa của ngày
 * chơi chưa chốt → chưa quá 30 lần khai trong ngày VN hôm nay → ghi chú ≤ 300 ký tự →
 * buổi (nếu có) bắt đầu cùng ngày VN với ngày chơi. Sửa lần khai của mình chạy lại
 * cùng bộ kiểm tra trên giá trị đã gộp, trừ giới hạn 30 lần/ngày.
 *
 * Điểm một lần khai = `value + extraValue × extraPoints` (spec chỉ số phụ §3), tính lúc đọc
 * theo `extraPoints` hiện tại của role — chỉ `value`/`extraValue` được lưu.
 *
 * Duyệt: mod không tự duyệt lần khai của mình (admin thì được — server chỉ có một
 * admin vẫn chạy); đổi trạng thái `pending → approved/rejected` là một cập nhật có
 * điều kiện trên đúng trạng thái VÀ đúng role/ngày/giá trị mod đã xem, nên hai mod duyệt
 * cùng lúc chỉ một người thành công, và người khai sửa đúng lúc mod bấm duyệt thì mod
 * được báo xem lại chứ không duyệt nhầm nội dung mới. DM từ chối gửi sau khi đã lưu;
 * lỗi DM chỉ ghi log. Sau khi duyệt: so top 1 của (role, mùa của ngày chơi) trước và sau
 * — đổi người thì đăng "👑 … đã hoá thân …" (`leaderboard.ts`; lỗi Discord chỉ ghi log).
 *
 * Giới hạn 30 lần/ngày là đếm-rồi-ghi (không khoá): hai lần khai cùng một mili giây có
 * thể lọt thành 31 — chấp nhận được cho một giới hạn chống spam.
 */

import type { Prisma, StatReport } from '@prisma/client';
import { z } from 'zod';
import type { AccessLevel, ReportDto } from '../../../shared/api-types.js';
import { formatReportValue, reportPoints } from '../../../shared/metric.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import {
  addDaysVn,
  dateOnlyToDb,
  dbToDateOnly,
  formatVnDay,
  seasonIdOf,
  toVnDate,
  vnDayRange,
} from '../../lib/time.js';
import { ensureSeason, isSeasonClosed } from '../seasons/service.js';
import { announceHolderChange, getRoleLeader } from './leaderboard.js';
import type { LeaderboardRow } from './leaderboard.js';

/** Số lần khai tối đa của một người trong một ngày VN. */
export const MAX_REPORTS_PER_DAY = 30;
/** Khai được trận từ hôm nay lùi tối đa bấy nhiêu ngày. */
const WINDOW_DAYS = 3;
const NOTE_MAX = 300;
const REASON_MAX = 200;
/** Giới hạn trên của `limit` trong `listMyReports`. */
const LIST_MAX = 100;
const INT32_MAX = 2_147_483_647;

// ---------------------------------------------------------------------------
// Kiểu vào/ra
// ---------------------------------------------------------------------------

export interface ReportInput {
  roleId: number;
  /** Số nguyên trong `[0, maxPerGame]` của role. */
  value: number;
  /**
   * Chỉ số phụ (spec chỉ số phụ §6): số nguyên trong `[0, extraMaxPerGame]` của role; mặc
   * định 0. Role không có chỉ số phụ chỉ nhận 0.
   */
  extraValue?: number;
  /** Ngày chơi theo giờ VN, `YYYY-MM-DD`. */
  playedOn: string;
  /** Buổi chơi (không bắt buộc); phải bắt đầu cùng ngày VN với `playedOn`. */
  sessionId?: number | null;
  /** Cắt khoảng trắng, tối đa 300 ký tự; rỗng → null. */
  note?: string | null;
}

/** Các trường sửa được của lần khai còn chờ duyệt; trường vắng mặt giữ nguyên. */
export type ReportPatch = Partial<ReportInput>;

export type ReviewDecision = { approve: true } | { approve: false; reason: string };

export interface Reviewer {
  id: number;
  accessLevel: AccessLevel;
}

const idSchema = z.number().int().min(1).max(INT32_MAX);
/** Chỉ cần là số: NaN/lẻ/âm được báo riêng là `VALUE_OUT_OF_RANGE` cho đúng nghĩa. */
const numberSchema = z.custom<number>((v) => typeof v === 'number');

const inputSchema = z
  .object({
    roleId: idSchema,
    value: numberSchema,
    extraValue: numberSchema.optional(),
    playedOn: z.string(),
    sessionId: idSchema.nullish(),
    note: z.string().nullish(),
  })
  .strict();

const patchSchema = inputSchema.partial();

const decisionSchema = z.discriminatedUnion('approve', [
  z.object({ approve: z.literal(true) }).strict(),
  // Thiếu lý do hẳn cũng là "chưa ghi lý do" (REASON_REQUIRED), không phải sai kiểu.
  z.object({ approve: z.literal(false), reason: z.string().nullish() }).strict(),
]);

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw appError('VALIDATION');
  return parsed.data;
}

/** Lần khai đã chuẩn hoá (ghi chú cắt/rỗng → null, ngày đã kiểm tra), sẵn sàng kiểm tra nghiệp vụ. */
interface Normalised {
  roleId: number;
  value: number;
  extraValue: number;
  playedOn: string;
  sessionId: number | null;
  note: string | null;
}

/** `YYYY-MM-DD` và là ngày có thật; sai → `VALIDATION`. */
function checkPlayedOn(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw appError('VALIDATION', 'Ngày chơi không hợp lệ');
  try {
    dateOnlyToDb(s);
  } catch {
    throw appError('VALIDATION', 'Ngày chơi không hợp lệ');
  }
  return s;
}

function normaliseNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Kiểm tra nghiệp vụ dùng chung cho khai mới và sửa
// ---------------------------------------------------------------------------

/** Người khai/sửa phải còn trong server (không có hồ sơ hoặc đã rời → `FORBIDDEN`). */
async function assertActiveMember(ctx: Ctx, memberId: number): Promise<void> {
  const member = await ctx.db.member.findUnique({ where: { id: memberId }, select: { status: true } });
  if (member?.status !== 'active') throw appError('FORBIDDEN');
}

/**
 * Bộ kiểm tra của spec, đúng thứ tự: role bật → giá trị → chỉ số phụ → cửa sổ 3 ngày → mùa
 * chưa chốt → (giới hạn ngày, chỉ khi `dailyCap`) → ghi chú → buổi khớp ngày. Mọi mốc
 * "hôm nay" lấy từ `ctx.now()` theo giờ VN.
 */
async function validateReport(ctx: Ctx, memberId: number, r: Normalised, opts: { dailyCap: boolean }): Promise<void> {
  const role = await ctx.db.role.findUnique({
    where: { id: r.roleId },
    select: { active: true, maxPerGame: true, extraMaxPerGame: true },
  });
  if (!role) throw appError('VALIDATION', 'Role không hợp lệ');
  if (!role.active) throw appError('ROLE_INACTIVE');

  if (!Number.isInteger(r.value) || r.value < 0 || r.value > role.maxPerGame) {
    throw appError('VALUE_OUT_OF_RANGE', `Giá trị phải từ 0 đến ${role.maxPerGame}`);
  }
  // Role không có chỉ số phụ (ba trường phụ null): chỉ nhận 0 — kể cả khi sửa lần khai đổi
  // sang role này mà còn extraValue cũ.
  if (role.extraMaxPerGame === null) {
    if (r.extraValue !== 0) throw appError('VALIDATION', 'Role này không có chỉ số phụ');
  } else if (!Number.isInteger(r.extraValue) || r.extraValue < 0 || r.extraValue > role.extraMaxPerGame) {
    throw appError('VALUE_OUT_OF_RANGE', `Chỉ số phụ phải từ 0 đến ${role.extraMaxPerGame}`);
  }

  // Chuỗi `YYYY-MM-DD` so sánh theo từ điển đúng bằng so sánh ngày.
  const today = toVnDate(ctx.now());
  if (r.playedOn < addDaysVn(today, -WINDOW_DAYS) || r.playedOn > today) throw appError('PLAYED_ON_OUT_OF_WINDOW');

  if (await isSeasonClosed(ctx, seasonIdOf(r.playedOn))) throw appError('SEASON_CLOSED');

  if (opts.dailyCap) {
    const { start, end } = vnDayRange(today);
    const count = await ctx.db.statReport.count({ where: { memberId, createdAt: { gte: start, lt: end } } });
    if (count >= MAX_REPORTS_PER_DAY) throw appError('RATE_LIMITED');
  }

  if (r.note !== null && r.note.length > NOTE_MAX) throw appError('VALIDATION', 'Ghi chú tối đa 300 ký tự');

  if (r.sessionId !== null) {
    const session = await ctx.db.gameSession.findUnique({ where: { id: r.sessionId }, select: { startsAt: true } });
    if (!session) throw appError('VALIDATION', 'Buổi chơi không hợp lệ');
    if (toVnDate(session.startsAt) !== r.playedOn) throw appError('VALIDATION', 'Buổi chơi không khớp ngày chơi');
  }
}

// ---------------------------------------------------------------------------
// Khai và sửa
// ---------------------------------------------------------------------------

/**
 * Khai một lần điểm; trả về dòng vừa tạo (trạng thái `pending`, `createdAt = ctx.now()`).
 * Dữ liệu sai kiểu → `VALIDATION`; người khai không còn trong server → `FORBIDDEN`;
 * rồi các quy tắc ở đầu file. Tạo kèm dòng `seasons` của mùa chứa ngày chơi.
 */
export async function submitReport(ctx: Ctx, memberId: number, input: ReportInput): Promise<StatReport> {
  const p = parse(inputSchema, input);
  const r: Normalised = {
    roleId: p.roleId,
    value: p.value,
    extraValue: p.extraValue ?? 0,
    playedOn: checkPlayedOn(p.playedOn),
    sessionId: p.sessionId ?? null,
    note: normaliseNote(p.note),
  };

  await assertActiveMember(ctx, memberId);
  await validateReport(ctx, memberId, r, { dailyCap: true });
  await ensureSeason(ctx, seasonIdOf(r.playedOn));

  return ctx.db.statReport.create({
    data: {
      memberId,
      roleId: r.roleId,
      sessionId: r.sessionId,
      playedOn: dateOnlyToDb(r.playedOn),
      value: r.value,
      extraValue: r.extraValue,
      note: r.note,
      // Ghi rõ để đồng hồ của ctx (không phải giờ thật) quyết định "ngày khai".
      createdAt: ctx.now(),
    },
  });
}

/**
 * Sửa lần khai còn chờ duyệt của chính mình: trường vắng mặt giữ nguyên, giá trị gộp
 * đi qua cùng bộ kiểm tra như khai mới (trừ giới hạn 30 lần/ngày), `createdAt` không
 * đổi. Không có hoặc không phải của mình → `NOT_FOUND` (không lộ lần khai người khác);
 * đã duyệt/từ chối → `NOT_PENDING` — kể cả khi mod vừa duyệt đúng lúc đang sửa.
 */
export async function updateOwnReport(ctx: Ctx, memberId: number, reportId: number, patch: ReportPatch): Promise<StatReport> {
  const p = parse(patchSchema, patch);
  await assertActiveMember(ctx, memberId);

  const existing = isId(reportId) ? await ctx.db.statReport.findUnique({ where: { id: reportId } }) : null;
  if (!existing || existing.memberId !== memberId) throw appError('NOT_FOUND');
  if (existing.status !== 'pending') throw appError('NOT_PENDING');

  const merged: Normalised = {
    roleId: p.roleId ?? existing.roleId,
    value: p.value ?? existing.value,
    extraValue: p.extraValue ?? existing.extraValue,
    playedOn: p.playedOn === undefined ? dbToDateOnly(existing.playedOn) : checkPlayedOn(p.playedOn),
    sessionId: p.sessionId === undefined ? existing.sessionId : p.sessionId,
    note: p.note === undefined ? existing.note : normaliseNote(p.note),
  };
  await validateReport(ctx, memberId, merged, { dailyCap: false });
  await ensureSeason(ctx, seasonIdOf(merged.playedOn));

  const { count } = await ctx.db.statReport.updateMany({
    where: { id: reportId, memberId, status: 'pending' },
    data: {
      roleId: merged.roleId,
      value: merged.value,
      extraValue: merged.extraValue,
      playedOn: dateOnlyToDb(merged.playedOn),
      sessionId: merged.sessionId,
      note: merged.note,
    },
  });
  if (count === 0) throw appError('NOT_PENDING');
  return ctx.db.statReport.findUniqueOrThrow({ where: { id: reportId } });
}

// ---------------------------------------------------------------------------
// Duyệt
// ---------------------------------------------------------------------------

/** Phần role mà DM từ chối cần: tên và cách đọc "x + y" (`MetricRole`). */
const REVIEW_ROLE_SELECT = { nameVi: true, metricLabel: true, extraMetricLabel: true, extraPoints: true } satisfies Prisma.RoleSelect;

/** Lần khai kèm những gì DM từ chối cần: người khai (discordId), role (tên, chỉ số). */
type ReviewableReport = Prisma.StatReportGetPayload<{
  include: { member: { select: { discordId: true } }; role: { select: typeof REVIEW_ROLE_SELECT } };
}>;

/**
 * Duyệt hoặc từ chối. Người duyệt phải là mod/admin (`FORBIDDEN` — phòng thủ thêm
 * ngoài tầng web); lần khai phải có (`NOT_FOUND`) và còn `pending` (`NOT_PENDING`);
 * mod không tự duyệt (`SELF_REVIEW`); từ chối phải có lý do sau khi cắt khoảng trắng
 * (`REASON_REQUIRED`), tối đa 200 ký tự (`VALIDATION`); mùa của ngày chơi chưa chốt
 * (`SEASON_CLOSED`). Đổi trạng thái có điều kiện `status = 'pending'` và đúng
 * role/ngày/giá trị đã đọc: hai người duyệt cùng lúc chỉ một người thành công, người kia
 * nhận `NOT_PENDING`; người khai sửa chen vào giữa lúc đọc và ghi → `NOT_PENDING` với
 * lời nhắn xem lại (lần khai vẫn chờ duyệt).
 * Sau khi lưu: từ chối → DM người khai (lỗi chỉ ghi log); duyệt → `afterApprove`.
 */
export async function reviewReport(ctx: Ctx, reviewer: Reviewer, reportId: number, decision: ReviewDecision): Promise<void> {
  if (reviewer.accessLevel !== 'mod' && reviewer.accessLevel !== 'admin') throw appError('FORBIDDEN');
  const d = parse(decisionSchema, decision);

  const report = isId(reportId)
    ? await ctx.db.statReport.findUnique({
        where: { id: reportId },
        include: { member: { select: { discordId: true } }, role: { select: REVIEW_ROLE_SELECT } },
      })
    : null;
  if (!report) throw appError('NOT_FOUND');
  if (report.status !== 'pending') throw appError('NOT_PENDING');
  if (report.memberId === reviewer.id && reviewer.accessLevel !== 'admin') throw appError('SELF_REVIEW');

  let reason: string | null = null;
  if (!d.approve) {
    reason = d.reason?.trim() ?? '';
    if (reason === '') throw appError('REASON_REQUIRED');
    if (reason.length > REASON_MAX) throw appError('VALIDATION', 'Lý do từ chối tối đa 200 ký tự');
  }

  const seasonId = seasonIdOf(dbToDateOnly(report.playedOn));
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');

  // Top 1 của (role, mùa) TRƯỚC khi duyệt — so với sau khi duyệt để biết có đổi người hoá thân.
  const leaderBefore = d.approve ? await getRoleLeader(ctx, report.roleId, seasonId) : null;

  const { count } = await ctx.db.statReport.updateMany({
    // Khoá lạc quan: chỉ ghi khi lần khai vẫn chờ duyệt và vẫn đúng role/ngày/giá trị/chỉ số
    // phụ mod đã xem — người khai sửa chen vào thì không duyệt nhầm nội dung mới, và
    // `leaderBefore` ở trên luôn đúng với role/mùa thực sự được duyệt.
    where: {
      id: reportId,
      status: 'pending',
      roleId: report.roleId,
      playedOn: report.playedOn,
      value: report.value,
      extraValue: report.extraValue,
    },
    data: {
      status: d.approve ? 'approved' : 'rejected',
      reviewedById: reviewer.id,
      reviewedAt: ctx.now(),
      rejectReason: reason,
    },
  });
  if (count === 0) throw await notPendingError(ctx, reportId);

  if (d.approve) await afterApprove(ctx, report, seasonId, leaderBefore);
  else await notifyRejected(ctx, report, reason ?? '');
}

/**
 * Cập nhật có điều kiện không trúng dòng nào: hoặc đã có người xử lý (thông báo mặc
 * định), hoặc lần khai vẫn chờ duyệt nhưng người khai vừa sửa — nhắc mod xem lại.
 */
async function notPendingError(ctx: Ctx, reportId: number): Promise<Error> {
  const fresh = await ctx.db.statReport.findUnique({ where: { id: reportId }, select: { status: true } });
  return fresh?.status === 'pending' ? appError('NOT_PENDING', 'Lần khai vừa được sửa, hãy xem lại') : appError('NOT_PENDING');
}

/**
 * Sau khi một lần khai được duyệt (đã lưu xong): tính lại top 1 của role trong mùa của
 * ngày chơi; khác người so với `before` → đăng "👑 … đã hoá thân …" (spec §4.6). Role chỉ
 * có điểm 0 không có ai dẫn đầu, nên không bao giờ thông báo. Lỗi Discord chỉ ghi log.
 */
async function afterApprove(ctx: Ctx, report: ReviewableReport, seasonId: string, before: LeaderboardRow | null): Promise<void> {
  const after = await getRoleLeader(ctx, report.roleId, seasonId);
  if (after && after.memberId !== before?.memberId) {
    await announceHolderChange(ctx, after.displayName, report.role.nameVi, seasonId);
  }
}

/** DM người khai lý do bị từ chối. Discord lỗi chỉ ghi log — lần khai đã bị từ chối trong DB rồi. */
async function notifyRejected(ctx: Ctx, report: ReviewableReport, reason: string): Promise<void> {
  const text =
    `Lần khai ${report.role.nameVi} (${formatReportValue(report.value, report.extraValue, report.role)}) ` +
    `ngày ${formatVnDay(dbToDateOnly(report.playedOn))} bị từ chối: ${reason}`;
  try {
    await ctx.notifier.sendDm(report.member.discordId, text);
  } catch (err) {
    console.error(`[stats] Không gửi được DM từ chối lần khai ${report.id} tới ${report.member.discordId}: ${messageOf(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------

const REPORT_SELECT = {
  id: true,
  value: true,
  extraValue: true,
  playedOn: true,
  sessionId: true,
  note: true,
  status: true,
  rejectReason: true,
  createdAt: true,
  highlightChannelId: true,
  highlightMessageId: true,
  member: { select: { id: true, displayName: true } },
  role: {
    select: { id: true, nameVi: true, icon: true, metricLabel: true, maxPerGame: true, extraMetricLabel: true, extraMaxPerGame: true, extraPoints: true },
  },
} satisfies Prisma.StatReportSelect;

type ReportRow = Prisma.StatReportGetPayload<{ select: typeof REPORT_SELECT }>;

/**
 * DTO của một dòng; `guildId` để dựng link tới tin Discord chứa highlight (hai cột phải cùng
 * có). `points` tính lúc đọc theo `extraPoints` hiện tại của role.
 */
function toReportDto(r: ReportRow, guildId: string): ReportDto {
  return {
    id: r.id,
    member: { id: r.member.id, displayName: r.member.displayName },
    role: {
      id: r.role.id,
      nameVi: r.role.nameVi,
      icon: r.role.icon,
      metricLabel: r.role.metricLabel,
      maxPerGame: r.role.maxPerGame,
      extraMetricLabel: r.role.extraMetricLabel,
      extraMaxPerGame: r.role.extraMaxPerGame,
      extraPoints: r.role.extraPoints,
    },
    value: r.value,
    extraValue: r.extraValue,
    points: reportPoints(r.value, r.extraValue, r.role),
    playedOn: dbToDateOnly(r.playedOn),
    sessionId: r.sessionId,
    note: r.note,
    status: r.status,
    rejectReason: r.rejectReason,
    createdAt: r.createdAt.toISOString(),
    highlightUrl:
      r.highlightChannelId !== null && r.highlightMessageId !== null
        ? `https://discord.com/channels/${guildId}/${r.highlightChannelId}/${r.highlightMessageId}`
        : null,
  };
}

/** Một lần khai dạng DTO (API trả về sau khi khai/sửa); không có → `NOT_FOUND`. */
export async function getReportDto(ctx: Ctx, reportId: number): Promise<ReportDto> {
  const row = isId(reportId) ? await ctx.db.statReport.findUnique({ where: { id: reportId }, select: REPORT_SELECT }) : null;
  if (!row) throw appError('NOT_FOUND');
  return toReportDto(row, ctx.config.discord.guildId);
}

/** Lần khai của một người, mới nhất trước; `limit` mặc định 50, tối đa 100 (lớn hơn bị cắt). */
export async function listMyReports(ctx: Ctx, memberId: number, limit = 50): Promise<ReportDto[]> {
  if (!Number.isInteger(limit) || limit < 1) throw appError('VALIDATION', 'Giới hạn không hợp lệ');
  const rows = await ctx.db.statReport.findMany({
    where: { memberId },
    select: REPORT_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(limit, LIST_MAX),
  });
  return rows.map((r) => toReportDto(r, ctx.config.discord.guildId));
}

/** Hàng chờ duyệt của mọi người, cũ nhất trước. */
export async function listPendingReports(ctx: Ctx): Promise<ReportDto[]> {
  const rows = await ctx.db.statReport.findMany({
    where: { status: 'pending' },
    select: REPORT_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => toReportDto(r, ctx.config.discord.guildId));
}

// ---------------------------------------------------------------------------

/** Id hợp lệ để tra DB; id lạ (lẻ, âm, quá int32) coi như không có. */
export function isId(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= INT32_MAX;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
