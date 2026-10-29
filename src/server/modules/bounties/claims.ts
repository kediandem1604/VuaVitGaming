/**
 * Lần nhận treo thưởng (spec treo thưởng §4, §6, §8): người chơi báo "đã hoàn thành" một mục ở một
 * buổi (web hoặc Discord — `claimBounty` dùng chung cho cả hai), mod/admin duyệt, từ chối hoặc huỷ
 * duyệt trên web.
 *
 * Nhận — kiểm tra theo đúng thứ tự: người nhận còn trong server (`FORBIDDEN`) → buổi có (`NOT_FOUND`)
 * và không bị huỷ (`SESSION_NOT_OPEN`) → mục đang bật và áp dụng cho buổi — riêng buổi đó hoặc mọi buổi (`BOUNTY_NOT_APPLICABLE`) → ngày VN của
 * buổi trong `[hôm nay − 3, hôm nay]` (quá hạn → `BOUNTY_CLAIM_EXPIRED`; buổi ngày sau →
 * `VALIDATION` "Buổi chơi chưa diễn ra") → mùa của ngày buổi chưa chốt (`SEASON_CLOSED`) → chưa có lần
 * nhận cùng (mục, người, buổi), kể cả đã bị từ chối (`BOUNTY_ALREADY_CLAIMED`). Lần nhận chép `roleId`
 * và `points` của mục lúc nhận. Việc ghi nằm trong giao dịch khoá dòng `seasons` (`FOR UPDATE`) như
 * duyệt/huỷ — lần nhận không lọt vào sau lúc chốt mùa; hai lần nhận trùng chạy song song (web và
 * Discord cùng lúc) thì UNIQUE `(bounty_id, member_id, session_id)` chặn lần sau → cũng
 * `BOUNTY_ALREADY_CLAIMED`. Không cần điểm danh: mọi thành viên còn trong server đều nhận được, kể cả
 * chưa bấm Tham gia hay đã huỷ tham gia (chủ server chốt 2026-10-30).
 *
 * Duyệt/từ chối/huỷ duyệt: giống lần khai (`stats/reports.ts`) — mod/admin; mod không tự duyệt/huỷ
 * phần của mình (admin được); lý do 1–200 ký tự sau khi cắt khoảng trắng; ghi trong giao dịch khoá dòng
 * mùa rồi kiểm lại `closedAt` (xếp hàng với chốt mùa: hoặc lần nhận được duyệt trước và tính vào
 * `role_titles`, hoặc chốt trước và lần nhận đã bị từ chối "Mùa đã chốt"); đổi trạng thái có điều kiện
 * (khoá lạc quan — hai mod cùng bấm thì một người nhận `NOT_PENDING`/`NOT_APPROVED`). Buổi bị huỷ sau
 * khi đã có lần nhận không chặn duyệt (chỉ chặn nhận mới). Sau khi lưu: duyệt → đăng
 * "✅ {tên} hoàn thành **{mục}** +{điểm}" vào `#treo-thưởng` (`postBountyCompleted`); từ chối/huỷ → DM
 * người nhận; duyệt/huỷ lần nhận có role → kiểm tra đổi người hoá thân. Lỗi Discord chỉ ghi log.
 */

import { Prisma } from '@prisma/client';
import type { BountyClaimDto, BountyClaimSource, SessionBountiesDto } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { addDaysVn, dateOnlyToDb, dbToDateOnly, formatVnDay, previousSeasonId, seasonDateRange, seasonIdOf, toVnDate } from '../../lib/time.js';
import { HOT_TX } from '../../lib/tx.js';
import { ensureSeason, isSeasonClosed } from '../seasons/service.js';
import { getRoleLeader } from '../stats/leaderboard.js';
import type { LeaderboardRow } from '../stats/leaderboard.js';
import { announceIfLeaderChanged, assertActiveMember, assertReviewer, checkReason, isId, lockOpenSeason } from '../stats/reports.js';
import type { Reviewer } from '../stats/reports.js';
import { bountiesForSession } from './admin.js';

