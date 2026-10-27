/**
 * Khai điểm và duyệt (spec §4.6): người chơi khai giá trị chỉ số của một role cho một
 * trận (ngày chơi, buổi không bắt buộc, ghi chú); mod/admin duyệt hoặc từ chối kèm lý
 * do, người khai nhận DM khi bị từ chối.
 *
 * Quy tắc khai (kiểm tra theo đúng thứ tự này): role đang bật → giá trị nguyên trong
 * `[0, maxPerGame]` → chỉ số phụ nguyên trong `[0, extraMaxPerGame]` (role không có chỉ số
 * phụ thì phải là 0) → chỉ số phạt nguyên trong `[0, penaltyMaxPerGame]` (role không có chỉ
 * số phạt thì phải là 0) → ngày chơi trong `[hôm nay − 3, hôm nay]` giờ VN → mùa của ngày
 * chơi chưa chốt → chưa quá 30 lần khai trong ngày VN hôm nay → ghi chú ≤ 300 ký tự →
 * buổi (nếu có) bắt đầu cùng ngày VN với ngày chơi. Sửa lần khai của mình chạy lại
 * cùng bộ kiểm tra trên giá trị đã gộp, trừ giới hạn 30 lần/ngày.
 *
 * Điểm một lần khai = `value × points + extraValue × extraPoints − penaltyValue × penaltyPoints
 * + bonusPoints` (spec điểm role §3), tính lúc đọc theo điểm hiện tại của role — chỉ
 * `value`/`extraValue`/`penaltyValue` (và `bonusPoints` khi báo cáo được duyệt) được lưu.
 *
 * Duyệt: mod không tự duyệt lần khai của mình (admin thì được — server chỉ có một
 * admin vẫn chạy); đổi trạng thái `pending → approved/rejected` là một cập nhật có
 * điều kiện trên đúng trạng thái VÀ đúng role/ngày/giá trị mod đã xem, nên hai mod duyệt
 * cùng lúc chỉ một người thành công, và người khai sửa đúng lúc mod bấm duyệt thì mod
 * được báo xem lại chứ không duyệt nhầm nội dung mới. DM từ chối gửi sau khi đã lưu;
 * lỗi DM chỉ ghi log. Sau khi duyệt: so top 1 của (role, mùa của ngày chơi) trước và sau
 * — đổi người thì đăng "👑 … đã hoá thân …" (`leaderboard.ts`; lỗi Discord chỉ ghi log).
 *
 * Huỷ duyệt (spec huỷ duyệt §3, §5): mod/admin huỷ một lần khai đã duyệt kèm lý do —
 * `approved → revoked` (trạng thái cuối), lưu người/giờ huỷ vào `revokedBy`/`revokedAt`, lý
 * do vào `rejectReason`, giữ nguyên người duyệt ban đầu. Cùng luật tự duyệt và lý do như
 * khi từ chối; mùa của ngày chơi phải chưa chốt. Việc ghi nằm trong một giao dịch khoá dòng
 * `seasons` (`FOR UPDATE`) rồi kiểm lại `closedAt` — chốt mùa cập nhật đúng dòng này, nên
 * huỷ duyệt không bao giờ lọt vào giữa lúc chốt (danh hiệu đã trao không tính lần khai bị
 * huỷ); hai lần huỷ cùng lúc chỉ một lần thành công (`NOT_APPROVED`). Sau khi lưu: DM người
 * khai, rồi so top 1 trước/sau như khi duyệt (không còn ai dẫn đầu thì không đăng gì). Mọi
 * nơi đọc `status = 'approved'` tự bỏ lần khai đã huỷ. `listRecentlyApproved` là danh sách
 * quản trị để huỷ: lần khai `approved` của mùa chưa chốt, duyệt gần nhất trước, tối đa 50.
 *
 * Giới hạn 30 lần/ngày là đếm-rồi-ghi (không khoá): hai lần khai cùng một mili giây có
 * thể lọt thành 31 — chấp nhận được cho một giới hạn chống spam.
 */

