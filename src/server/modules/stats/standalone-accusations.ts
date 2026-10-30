/**
 * Báo cáo người chơi độc lập (spec 2026-10-31 §B): gửi ở tab riêng "Báo cáo người chơi", không gắn lần
 * khai (`report_id IS NULL`). Phần dùng chung với báo cáo cũ gắn lần khai (vụ, báo cáo trùng, tạo mục trừ
 * điểm, DM) ở `accusations.ts`.
 *
 * Gửi — kiểm tra theo đúng thứ tự: dữ liệu đúng kiểu (`VALIDATION`) → người gửi còn trong server
 * (`FORBIDDEN`) → ngày chơi hợp lệ và trong `[hôm nay − 3, hôm nay]` giờ VN (`PLAYED_ON_OUT_OF_WINDOW`) →
 * mùa chưa chốt (`SEASON_CLOSED`) → chưa quá 10 báo cáo trong ngày VN hôm nay (`RATE_LIMITED`) → ghi chú
 * ≤ 300 → buổi (nếu có) có, không bị huỷ, cùng ngày VN → bốn trường của báo cáo (`validateAccusation`:
 * đủ trường, không tự báo cáo, người bị bắn ≠ người bị báo cáo, hai người đang hoạt động, role bật và có
 * chỉ số phạt). Không cần đã tham gia buổi. Ghi trong giao dịch khoá dòng mùa (`lockOpenSeason`) — xếp
 * hàng với duyệt/huỷ và chốt mùa: vụ đã có mục trừ điểm còn hiệu lực thì báo cáo mới tạo thẳng ở trạng
 * thái `superseded` ("Đã có người báo cáo trước"), không vào hàng chờ.
 *
 * Vụ (người bị báo cáo + role + người bị bắn + ngày chơi) chung với báo cáo cũ (`hiddenAccusations`):
 * hàng chờ chỉ có báo cáo `pending` SỚM NHẤT của vụ; sớm nhất bị bác → báo cáo kế tiếp hiện.
 *
 * Duyệt/từ chối/huỷ duyệt: mod/admin; mod không quyết báo cáo mà mình là người gửi hoặc người bị báo cáo
 * (admin được); lý do 1–200 ký tự; ghi trong giao dịch khoá dòng mùa rồi kiểm lại `closedAt`; đổi trạng
 * thái có điều kiện. Duyệt → `approveCase` (mục trừ điểm, báo cáo trùng → `superseded`) → DM người bị
 * báo cáo, kiểm tra đổi người hoá thân role bị trừ. Từ chối → DM người gửi. Huỷ duyệt → báo cáo
 * `revoked` + mục trừ điểm kèm theo `revoked` (cùng giao dịch) → DM người gửi và người bị báo cáo, kiểm
 * tra hoá thân. Lỗi Discord chỉ ghi log.
 *
 * Điểm: mỗi báo cáo độc lập `approved` cộng +1 vào Tổng điểm "Cả 3 phe" của người gửi trong mùa của
 * `playedOn` (`leaderboard.ts`), không vào bảng role/hoá thân/Top 3/phe riêng.
 */

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { StandaloneAccusationDto, StandaloneAccusationInputDto } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { addDaysVn, dateOnlyToDb, dbToDateOnly, previousSeasonId, seasonDateRange, seasonIdOf, toVnDate, vnDayRange } from '../../lib/time.js';
import { HOT_TX } from '../../lib/tx.js';
import { ensureSeason, isSeasonClosed } from '../seasons/service.js';
import {
  ACCUSATION_SELECT,
  SUPERSEDED_REASON,
  approveCase,
  describeAccusation,
  hiddenAccusations,
  penaltyDmText,
  penaltyRemovedDmText,
  revokePenalty,
  safeDm,
  validateAccusation,
} from './accusations.js';
import type { PenaltyNotice } from './accusations.js';
import { getRoleLeader } from './leaderboard.js';
import { announceIfLeaderChanged, assertActiveMember, assertReviewer, checkReason, isId, lockOpenSeason } from './reports.js';
import type { Reviewer } from './reports.js';

/** Số báo cáo độc lập tối đa của một người trong một ngày VN (theo giờ gửi). */
export const MAX_ACCUSATIONS_PER_DAY = 10;
const WINDOW_DAYS = 3;
const NOTE_MAX = 300;
const LIST_MAX = 100;
const RECENT_APPROVED_MAX = 50;
const INT32_MAX = 2_147_483_647;