/** Nhận được tới bấy nhiêu ngày VN sau ngày buổi. */
const WINDOW_DAYS = 3;
/** Giới hạn trên của `limit` trong `listMyBountyClaims`. */
const LIST_MAX = 100;
/** Số dòng tối đa của "Đã duyệt gần đây". */
const RECENT_APPROVED_MAX = 50;

/** Quyết định của mod: duyệt, hoặc từ chối kèm lý do (1–200 ký tự sau khi cắt). */
export type BountyReviewDecision = { approve: true } | { approve: false; reason: string };

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

const CLAIM_SELECT = {
  id: true,
  playedOn: true,
  points: true,
  status: true,
  rejectReason: true,
  source: true,
  createdAt: true,
  reviewedAt: true,
  bounty: { select: { id: true, title: true, description: true } },
  member: { select: { id: true, displayName: true } },
  session: { select: { id: true, startsAt: true, mode: { select: { nameVi: true } } } },
  role: { select: { id: true, nameVi: true, icon: true, faction: true } },
  reviewedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.BountyClaimSelect;

type ClaimRow = Prisma.BountyClaimGetPayload<{ select: typeof CLAIM_SELECT }>;

function toDto(c: ClaimRow): BountyClaimDto {
  return {
    id: c.id,
    bounty: c.bounty,
    member: c.member,
    session: { id: c.session.id, startsAt: c.session.startsAt.toISOString(), modeName: c.session.mode.nameVi },
    playedOn: dbToDateOnly(c.playedOn),
    role: c.role,
    points: c.points,
    status: c.status,
    rejectReason: c.rejectReason,
    source: c.source,
    createdAt: c.createdAt.toISOString(),
    reviewedBy: c.reviewedBy,
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Nhận
// ---------------------------------------------------------------------------

/**
 * Báo đã hoàn thành mục `bountyId` ở buổi `sessionId` (luật ở đầu file); trả về lần nhận `pending`
 * vừa tạo (`createdAt = ctx.now()`). Dùng cho cả web (`source: 'web'`) và bot Discord (`'discord'`).
 */
export async function claimBounty(
  ctx: Ctx,
  memberId: number,
  sessionId: number,
  bountyId: number,
  source: BountyClaimSource,
): Promise<BountyClaimDto> {
  await assertActiveMember(ctx, memberId);
  const session = isId(sessionId)
    ? await ctx.db.gameSession.findUnique({
        where: { id: sessionId },
        select: { status: true, startsAt: true },
      })
    : null;
  if (!session) throw appError('NOT_FOUND');
  if (session.status === 'cancelled') throw appError('SESSION_NOT_OPEN', 'Buổi chơi đã bị huỷ');

  const bounty = isId(bountyId)
    ? await ctx.db.bounty.findUnique({ where: { id: bountyId }, select: { active: true, sessionId: true, roleId: true, points: true } })
    : null;
  if (!bounty || !bounty.active || (bounty.sessionId !== null && bounty.sessionId !== sessionId)) throw appError('BOUNTY_NOT_APPLICABLE');

  // Chuỗi `YYYY-MM-DD` so theo từ điển đúng bằng so ngày.
  const playedOn = toVnDate(session.startsAt);
  const today = toVnDate(ctx.now());
  if (playedOn < addDaysVn(today, -WINDOW_DAYS)) throw appError('BOUNTY_CLAIM_EXPIRED');
  if (playedOn > today) throw appError('VALIDATION', 'Buổi chơi chưa diễn ra');

  const seasonId = seasonIdOf(playedOn);
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');

  const existing = await ctx.db.bountyClaim.findUnique({
    where: { bountyId_memberId_sessionId: { bountyId, memberId, sessionId } },
    select: { id: true },
  });
  if (existing) throw appError('BOUNTY_ALREADY_CLAIMED');

  // Dòng `seasons` phải có để khoá được.
  await ensureSeason(ctx, seasonId);
  try {
    const created = await ctx.db.$transaction(async (tx) => {
      await lockOpenSeason(tx, seasonId);
      return tx.bountyClaim.create({
        data: {
          bountyId,
          memberId,
          sessionId,
          playedOn: dateOnlyToDb(playedOn),
          roleId: bounty.roleId,
          points: bounty.points,
          source,
          // Ghi rõ để đồng hồ của ctx (không phải giờ thật) quyết định giờ nhận.
          createdAt: ctx.now(),
        },
        select: CLAIM_SELECT,
      });
    }, HOT_TX);
    return toDto(created);
  } catch (err) {
    // Lần nhận trùng chen vào giữa lúc kiểm tra và lúc ghi (web và Discord cùng lúc).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw appError('BOUNTY_ALREADY_CLAIMED');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

/** Thẻ "Treo thưởng" của một buổi cho người xem (`SessionBountiesDto`). Buổi không có → `NOT_FOUND`. */
export async function getSessionBounties(ctx: Ctx, viewerId: number, sessionId: number): Promise<SessionBountiesDto> {
  const session = isId(sessionId)
    ? await ctx.db.gameSession.findUnique({
        where: { id: sessionId },
        select: { status: true, startsAt: true },
      })
    : null;
  if (!session) throw appError('NOT_FOUND');

  const playedOn = toVnDate(session.startsAt);
  const today = toVnDate(ctx.now());
  const inWindow = playedOn >= addDaysVn(today, -WINDOW_DAYS) && playedOn <= today;
  const open = session.status !== 'cancelled' && inWindow && !(await isSeasonClosed(ctx, seasonIdOf(playedOn)));

  const [bounties, mine] = await Promise.all([
    bountiesForSession(ctx, sessionId),
    ctx.db.bountyClaim.findMany({ where: { sessionId, memberId: viewerId }, select: CLAIM_SELECT, orderBy: { id: 'asc' } }),
  ]);
  return {
    sessionId,
    open,
    bounties,
    myClaims: mine.map(toDto),
  };
}

/** Lần nhận của một người ("Treo thưởng của tôi"), mới nhất trước; `limit` mặc định 50, tối đa 100. */
export async function listMyBountyClaims(ctx: Ctx, memberId: number, limit = 50): Promise<BountyClaimDto[]> {
  if (!Number.isInteger(limit) || limit < 1) throw appError('VALIDATION', 'Giới hạn không hợp lệ');
  const rows = await ctx.db.bountyClaim.findMany({
    where: { memberId },
    select: CLAIM_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(limit, LIST_MAX),
  });
  return rows.map(toDto);
}

/** Hàng chờ duyệt treo thưởng của mọi người, cũ nhất trước. */
export async function listPendingBountyClaims(ctx: Ctx): Promise<BountyClaimDto[]> {
  const rows = await ctx.db.bountyClaim.findMany({
    where: { status: 'pending' },
    select: CLAIM_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toDto);
}

/**
 * "Đã duyệt gần đây" phần treo thưởng (như `listRecentlyApproved` của lần khai): lần nhận `approved`
 * có ngày buổi thuộc mùa chưa chốt — mùa hiện tại và mùa trước nếu chưa chốt — duyệt gần nhất trước,
 * tối đa 50.
 */
export async function listRecentlyApprovedBountyClaims(ctx: Ctx): Promise<BountyClaimDto[]> {
  const current = seasonIdOf(toVnDate(ctx.now()));
  // Mùa hiện tại đã chốt (chốt tay sớm) thì mùa trước cũng đã chốt — không còn gì để huỷ.
  if (await isSeasonClosed(ctx, current)) return [];
  const previous = previousSeasonId(current);
  // Hai mùa liền nhau nên khoảng ngày buổi là một đoạn liên tục.
  const first = seasonDateRange((await isSeasonClosed(ctx, previous)) ? current : previous).first;
  const last = seasonDateRange(current).last;

  const rows = await ctx.db.bountyClaim.findMany({
    where: { status: 'approved', playedOn: { gte: dateOnlyToDb(first), lte: dateOnlyToDb(last) } },
    select: CLAIM_SELECT,
    orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    take: RECENT_APPROVED_MAX,
  });
  return rows.map(toDto);
}

// ---------------------------------------------------------------------------
// Duyệt / từ chối / huỷ duyệt
// ---------------------------------------------------------------------------

const REVIEWABLE_SELECT = {
  id: true,
  memberId: true,
  roleId: true,
  points: true,
  playedOn: true,
  status: true,
  member: { select: { discordId: true, displayName: true } },
  bounty: { select: { title: true } },
  role: { select: { nameVi: true } },
} satisfies Prisma.BountyClaimSelect;

type ReviewableClaim = Prisma.BountyClaimGetPayload<{ select: typeof REVIEWABLE_SELECT }>;

async function loadReviewable(ctx: Ctx, claimId: number): Promise<ReviewableClaim> {
  const claim = isId(claimId) ? await ctx.db.bountyClaim.findUnique({ where: { id: claimId }, select: REVIEWABLE_SELECT }) : null;
  if (!claim) throw appError('NOT_FOUND');
  return claim;
}

/** Top 1 của role của lần nhận trong mùa, TRƯỚC khi đổi — để biết có đổi người hoá thân. Không role → null. */
async function leaderOf(ctx: Ctx, claim: ReviewableClaim, seasonId: string): Promise<LeaderboardRow | null> {
  return claim.roleId === null ? null : getRoleLeader(ctx, claim.roleId, seasonId);
}

async function announceLeader(ctx: Ctx, claim: ReviewableClaim, seasonId: string, before: LeaderboardRow | null): Promise<void> {
  if (claim.roleId === null || claim.role === null) return;
  await announceIfLeaderChanged(ctx, claim.roleId, claim.role.nameVi, seasonId, before);
}

/**
 * Duyệt hoặc từ chối một lần nhận. Thứ tự: người duyệt là mod/admin (`FORBIDDEN`) → lần nhận có
 * (`NOT_FOUND`) → còn `pending` (`NOT_PENDING`) → mod không tự duyệt (`SELF_REVIEW`) → từ chối phải có
 * lý do (`REASON_REQUIRED`/`VALIDATION`) → mùa chưa chốt (`SEASON_CLOSED`). Sau khi lưu: duyệt → thông
 * báo `#treo-thưởng` và kiểm tra hoá thân; từ chối → DM.
 */
export async function reviewBountyClaim(ctx: Ctx, reviewer: Reviewer, claimId: number, decision: BountyReviewDecision): Promise<void> {
  assertReviewer(reviewer);
  const claim = await loadReviewable(ctx, claimId);
  if (claim.status !== 'pending') throw appError('NOT_PENDING', 'Lần nhận này đã được xử lý');
  if (claim.memberId === reviewer.id && reviewer.accessLevel !== 'admin') {
    throw appError('SELF_REVIEW', 'Mod không được tự duyệt lần nhận của mình');
  }
  const reason = decision.approve ? null : checkReason(decision.reason, 'từ chối');

  const seasonId = seasonIdOf(dbToDateOnly(claim.playedOn));
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');
  const leaderBefore = decision.approve ? await leaderOf(ctx, claim, seasonId) : null;

  // Lần nhận chờ duyệt thì mùa đã được tạo; gọi lại vô hại (cần dòng để khoá).
  await ensureSeason(ctx, seasonId);
  await ctx.db.$transaction(async (tx) => {
    await lockOpenSeason(tx, seasonId);
    const { count } = await tx.bountyClaim.updateMany({
      where: { id: claimId, status: 'pending' },
      data: { status: decision.approve ? 'approved' : 'rejected', reviewedById: reviewer.id, reviewedAt: ctx.now(), rejectReason: reason },
    });
    if (count === 0) throw appError('NOT_PENDING', 'Lần nhận này đã được xử lý');
  }, HOT_TX);

  if (decision.approve) {
    await postCompleted(ctx, claim);
    await announceLeader(ctx, claim, seasonId, leaderBefore);
  } else {
    await dmClaimant(ctx, claim, 'từ chối', `${describe(claim)} bị từ chối: ${reason ?? ''}`);
  }
}

/**
 * Huỷ một lần nhận đã duyệt kèm lý do: `approved → revoked`, lưu người/giờ huỷ và lý do, giữ người
 * duyệt. Thứ tự: mod/admin (`FORBIDDEN`) → có (`NOT_FOUND`) → đang `approved` (`NOT_APPROVED`) → mod
 * không huỷ phần của mình (`SELF_REVIEW`) → lý do (`REASON_REQUIRED`/`VALIDATION`) → mùa chưa chốt
 * (`SEASON_CLOSED`). Sau khi lưu: DM người nhận, kiểm tra hoá thân.
 */
export async function revokeBountyClaim(ctx: Ctx, reviewer: Reviewer, claimId: number, rawReason: string): Promise<void> {
  assertReviewer(reviewer);
  const claim = await loadReviewable(ctx, claimId);
  if (claim.status !== 'approved') throw appError('NOT_APPROVED', 'Lần nhận không còn ở trạng thái đã duyệt');
  if (claim.memberId === reviewer.id && reviewer.accessLevel !== 'admin') {
    throw appError('SELF_REVIEW', 'Mod không được huỷ duyệt lần nhận của mình');
  }
  const reason = checkReason(rawReason, 'huỷ duyệt');

  const seasonId = seasonIdOf(dbToDateOnly(claim.playedOn));
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');
  const leaderBefore = await leaderOf(ctx, claim, seasonId);

  await ensureSeason(ctx, seasonId);
  await ctx.db.$transaction(async (tx) => {
    await lockOpenSeason(tx, seasonId);
    const { count } = await tx.bountyClaim.updateMany({
      where: { id: claimId, status: 'approved' },
      data: { status: 'revoked', revokedById: reviewer.id, revokedAt: ctx.now(), rejectReason: reason },
    });
    if (count === 0) throw appError('NOT_APPROVED', 'Lần nhận không còn ở trạng thái đã duyệt');
  }, HOT_TX);

  await dmClaimant(ctx, claim, 'huỷ duyệt', `${describe(claim)} đã bị huỷ duyệt: ${reason}`);
  await announceLeader(ctx, claim, seasonId, leaderBefore);
}

/** `Lần nhận treo thưởng "{mục}" (buổi {dd/mm})` — phần đầu chung của DM từ chối và huỷ duyệt. */
function describe(claim: ReviewableClaim): string {
  return `Lần nhận treo thưởng "${claim.bounty.title}" (buổi ${formatVnDay(dbToDateOnly(claim.playedOn))})`;
}

/** DM người nhận; Discord lỗi chỉ ghi log — DB đã lưu rồi. */
async function dmClaimant(ctx: Ctx, claim: ReviewableClaim, what: string, text: string): Promise<void> {
  try {
    await ctx.notifier.sendDm(claim.member.discordId, text);
  } catch (err) {
    console.error(`[bounties] Không gửi được DM ${what} lần nhận ${claim.id} tới ${claim.member.discordId}: ${messageOf(err)}`);
  }
}

/** Thông báo duyệt vào `#treo-thưởng` (điểm là bản chép lúc nhận); Discord lỗi chỉ ghi log. */
async function postCompleted(ctx: Ctx, claim: ReviewableClaim): Promise<void> {
  try {
    await ctx.notifier.postBountyCompleted({ memberName: claim.member.displayName, bountyTitle: claim.bounty.title, points: claim.points });
  } catch (err) {
    console.error(`[bounties] Không đăng được thông báo duyệt lần nhận ${claim.id}: ${messageOf(err)}`);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