import type { Prisma, StatReport } from '@prisma/client';
import { z } from 'zod';
import type { AccessLevel, ReportDto, ReviewedReportDto } from '../../../shared/api-types.js';
import { formatReportValue, reportPoints } from '../../../shared/metric.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import {
  addDaysVn,
  dateOnlyToDb,
  dbToDateOnly,
  formatVnDay,
  previousSeasonId,
  seasonDateRange,
  seasonIdOf,
  toVnDate,
  vnDayRange,
} from '../../lib/time.js';
import { HOT_TX } from '../../lib/tx.js';
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
/** Số dòng tối đa của danh sách "Đã duyệt gần đây". */
const RECENT_APPROVED_MAX = 50;
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
  /**
   * Chỉ số phạt (spec điểm role §3, §5): số nguyên trong `[0, penaltyMaxPerGame]` của role; mặc
   * định 0. Role không có chỉ số phạt chỉ nhận 0.
   */
  penaltyValue?: number;
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
    penaltyValue: numberSchema.optional(),
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

/** Lý do huỷ duyệt từ ngoài: thiếu hẳn cũng là "chưa ghi lý do" (REASON_REQUIRED), không phải sai kiểu. */
const revokeReasonSchema = z.string().nullish();

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
  penaltyValue: number;
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
 * Bộ kiểm tra của spec, đúng thứ tự: role bật → giá trị → chỉ số phụ → chỉ số phạt → cửa sổ
 * 3 ngày → mùa chưa chốt → (giới hạn ngày, chỉ khi `dailyCap`) → ghi chú → buổi khớp ngày.
 * Mọi mốc "hôm nay" lấy từ `ctx.now()` theo giờ VN.
 */