const NOT_PENDING_MESSAGE = 'Báo cáo này đã được xử lý';
const NOT_APPROVED_MESSAGE = 'Báo cáo không còn ở trạng thái đã duyệt';
const SELF_MESSAGE = 'Mod không được duyệt báo cáo mà mình là người gửi hoặc người bị báo cáo';

/** Quyết định của mod: duyệt (báo cáo đúng), hoặc từ chối kèm lý do (1–200 ký tự sau khi cắt). */
export type StandaloneReviewDecision = { approve: true } | { approve: false; reason: string };

const idSchema = z.number().int().min(1).max(INT32_MAX);
/** Bốn trường của báo cáo để `validateAccusation` báo lời nhắn cụ thể (thiếu trường, sai kiểu…). */
const inputSchema = z
  .object({
    playedOn: z.string(),
    sessionId: idSchema.nullish(),
    note: z.string().nullish(),
    accusedId: z.unknown(),
    accusedRoleId: z.unknown(),
    victimId: z.unknown(),
    victimFaction: z.unknown(),
  })
  .strict();

type Db = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

const STANDALONE_SELECT = {
  ...ACCUSATION_SELECT,
  note: true,
  createdAt: true,
  reviewedAt: true,
  penaltyReportId: true,
  reporterId: true,
  reporter: { select: { id: true, displayName: true, discordId: true } },
  accused: { select: { id: true, displayName: true, discordId: true } },
  accusedRole: { select: { id: true, nameVi: true, icon: true, faction: true, penaltyPoints: true } },
  session: { select: { id: true, startsAt: true, mode: { select: { nameVi: true } } } },
  reviewedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.PlayerAccusationSelect;

type StandaloneRow = Prisma.PlayerAccusationGetPayload<{ select: typeof STANDALONE_SELECT }>;

function toDto(a: StandaloneRow, o: { admin: boolean; duplicate?: boolean }): StandaloneAccusationDto {
  return {
    id: a.id,
    status: a.status,
    reporter: { id: a.reporter.id, displayName: a.reporter.displayName },
    accused: { id: a.accused.id, displayName: a.accused.displayName },
    accusedRole: a.accusedRole,
    victim: a.victim,
    victimFaction: a.victimFaction,
    playedOn: dbToDateOnly(a.playedOn),
    session: a.session ? { id: a.session.id, startsAt: a.session.startsAt.toISOString(), modeName: a.session.mode.nameVi } : null,
    note: a.note,
    rejectReason: a.rejectReason,
    duplicate: o.duplicate ?? false,
    createdAt: a.createdAt.toISOString(),
    // Người gửi không được xem tên người duyệt (như lần khai).
    reviewedBy: o.admin ? a.reviewedBy : null,
    reviewedAt: o.admin ? (a.reviewedAt?.toISOString() ?? null) : null,
  };
}

async function loadStandalone(db: Db, id: number): Promise<StandaloneRow | null> {
  if (!isId(id)) return null;
  // Báo cáo cũ gắn lần khai được quyết qua lần khai (`reviewReport`) — ở đây coi như không có.
  return db.playerAccusation.findFirst({ where: { id, reportId: null }, select: STANDALONE_SELECT });
}

// ---------------------------------------------------------------------------
// Gửi
// ---------------------------------------------------------------------------

/** Vụ của báo cáo đã có báo cáo `approved` mà mục trừ điểm còn `approved`. */
async function casePenalised(db: Db, a: { accusedId: number; accusedRoleId: number; victimId: number; playedOn: Date }): Promise<boolean> {
  const n = await db.playerAccusation.count({
    where: {
      accusedId: a.accusedId,
      accusedRoleId: a.accusedRoleId,
      victimId: a.victimId,
      playedOn: a.playedOn,
      status: 'approved',
      penaltyReport: { status: 'approved' },
    },
  });
  return n > 0;
}

/** Gửi một báo cáo độc lập (luật ở đầu file); trả về báo cáo vừa tạo (`pending`, hoặc `superseded`). */
export async function submitStandaloneAccusation(ctx: Ctx, reporterId: number, input: StandaloneAccusationInputDto): Promise<StandaloneAccusationDto> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw appError('VALIDATION');
  const p = parsed.data;
  await assertActiveMember(ctx, reporterId);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.playedOn)) throw appError('VALIDATION', 'Ngày chơi không hợp lệ');
  let playedOn: Date;
  try {
    playedOn = dateOnlyToDb(p.playedOn);
  } catch {
    throw appError('VALIDATION', 'Ngày chơi không hợp lệ');
  }
  // Chuỗi `YYYY-MM-DD` so theo từ điển đúng bằng so ngày.
  const today = toVnDate(ctx.now());
  if (p.playedOn < addDaysVn(today, -WINDOW_DAYS) || p.playedOn > today) {
    throw appError('PLAYED_ON_OUT_OF_WINDOW', 'Chỉ báo cáo được trận trong 3 ngày gần nhất');
  }
  const seasonId = seasonIdOf(p.playedOn);
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');

  const { start, end } = vnDayRange(today);
  const sentToday = await ctx.db.playerAccusation.count({ where: { reporterId, createdAt: { gte: start, lt: end } } });
  if (sentToday >= MAX_ACCUSATIONS_PER_DAY) throw appError('RATE_LIMITED', `Bạn đã gửi quá ${MAX_ACCUSATIONS_PER_DAY} báo cáo hôm nay`);

  const note = p.note?.trim() ? p.note.trim() : null;
  if (note !== null && note.length > NOTE_MAX) throw appError('VALIDATION', 'Ghi chú tối đa 300 ký tự');

  const sessionId = p.sessionId ?? null;
  if (sessionId !== null) {
    const session = await ctx.db.gameSession.findUnique({ where: { id: sessionId }, select: { startsAt: true, status: true } });
    if (!session) throw appError('VALIDATION', 'Buổi chơi không hợp lệ');
    if (session.status === 'cancelled') throw appError('VALIDATION', 'Buổi chơi đã bị huỷ');
    if (toVnDate(session.startsAt) !== p.playedOn) throw appError('VALIDATION', 'Buổi chơi không khớp ngày chơi');
  }

  const a = await validateAccusation(ctx.db, reporterId, {
    accusedId: p.accusedId,
    accusedRoleId: p.accusedRoleId,
    victimId: p.victimId,
    victimFaction: p.victimFaction,
  });

  // Dòng `seasons` phải có để khoá được.
  await ensureSeason(ctx, seasonId);
  const id = await ctx.db.$transaction(async (tx) => {
    await lockOpenSeason(tx, seasonId);
    const penalised = await casePenalised(tx, { ...a, playedOn });
    const created = await tx.playerAccusation.create({
      data: {
        reportId: null,
        reporterId,
        accusedId: a.accusedId,
        accusedRoleId: a.accusedRoleId,
        victimId: a.victimId,
        victimFaction: a.victimFaction,
        playedOn,
        sessionId,
        note,
        // Ghi rõ để đồng hồ của ctx quyết định thứ tự trong vụ và "ngày gửi".
        createdAt: ctx.now(),
        ...(penalised ? { status: 'superseded' as const, rejectReason: SUPERSEDED_REASON } : {}),
      },
      select: { id: true },
    });
    return created.id;
  }, HOT_TX);
  const row = await loadStandalone(ctx.db, id);
  // Vừa tạo xong; phòng hờ.
  if (!row) throw appError('NOT_FOUND');
  const hidden = await hiddenAccusations(ctx.db, [row]);
  return toDto(row, { admin: false, duplicate: hidden.get(row.id)?.waitingFor != null });
}

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