async function validateReport(ctx: Ctx, memberId: number, r: Normalised, opts: { dailyCap: boolean }): Promise<void> {
  const role = await ctx.db.role.findUnique({
    where: { id: r.roleId },
    select: { active: true, maxPerGame: true, extraMaxPerGame: true, penaltyMaxPerGame: true },
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
  // Role không có chỉ số phạt (ba trường phạt null): chỉ nhận 0 — cùng lý do như chỉ số phụ.
  if (role.penaltyMaxPerGame === null) {
    if (r.penaltyValue !== 0) throw appError('VALIDATION', 'Role này không có chỉ số phạt');
  } else if (!Number.isInteger(r.penaltyValue) || r.penaltyValue < 0 || r.penaltyValue > role.penaltyMaxPerGame) {
    throw appError('VALUE_OUT_OF_RANGE', `Chỉ số phạt phải từ 0 đến ${role.penaltyMaxPerGame}`);
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
    penaltyValue: p.penaltyValue ?? 0,
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
      penaltyValue: r.penaltyValue,
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
    penaltyValue: p.penaltyValue ?? existing.penaltyValue,
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
      penaltyValue: merged.penaltyValue,
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

/** Phần role mà DM từ chối/huỷ duyệt cần: tên và cách đọc "x + y − z" (`MetricRole`). */
const REVIEW_ROLE_SELECT = {
  nameVi: true,
  metricLabel: true,
  points: true,
  extraMetricLabel: true,
  extraPoints: true,
  penaltyMetricLabel: true,
  penaltyMaxPerGame: true,
  penaltyPoints: true,
} satisfies Prisma.RoleSelect;

/** Những gì DM từ chối/huỷ duyệt cần kèm lần khai: người khai (discordId), role (tên, chỉ số). */
const REVIEWABLE_INCLUDE = {
  member: { select: { discordId: true } },
  role: { select: REVIEW_ROLE_SELECT },
} satisfies Prisma.StatReportInclude;

type ReviewableReport = Prisma.StatReportGetPayload<{ include: typeof REVIEWABLE_INCLUDE }>;

/** Người duyệt/huỷ phải là mod/admin (`FORBIDDEN` — phòng thủ thêm ngoài tầng web). */
function assertReviewer(reviewer: Reviewer): void {
  if (reviewer.accessLevel !== 'mod' && reviewer.accessLevel !== 'admin') throw appError('FORBIDDEN');
}

/** Lần khai kèm người khai và role; id lạ hoặc không có → `NOT_FOUND`. */
async function loadReviewable(ctx: Ctx, reportId: number): Promise<ReviewableReport> {
  const report = isId(reportId) ? await ctx.db.statReport.findUnique({ where: { id: reportId }, include: REVIEWABLE_INCLUDE }) : null;
  if (!report) throw appError('NOT_FOUND');
  return report;
}

/**
 * Lý do từ chối/huỷ duyệt: cắt khoảng trắng, phải có (`REASON_REQUIRED`), tối đa 200 ký tự
 * (`VALIDATION`). `what` là "từ chối" hay "huỷ duyệt" để lời nhắn đúng ngữ cảnh.
 */
function checkReason(raw: string | null | undefined, what: 'từ chối' | 'huỷ duyệt'): string {
  const reason = raw?.trim() ?? '';
  if (reason === '') throw appError('REASON_REQUIRED', `Cần ghi lý do ${what}`);
  if (reason.length > REASON_MAX) throw appError('VALIDATION', `Lý do ${what} tối đa 200 ký tự`);
  return reason;
}

/**
 * Duyệt hoặc từ chối. Người duyệt phải là mod/admin (`FORBIDDEN` — phòng thủ thêm
 * ngoài tầng web); lần khai phải có (`NOT_FOUND`) và còn `pending` (`NOT_PENDING`);
 * mod không tự duyệt (`SELF_REVIEW`); từ chối phải có lý do sau khi cắt khoảng trắng
 * (`REASON_REQUIRED`), tối đa 200 ký tự (`VALIDATION`); mùa của ngày chơi chưa chốt
 * (`SEASON_CLOSED`). Đổi trạng thái có điều kiện `status = 'pending'` và đúng
 * role/ngày/giá trị đã đọc: hai người duyệt cùng lúc chỉ một người thành công, người kia
 * nhận `NOT_PENDING`; người khai sửa chen vào giữa lúc đọc và ghi → `NOT_PENDING` với
 * lời nhắn xem lại (lần khai vẫn chờ duyệt).
 * Sau khi lưu: từ chối → DM người khai (lỗi chỉ ghi log); duyệt → `announceIfLeaderChanged`.
 */
export async function reviewReport(ctx: Ctx, reviewer: Reviewer, reportId: number, decision: ReviewDecision): Promise<void> {
  assertReviewer(reviewer);
  const d = parse(decisionSchema, decision);

  const report = await loadReviewable(ctx, reportId);
  if (report.status !== 'pending') throw appError('NOT_PENDING');
  if (report.memberId === reviewer.id && reviewer.accessLevel !== 'admin') throw appError('SELF_REVIEW');

  const reason = d.approve ? null : checkReason(d.reason, 'từ chối');

  const seasonId = seasonIdOf(dbToDateOnly(report.playedOn));
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');

  // Top 1 của (role, mùa) TRƯỚC khi duyệt — so với sau khi duyệt để biết có đổi người hoá thân.
  const leaderBefore = d.approve ? await getRoleLeader(ctx, report.roleId, seasonId) : null;

  const { count } = await ctx.db.statReport.updateMany({
    // Khoá lạc quan: chỉ ghi khi lần khai vẫn chờ duyệt và vẫn đúng role/ngày/giá trị/chỉ số
    // phụ/chỉ số phạt mod đã xem — người khai sửa chen vào thì không duyệt nhầm nội dung mới,
    // và `leaderBefore` ở trên luôn đúng với role/mùa thực sự được duyệt.
    where: {
      id: reportId,
      status: 'pending',
      roleId: report.roleId,
      playedOn: report.playedOn,
      value: report.value,
      extraValue: report.extraValue,
      penaltyValue: report.penaltyValue,
    },
    data: {
      status: d.approve ? 'approved' : 'rejected',
      reviewedById: reviewer.id,
      reviewedAt: ctx.now(),
      rejectReason: reason,
    },
  });
  if (count === 0) throw await notPendingError(ctx, reportId);

  if (d.approve) await announceIfLeaderChanged(ctx, report, seasonId, leaderBefore);
  else await notifyRejected(ctx, report, reason ?? '');
}

/**
 * Huỷ một lần khai đã duyệt kèm lý do (spec huỷ duyệt §3). Kiểm tra theo thứ tự: người huỷ
 * là mod/admin (`FORBIDDEN`) → lần khai có (`NOT_FOUND`) → đang `approved` (`NOT_APPROVED`)
 * → mod không huỷ lần khai của mình (`SELF_REVIEW`; admin thì được) → lý do sau khi cắt
 * khoảng trắng 1–200 ký tự (`REASON_REQUIRED`/`VALIDATION`) → mùa của ngày chơi chưa chốt
 * (`SEASON_CLOSED`). Rồi trong một giao dịch: khoá dòng mùa (`FOR UPDATE`), kiểm lại
 * `closedAt` (chốt mùa chen vào → `SEASON_CLOSED`), đổi trạng thái có điều kiện
 * `status = 'approved'` — không trúng dòng nào (người khác vừa huỷ) → `NOT_APPROVED`.
 * Sau khi lưu: DM người khai, rồi so top 1 trước/sau; cả hai lỗi Discord chỉ ghi log.
 */
export async function revokeReport(ctx: Ctx, reviewer: Reviewer, reportId: number, reason: string): Promise<void> {
  assertReviewer(reviewer);
  const rawReason = parse(revokeReasonSchema, reason);

  const report = await loadReviewable(ctx, reportId);
  if (report.status !== 'approved') throw appError('NOT_APPROVED');
  if (report.memberId === reviewer.id && reviewer.accessLevel !== 'admin') {
    throw appError('SELF_REVIEW', 'Mod không được huỷ duyệt lần khai của mình');
  }
  const trimmed = checkReason(rawReason, 'huỷ duyệt');

  const seasonId = seasonIdOf(dbToDateOnly(report.playedOn));
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');

  // Top 1 của (role, mùa) TRƯỚC khi huỷ — so với sau khi huỷ để biết có đổi người hoá thân.
  const leaderBefore = await getRoleLeader(ctx, report.roleId, seasonId);

  // Dòng `seasons` phải có để khoá được; lần khai đã duyệt thì mùa đã được tạo, gọi lại vô hại.
  await ensureSeason(ctx, seasonId);
  await ctx.db.$transaction(async (tx) => {
    // Khoá dòng mùa: chốt mùa (`closeSeason`) cập nhật đúng dòng này trong giao dịch của nó,
    // nên hai bên xếp hàng — hoặc huỷ xong trước khi chốt tính danh hiệu, hoặc chốt xong
    // trước và ở đây thấy `closed_at` đã có.
    const [season] = await tx.$queryRaw<{ closed_at: Date | null }[]>`SELECT closed_at FROM seasons WHERE id = ${seasonId} FOR UPDATE`;
    if (season?.closed_at != null) throw appError('SEASON_CLOSED');

    const { count } = await tx.statReport.updateMany({
      where: { id: reportId, status: 'approved' },
      data: { status: 'revoked', revokedById: reviewer.id, revokedAt: ctx.now(), rejectReason: trimmed },
    });
    if (count === 0) throw appError('NOT_APPROVED');
  }, HOT_TX);

  await notifyRevoked(ctx, report, trimmed);
  await announceIfLeaderChanged(ctx, report, seasonId, leaderBefore);
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
 * Sau khi điểm đã duyệt của một role đổi (duyệt thêm hoặc huỷ duyệt, đã lưu xong): tính lại
 * top 1 của role trong mùa của ngày chơi; có người dẫn đầu và khác người so với `before` →
 * đăng "👑 … đã hoá thân …" (spec §4.6). Không còn ai dẫn đầu (role chỉ có điểm 0, hoặc huỷ
 * lần khai duy nhất) → không đăng gì. Lỗi Discord chỉ ghi log.
 */
async function announceIfLeaderChanged(ctx: Ctx, report: ReviewableReport, seasonId: string, before: LeaderboardRow | null): Promise<void> {
  const after = await getRoleLeader(ctx, report.roleId, seasonId);
  if (after && after.memberId !== before?.memberId) {
    await announceHolderChange(ctx, after.displayName, report.role.nameVi, seasonId);
  }
}

/** DM người khai lý do bị từ chối. Discord lỗi chỉ ghi log — lần khai đã bị từ chối trong DB rồi. */
async function notifyRejected(ctx: Ctx, report: ReviewableReport, reason: string): Promise<void> {
  await dmReporter(ctx, report, 'từ chối', `${describeReport(report)} bị từ chối: ${reason}`);
}

/** DM người khai lý do bị huỷ duyệt (spec huỷ duyệt §5). Discord lỗi chỉ ghi log — đã huỷ trong DB rồi. */
async function notifyRevoked(ctx: Ctx, report: ReviewableReport, reason: string): Promise<void> {
  await dmReporter(ctx, report, 'huỷ duyệt', `${describeReport(report)} đã bị huỷ duyệt: ${reason}`);
}

/** "Lần khai {role} ({giá trị}) ngày {dd/mm}" — phần đầu chung của DM từ chối và huỷ duyệt. */
function describeReport(report: ReviewableReport): string {
  return (
    `Lần khai ${report.role.nameVi} (${formatReportValue(report, report.role)}) ` +
    `ngày ${formatVnDay(dbToDateOnly(report.playedOn))}`
  );
}

/** Gửi DM cho người khai; Discord lỗi chỉ ghi log (kèm `what` để biết DM gì). */
async function dmReporter(ctx: Ctx, report: ReviewableReport, what: string, text: string): Promise<void> {
  try {
    await ctx.notifier.sendDm(report.member.discordId, text);
  } catch (err) {
    console.error(`[stats] Không gửi được DM ${what} lần khai ${report.id} tới ${report.member.discordId}: ${messageOf(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------

const REPORT_SELECT = {
  id: true,
  value: true,
  extraValue: true,
  penaltyValue: true,
  bonusPoints: true,
  source: true,
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
    select: {
      id: true,
      nameVi: true,
      icon: true,
      metricLabel: true,
      maxPerGame: true,
      points: true,
      extraMetricLabel: true,
      extraMaxPerGame: true,
      extraPoints: true,
      penaltyMetricLabel: true,
      penaltyMaxPerGame: true,
      penaltyPoints: true,
    },
  },
} satisfies Prisma.StatReportSelect;

type ReportRow = Prisma.StatReportGetPayload<{ select: typeof REPORT_SELECT }>;

/**
 * DTO của một dòng; `guildId` để dựng link tới tin Discord chứa highlight (hai cột phải cùng
 * có). `points` tính lúc đọc theo điểm hiện tại của role (`reportPoints`, spec điểm role §3).
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
      points: r.role.points,
      extraMetricLabel: r.role.extraMetricLabel,
      extraMaxPerGame: r.role.extraMaxPerGame,
      extraPoints: r.role.extraPoints,
      penaltyMetricLabel: r.role.penaltyMetricLabel,
      penaltyMaxPerGame: r.role.penaltyMaxPerGame,
      penaltyPoints: r.role.penaltyPoints,
    },
    value: r.value,
    extraValue: r.extraValue,
    penaltyValue: r.penaltyValue,
    bonusPoints: r.bonusPoints,
    source: r.source,
    points: reportPoints(r, r.role),
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

/**
 * Danh sách quản trị "Đã duyệt gần đây" (spec huỷ duyệt §5): lần khai `approved` có ngày
 * chơi thuộc mùa chưa chốt — mùa hiện tại (theo giờ VN) và mùa trước nếu chưa chốt — duyệt
 * gần nhất trước (rồi id giảm dần), tối đa 50, kèm người duyệt. Mùa cũ hơn không hiện dù
 * chưa có dòng `seasons`.
 */
export async function listRecentlyApproved(ctx: Ctx): Promise<ReviewedReportDto[]> {
  const current = seasonIdOf(toVnDate(ctx.now()));
  const previous = previousSeasonId(current);
  // Hai mùa liền nhau nên khoảng ngày chơi là một đoạn liên tục.
  const first = seasonDateRange((await isSeasonClosed(ctx, previous)) ? current : previous).first;
  const last = seasonDateRange(current).last;

  const rows = await ctx.db.statReport.findMany({
    where: { status: 'approved', playedOn: { gte: dateOnlyToDb(first), lte: dateOnlyToDb(last) } },
    select: { ...REPORT_SELECT, reviewedAt: true, reviewedBy: { select: { id: true, displayName: true } } },
    orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    take: RECENT_APPROVED_MAX,
  });
  return rows.map((r) => ({
    ...toReportDto(r, ctx.config.discord.guildId),
    reviewedBy: r.reviewedBy,
    // Lần khai đã duyệt luôn có reviewedAt (reviewReport ghi cùng lúc); phòng hờ dữ liệu lạ.
    reviewedAt: (r.reviewedAt ?? r.createdAt).toISOString(),
  }));
}

// ---------------------------------------------------------------------------

/** Id hợp lệ để tra DB; id lạ (lẻ, âm, quá int32) coi như không có. */
export function isId(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= INT32_MAX;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