/** "Báo cáo của tôi": báo cáo độc lập của người gửi, mới nhất trước; `limit` mặc định 50, tối đa 100. */
export async function listMyStandaloneAccusations(ctx: Ctx, reporterId: number, limit = 50): Promise<StandaloneAccusationDto[]> {
  if (!Number.isInteger(limit) || limit < 1) throw appError('VALIDATION', 'Giới hạn không hợp lệ');
  const rows = await ctx.db.playerAccusation.findMany({
    where: { reporterId, reportId: null },
    select: STANDALONE_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(limit, LIST_MAX),
  });
  const hidden = await hiddenAccusations(ctx.db, rows);
  return rows.map((r) => toDto(r, { admin: false, duplicate: hidden.get(r.id)?.waitingFor != null }));
}

/**
 * Hàng chờ "Báo cáo người chơi chờ duyệt": báo cáo độc lập `pending` đang được HIỆN (sớm nhất của vụ,
 * vụ chưa bị trừ điểm), cũ nhất trước. Báo cáo trùng bị ẩn không có ở đây.
 */
export async function listPendingStandaloneAccusations(ctx: Ctx): Promise<StandaloneAccusationDto[]> {
  const rows = await ctx.db.playerAccusation.findMany({
    where: { reportId: null, status: 'pending' },
    select: STANDALONE_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const hidden = await hiddenAccusations(ctx.db, rows);
  return rows.filter((r) => !hidden.has(r.id)).map((r) => toDto(r, { admin: true }));
}

/**
 * "Đã duyệt gần đây" phần báo cáo (như `listRecentlyApproved` của lần khai): báo cáo độc lập `approved`
 * có ngày chơi thuộc mùa chưa chốt — mùa hiện tại và mùa trước nếu chưa chốt — duyệt gần nhất trước, tối đa 50.
 */
export async function listRecentlyApprovedStandaloneAccusations(ctx: Ctx): Promise<StandaloneAccusationDto[]> {
  const current = seasonIdOf(toVnDate(ctx.now()));
  if (await isSeasonClosed(ctx, current)) return [];
  const previous = previousSeasonId(current);
  const first = seasonDateRange((await isSeasonClosed(ctx, previous)) ? current : previous).first;
  const last = seasonDateRange(current).last;
  const rows = await ctx.db.playerAccusation.findMany({
    where: { reportId: null, status: 'approved', playedOn: { gte: dateOnlyToDb(first), lte: dateOnlyToDb(last) } },
    select: STANDALONE_SELECT,
    orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    take: RECENT_APPROVED_MAX,
  });
  return rows.map((r) => toDto(r, { admin: true }));
}

// ---------------------------------------------------------------------------
// Duyệt / từ chối / huỷ duyệt
// ---------------------------------------------------------------------------

/** Mod không quyết báo cáo mà mình là người gửi hoặc người bị báo cáo; admin thì được. */
function assertNotInvolved(a: StandaloneRow, reviewer: Reviewer, message: string): void {
  if (reviewer.accessLevel !== 'admin' && (a.reporterId === reviewer.id || a.accusedId === reviewer.id)) {
    throw appError('SELF_REVIEW', message);
  }
}

function describe(a: StandaloneRow): string {
  return describeAccusation({
    accusedName: a.accused.displayName,
    roleName: a.accusedRole.nameVi,
    victimName: a.victim.displayName,
    victimFaction: a.victimFaction,
    playedOn: dbToDateOnly(a.playedOn),
  });
}

/**
 * Duyệt (báo cáo đúng) hoặc từ chối một báo cáo độc lập. Thứ tự: mod/admin (`FORBIDDEN`) → có
 * (`NOT_FOUND`) → còn `pending` (`NOT_PENDING`) → không tự quyết (`SELF_REVIEW`) → từ chối có lý do
 * (`REASON_REQUIRED`/`VALIDATION`) → mùa chưa chốt (`SEASON_CLOSED`). Trong giao dịch khoá mùa đọc lại
 * vụ: còn báo cáo `pending` sớm hơn → duyệt bị chặn (409 `NOT_PENDING` nêu tên người gửi sớm hơn), từ
 * chối thì được; vụ vừa bị trừ điểm → duyệt thành `superseded` (không trừ điểm hai lần).
 */
export async function reviewStandaloneAccusation(ctx: Ctx, reviewer: Reviewer, id: number, decision: StandaloneReviewDecision): Promise<void> {
  assertReviewer(reviewer);
  const a = await loadStandalone(ctx.db, id);
  if (!a) throw appError('NOT_FOUND');
  if (a.status !== 'pending') throw appError('NOT_PENDING', NOT_PENDING_MESSAGE);
  assertNotInvolved(a, reviewer, SELF_MESSAGE);
  const reason = decision.approve ? null : checkReason(decision.reason, 'từ chối');

  const seasonId = seasonIdOf(dbToDateOnly(a.playedOn));
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');
  const leaderBefore = decision.approve ? await getRoleLeader(ctx, a.accusedRoleId, seasonId) : null;
  const reviewed = { reviewedById: reviewer.id, reviewedAt: ctx.now() };

  await ensureSeason(ctx, seasonId);
  const penalty = await ctx.db.$transaction(async (tx): Promise<PenaltyNotice | null> => {
    await lockOpenSeason(tx, seasonId);
    const fresh = await loadStandalone(tx, id);
    if (fresh?.status !== 'pending') throw appError('NOT_PENDING', NOT_PENDING_MESSAGE);
    if (!decision.approve) {
      await tx.playerAccusation.update({ where: { id }, data: { status: 'rejected', rejectReason: reason, ...reviewed } });
      return null;
    }
    const hidden = (await hiddenAccusations(tx, [fresh])).get(id);
    if (hidden?.waitingFor) {
      throw appError('NOT_PENDING', `Báo cáo này trùng với báo cáo của ${hidden.waitingFor.reporterName} đang chờ — quyết báo cáo đó trước`);
    }
    if (hidden) {
      // Vụ đã bị trừ điểm (một báo cáo khác vừa được duyệt).
      await tx.playerAccusation.update({ where: { id }, data: { status: 'superseded', rejectReason: SUPERSEDED_REASON, ...reviewed } });
      return null;
    }
    return approveCase(tx, fresh, reviewed);
  }, HOT_TX);

  if (!decision.approve) {
    await safeDm(ctx, a.reporter.discordId, 'bác báo cáo', `${describe(a)} bị bác: ${reason ?? ''}`);
    return;
  }
  if (penalty) {
    await safeDm(ctx, penalty.accusedDiscordId, 'trừ điểm', penaltyDmText(penalty));
    await announceIfLeaderChanged(ctx, penalty.roleId, penalty.roleName, seasonId, leaderBefore);
  }
}

/**
 * Huỷ một báo cáo độc lập đã duyệt kèm lý do: báo cáo `revoked` (người/giờ huỷ, lý do; giữ người duyệt)
 * và mục trừ điểm kèm theo `revoked` trong CÙNG giao dịch khoá mùa (mục đã bị huỷ riêng trước thì thôi).
 * Thứ tự: mod/admin (`FORBIDDEN`) → có (`NOT_FOUND`) → `approved` (`NOT_APPROVED`) → không tự huỷ
 * (`SELF_REVIEW`) → lý do (`REASON_REQUIRED`/`VALIDATION`) → mùa chưa chốt (`SEASON_CLOSED`). Sau khi lưu:
 * DM người gửi, DM người bị báo cáo (nếu mục trừ vừa được gỡ), kiểm tra hoá thân role bị trừ.
 */
export async function revokeStandaloneAccusation(ctx: Ctx, reviewer: Reviewer, id: number, rawReason: string): Promise<void> {
  assertReviewer(reviewer);
  const a = await loadStandalone(ctx.db, id);
  if (!a) throw appError('NOT_FOUND');
  if (a.status !== 'approved') throw appError('NOT_APPROVED', NOT_APPROVED_MESSAGE);
  assertNotInvolved(a, reviewer, 'Mod không được huỷ báo cáo mà mình là người gửi hoặc người bị báo cáo');
  const reason = checkReason(rawReason, 'huỷ duyệt');

  const seasonId = seasonIdOf(dbToDateOnly(a.playedOn));
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');
  const leaderBefore = await getRoleLeader(ctx, a.accusedRoleId, seasonId);
  const o = { revokerId: reviewer.id, now: ctx.now(), reason };

  await ensureSeason(ctx, seasonId);
  const lifted = await ctx.db.$transaction(async (tx) => {
    await lockOpenSeason(tx, seasonId);
    const { count } = await tx.playerAccusation.updateMany({
      where: { id, reportId: null, status: 'approved' },
      data: { status: 'revoked', revokedById: o.revokerId, revokedAt: o.now, rejectReason: reason },
    });
    if (count === 0) throw appError('NOT_APPROVED', NOT_APPROVED_MESSAGE);
    return a.penaltyReportId !== null ? revokePenalty(tx, a.penaltyReportId, o) : null;
  }, HOT_TX);

  await safeDm(ctx, a.reporter.discordId, 'huỷ báo cáo', `${describe(a)} đã bị huỷ: ${reason}`);
  if (lifted) {
    await safeDm(ctx, lifted.accusedDiscordId, 'gỡ trừ điểm', penaltyRemovedDmText(lifted, reason));
    await announceIfLeaderChanged(ctx, lifted.roleId, lifted.roleName, seasonId, leaderBefore);
  }
}
