/**
 * Mùa giải (spec §4.7): một tháng dương lịch theo giờ Việt Nam, mã `YYYY-MM`.
 *
 * Nền cho khai điểm: tạo dòng `seasons` khi lần đầu có lần khai thuộc mùa đó
 * (`ensureSeason`) và hỏi mùa đã chốt chưa (`isSeasonClosed`).
 *
 * Chốt mùa (`closeSeason`; bộ hẹn giờ gọi qua `runSeasonJobs` lúc 00:05 ngày 4 tháng
 * sau) chạy lại bao nhiêu lần cũng được. Trong MỘT giao dịch: đặt `closedAt` có điều
 * kiện (chỉ lần đổi được từ null mới trao danh hiệu), từ chối mọi lần khai còn chờ duyệt
 * có ngày chơi trong mùa ('Mùa đã chốt', không có người duyệt) cùng báo cáo người chơi kèm
 * chúng (spec điểm role §6) và mọi lần nhận treo thưởng còn chờ duyệt của mùa (spec treo thưởng
 * §4, cùng lý do), rồi lưu top 1 mỗi role có
 * điểm > 0 vào `role_titles` (`skipDuplicates`). Mùa đã chốt mà gọi lại chỉ dọn lần khai
 * chờ duyệt lọt vào sau giờ chốt (kiểm-tra-rồi-ghi ở `reports.ts` có khe nhỏ) — không
 * tính lại danh hiệu đã trao.
 *
 * Bảng tổng kết chỉ đăng sau khi giao dịch đã lưu: cờ `summaryPending` bật cùng lúc với
 * `closedAt`; bảng dựng lại từ `role_titles` (nên lần đăng bù giống y lần đầu), đăng từng
 * phần ≤ 2000 ký tự, và cờ chỉ tắt khi mọi phần đã gửi được. Discord sập thì lượt sau của
 * bộ hẹn giờ đăng lại cả bảng — phần đã đăng được có thể lặp lại (chấp nhận).
 *
 * Nhắc mod 09:00 ngày 3 tháng sau khi mùa chưa chốt và còn lần khai hay lần nhận treo thưởng chờ duyệt: một lần
 * (`reviewNudgedAt`), và chỉ ghi dấu sau khi Discord đã nhận; đã qua giờ chốt thì không
 * nhắc nữa mà chốt luôn.
 */

import { Prisma } from '@prisma/client';
import type { Faction } from '../../../shared/api-types.js';
import { formatSeasonScore } from '../../../shared/metric.js';
import type { MetricRole } from '../../../shared/metric.js';
import type { Ctx } from '../../ctx.js';
import { chunkLines } from '../../lib/chunk.js';
import { appError } from '../../lib/errors.js';
import {
  dateOnlyToDb,
  formatSeasonLabel,
  seasonCloseAt,
  seasonDateRange,
  seasonIdOf,
  seasonNudgeAt,
  toVnDate,
  vnDayRange,
} from '../../lib/time.js';
import { HOT_TX } from '../../lib/tx.js';
// Vòng import với leaderboard.ts (bên đó dùng `checkSeasonId`, `isSeasonClosed`) là an
// toàn: hai bên chỉ gọi hàm của nhau lúc chạy, không dùng gì ở cấp module.
import { rejectPendingAccusations } from '../stats/accusations.js';
import { computeSeasonLeaders } from '../stats/leaderboard.js';

const SEASON_ID = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Lý do ghi vào lần khai còn chờ duyệt bị từ chối khi mùa chốt. */
export const SEASON_CLOSED_REASON = 'Mùa đã chốt';

/** Mã mùa phải đúng dạng `YYYY-MM` (tháng 01–12); sai → `VALIDATION`. */
export function checkSeasonId(seasonId: string): void {
  if (typeof seasonId !== 'string' || !SEASON_ID.test(seasonId)) throw appError('VALIDATION', 'Mùa không hợp lệ');
}

// ---------------------------------------------------------------------------
// Nền
// ---------------------------------------------------------------------------

/**
 * Tạo dòng `seasons` cho mùa nếu chưa có: `startsAt` = 00:00 ngày đầu tháng giờ VN,
 * `endsAt` = 00:00 ngày đầu tháng sau giờ VN (nửa mở). Dòng đã có — kể cả đã chốt —
 * giữ nguyên. Gọi nhiều lần hay cùng lúc đều vô hại. `seasonId` phải đúng dạng
 * `YYYY-MM` (người gọi kiểm tra trước; sai dạng là lỗi lập trình, ném Error thường).
 */
export async function ensureSeason(ctx: Ctx, seasonId: string): Promise<void> {
  const { first, last } = seasonDateRange(seasonId);
  const startsAt = vnDayRange(first).start;
  const endsAt = vnDayRange(last).end; // = đầu ngày VN kế tiếp ngày cuối tháng
  try {
    await ctx.db.season.upsert({
      where: { id: seasonId },
      create: { id: seasonId, startsAt, endsAt },
      update: {},
    });
  } catch (err) {
    // Hai bên tạo cùng một mùa đúng lúc: bên thua thấy dòng bên thắng vừa tạo — đủ rồi.
    if (!isUniqueViolation(err)) throw err;
  }
}

/** Mùa đã chốt khi dòng tồn tại và có `closedAt`. Chưa có dòng = chưa chốt. */
export async function isSeasonClosed(ctx: Ctx, seasonId: string): Promise<boolean> {
  const row = await ctx.db.season.findUnique({ where: { id: seasonId }, select: { closedAt: true } });
  return row?.closedAt != null;
}

/**
 * Mùa hiện tại (theo giờ VN) và mọi mùa đã có dòng, mới nhất trước, không trùng. Mùa
 * hiện tại luôn có mặt dù chưa ai khai (chưa có dòng → chưa chốt).
 */
export async function listSeasons(ctx: Ctx): Promise<{ id: string; closed: boolean }[]> {
  const current = seasonIdOf(toVnDate(ctx.now()));
  const rows = await ctx.db.season.findMany({ select: { id: true, closedAt: true }, orderBy: { id: 'desc' } });
  const seasons = rows.map((r) => ({ id: r.id, closed: r.closedAt !== null }));
  if (!seasons.some((s) => s.id === current)) {
    seasons.push({ id: current, closed: false });
    // Mã `YYYY-MM` so chuỗi đúng bằng so thời gian.
    seasons.sort((x, y) => (x.id < y.id ? 1 : x.id > y.id ? -1 : 0));
  }
  return seasons;
}

// ---------------------------------------------------------------------------
// Chốt mùa
// ---------------------------------------------------------------------------

/** Điều kiện "lần khai còn chờ duyệt có ngày chơi trong mùa". */
function pendingInSeason(seasonId: string): Prisma.StatReportWhereInput {
  const { first, last } = seasonDateRange(seasonId);
  return { status: 'pending', playedOn: { gte: dateOnlyToDb(first), lte: dateOnlyToDb(last) } };
}

/** Điều kiện "lần nhận treo thưởng còn chờ duyệt có ngày chơi (của buổi) trong mùa". */
function pendingClaimsInSeason(seasonId: string): Prisma.BountyClaimWhereInput {
  const { first, last } = seasonDateRange(seasonId);
  return { status: 'pending', playedOn: { gte: dateOnlyToDb(first), lte: dateOnlyToDb(last) } };
}

/** Từ chối tự động lúc chốt mùa: lý do cố định, không có người duyệt. */
function autoRejection(now: Date): Prisma.StatReportUncheckedUpdateManyInput {
  return { status: 'rejected', rejectReason: SEASON_CLOSED_REASON, reviewedAt: now, reviewedById: null };
}

/** Như `autoRejection`, cho lần nhận treo thưởng. */
function autoClaimRejection(now: Date): Prisma.BountyClaimUncheckedUpdateManyInput {
  return { status: 'rejected', rejectReason: SEASON_CLOSED_REASON, reviewedAt: now, reviewedById: null };
}

/**
 * Chốt một mùa (xem đầu file). Mã mùa sai dạng → `VALIDATION`; mùa chưa có dòng thì tạo
 * rồi chốt luôn. Trả về số danh hiệu vừa ghi (0 khi mùa đã chốt từ trước) và số lần khai
 * chờ duyệt vừa bị từ chối (không đếm lần nhận treo thưởng bị từ chối cùng lúc). Sau khi giao dịch đã lưu, đăng bảng tổng kết nếu còn nợ; lỗi
 * ở bước này chỉ ghi log — bộ hẹn giờ đăng bù.
 */
export async function closeSeason(ctx: Ctx, seasonId: string): Promise<{ titles: number; autoRejected: number }> {
  checkSeasonId(seasonId);
  await ensureSeason(ctx, seasonId);
  const now = ctx.now();

  const result = await ctx.db.$transaction(async (tx) => {
    // Chỉ bên đổi được closedAt từ null mới trao danh hiệu; bên khác (hay lần gọi sau)
    // chỉ dọn lần khai chờ duyệt còn lọt.
    const { count: flipped } = await tx.season.updateMany({
      where: { id: seasonId, closedAt: null },
      data: { closedAt: now, summaryPending: true },
    });
    const wasOpen = flipped === 1;

    // Báo cáo người chơi kèm các lần khai này bị bác cùng lý do (trước, vì điều kiện dựa trên lần khai còn chờ).
    await rejectPendingAccusations(tx, pendingInSeason(seasonId), SEASON_CLOSED_REASON, now);
    const { count: autoRejected } = await tx.statReport.updateMany({ where: pendingInSeason(seasonId), data: autoRejection(now) });
    await tx.bountyClaim.updateMany({ where: pendingClaimsInSeason(seasonId), data: autoClaimRejection(now) });

    let titles = 0;
    if (wasOpen) {
      const leaders = await computeSeasonLeaders(tx, seasonId);
      const rows = [...leaders]
        .filter(([, leader]) => leader.score > 0) // §4.7: chỉ top 1 có điểm > 0 (computeSeasonLeaders đã lọc; giữ cho rõ)
        .map(([roleId, leader]) => ({ seasonId, roleId, memberId: leader.memberId, score: leader.score }));
      if (rows.length > 0) titles = (await tx.roleTitle.createMany({ data: rows, skipDuplicates: true })).count;
    }
    return { titles, autoRejected };
  }, HOT_TX);

  try {
    await deliverSeasonSummary(ctx, seasonId);
  } catch (err) {
    console.error(`[seasons] Mùa ${seasonId} đã chốt nhưng chưa đăng được tổng kết (sẽ đăng bù): ${messageOf(err)}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Bảng tổng kết
// ---------------------------------------------------------------------------

/**
 * Một dòng của bảng tổng kết: người hoá thân một role trong mùa. Mang luôn phần `MetricRole`
 * của role để đọc điểm đúng cách ("12 mạng chém" / "10 điểm" với role có chỉ số phụ).
 */
export interface SeasonTitle extends MetricRole {
  faction: Faction;
  roleName: string;
  displayName: string;
  score: number;
}

const FACTION_ORDER: readonly Faction[] = ['goose', 'duck', 'neutral'];
const FACTION_HEADING: Record<Faction, string> = { goose: '🪿 Phe Ngỗng', duck: '🦆 Phe Vịt', neutral: '🐦 Phe thứ 3' };

/**
 * Văn bản tổng kết mùa, chia thành các phần ≤ 2000 ký tự cắt ở ranh giới dòng: tiêu đề
 * `📜 Tổng kết mùa MM/YYYY`, rồi từng phe theo thứ tự Ngỗng → Vịt → Phe thứ 3 (bỏ phe
 * không có ai) với một dòng `• {role}: {tên} ({điểm mùa})` mỗi danh hiệu — điểm đọc bằng
 * `formatSeasonScore` ("5 mạng đã giết", role có chỉ số phụ: "10 điểm") — giữ thứ tự
 * `titles` trong phe. Phần sau không lặp lại tiêu đề. Không có danh hiệu nào → đúng một
 * phần `📜 Tổng kết mùa MM/YYYY: chưa có ai hoá thân.`
 */
export function buildSeasonSummary(seasonId: string, titles: SeasonTitle[]): string[] {
  const label = formatSeasonLabel(seasonId);
  if (titles.length === 0) return [`📜 Tổng kết mùa ${label}: chưa có ai hoá thân.`];

  const lines = [`📜 Tổng kết mùa ${label}`];
  for (const faction of FACTION_ORDER) {
    const own = titles.filter((t) => t.faction === faction);
    if (own.length === 0) continue;
    lines.push(FACTION_HEADING[faction], ...own.map((t) => `• ${t.roleName}: ${t.displayName} (${formatSeasonScore(t.score, t)})`));
  }
  return chunkLines(lines);
}

/** Danh hiệu của mùa từ `role_titles`, trong phe theo thứ tự danh mục (sortOrder rồi id). */
async function loadTitles(ctx: Ctx, seasonId: string): Promise<SeasonTitle[]> {
  const rows = await ctx.db.roleTitle.findMany({
    where: { seasonId },
    select: {
      score: true,
      role: {
        select: {
          faction: true,
          nameVi: true,
          metricLabel: true,
          points: true,
          extraMetricLabel: true,
          extraPoints: true,
          penaltyMetricLabel: true,
          penaltyMaxPerGame: true,
          penaltyPoints: true,
        },
      },
      member: { select: { displayName: true } },
    },
    orderBy: [{ role: { sortOrder: 'asc' } }, { roleId: 'asc' }],
  });
  return rows.map((r) => ({
    faction: r.role.faction,
    roleName: r.role.nameVi,
    displayName: r.member.displayName,
    score: r.score,
    metricLabel: r.role.metricLabel,
    points: r.role.points,
    extraMetricLabel: r.role.extraMetricLabel,
    extraPoints: r.role.extraPoints,
    penaltyMetricLabel: r.role.penaltyMetricLabel,
    penaltyMaxPerGame: r.role.penaltyMaxPerGame,
    penaltyPoints: r.role.penaltyPoints,
  }));
}

/**
 * Đăng bảng tổng kết nếu mùa còn nợ (`summaryPending`), dựng lại từ `role_titles` nên
 * lần đăng bù giống y lần đầu. Đăng từng phần theo thứ tự; tất cả thành công mới tắt cờ.
 * Discord lỗi giữa chừng → ghi log, giữ cờ để lượt sau đăng lại cả bảng. Lỗi DB ném ra.
 */
export async function deliverSeasonSummary(ctx: Ctx, seasonId: string): Promise<void> {
  const season = await ctx.db.season.findUnique({ where: { id: seasonId }, select: { summaryPending: true } });
  if (!season?.summaryPending) return;

  const chunks = buildSeasonSummary(seasonId, await loadTitles(ctx, seasonId));
  try {
    for (const chunk of chunks) await ctx.notifier.announce(chunk);
  } catch (err) {
    console.error(`[seasons] Không đăng được tổng kết mùa ${seasonId} (sẽ đăng bù): ${messageOf(err)}`);
    return;
  }
  await ctx.db.season.updateMany({ where: { id: seasonId }, data: { summaryPending: false } });
}

// ---------------------------------------------------------------------------
// Việc định kỳ (bộ hẹn giờ)
// ---------------------------------------------------------------------------

/**
 * Việc `season` của bộ hẹn giờ: với mỗi mùa đã có dòng và cũ hơn mùa hiện tại, cũ nhất
 * trước — mùa chưa chốt: tới giờ chốt thì chốt (kèm tổng kết), chưa tới thì nhắc mod
 * nếu đã 09:00 ngày 3 và chưa nhắc; mùa đã chốt: từ chối lần khai chờ duyệt còn lọt và
 * đăng bù tổng kết nếu còn nợ. Mỗi mùa độc lập: một mùa lỗi được ghi log, mùa khác vẫn
 * chạy. Mùa chưa có dòng thì chưa ai khai gì — không có gì để làm.
 */
export async function runSeasonJobs(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  const current = seasonIdOf(toVnDate(now));
  const seasons = await ctx.db.season.findMany({
    where: { id: { lt: current } },
    select: { id: true, closedAt: true, reviewNudgedAt: true, summaryPending: true },
    orderBy: { id: 'asc' },
  });
  for (const season of seasons) {
    try {
      if (season.closedAt === null) await tendOpenSeason(ctx, season, now);
      else await tendClosedSeason(ctx, season, now);
    } catch (err) {
      console.error(`[seasons] Việc định kỳ của mùa ${season.id} lỗi: ${messageOf(err)}`);
    }
  }
}

/** Mùa chưa chốt: chốt khi tới giờ; trước đó nhắc mod một lần kể từ 09:00 ngày 3. */
async function tendOpenSeason(ctx: Ctx, season: { id: string; reviewNudgedAt: Date | null }, now: Date): Promise<void> {
  if (now.getTime() >= seasonCloseAt(season.id).getTime()) {
    await closeSeason(ctx, season.id);
    return;
  }
  if (season.reviewNudgedAt === null && now.getTime() >= seasonNudgeAt(season.id).getTime()) {
    await nudgeReviewers(ctx, season.id, now);
  }
}

/** Mùa đã chốt: dọn lần khai chờ duyệt lọt vào sau giờ chốt; đăng bù tổng kết nếu còn nợ. */
async function tendClosedSeason(ctx: Ctx, season: { id: string; summaryPending: boolean }, now: Date): Promise<void> {
  await rejectStrayPending(ctx, season.id, now);
  if (season.summaryPending) await deliverSeasonSummary(ctx, season.id);
}

/**
 * Nhắc mod duyệt nốt hàng chờ của mùa — chỉ khi còn lần khai hoặc lần nhận treo thưởng chờ
 * (cả hai đều bị từ chối "Mùa đã chốt" lúc chốt); tin nhắn nêu từng loại, bỏ loại bằng 0.
 * Ghi `reviewNudgedAt` SAU khi Discord đã nhận: gửi lỗi thì ném ra (được ghi log) và lượt sau nhắc lại.
 */
async function nudgeReviewers(ctx: Ctx, seasonId: string, now: Date): Promise<void> {
  const reports = await ctx.db.statReport.count({ where: pendingInSeason(seasonId) });
  const claims = await ctx.db.bountyClaim.count({ where: pendingClaimsInSeason(seasonId) });
  if (reports === 0 && claims === 0) return;
  const parts = [reports > 0 ? `${reports} lần khai` : null, claims > 0 ? `${claims} lần nhận treo thưởng` : null].filter((p) => p !== null);
  await ctx.notifier.announce(`📝 Mod ơi, còn ${parts.join(' và ')} của mùa ${formatSeasonLabel(seasonId)} chờ duyệt. Hạn chót 00:05 ngày 4.`);
  await ctx.db.season.updateMany({ where: { id: seasonId, reviewNudgedAt: null }, data: { reviewNudgedAt: now } });
}

/**
 * Lần khai / lần nhận treo thưởng chờ duyệt lọt vào mùa đã chốt (khe kiểm-tra-rồi-ghi khi khai
 * hay nhận): từ chối như lúc chốt. Đếm trước cho rẻ.
 */
async function rejectStrayPending(ctx: Ctx, seasonId: string, now: Date): Promise<void> {
  const where = pendingInSeason(seasonId);
  const claimWhere = pendingClaimsInSeason(seasonId);
  const [reports, claims] = [await ctx.db.statReport.count({ where }), await ctx.db.bountyClaim.count({ where: claimWhere })];
  if (reports === 0 && claims === 0) return;
  const counts = await ctx.db.$transaction(async (tx) => {
    await rejectPendingAccusations(tx, where, SEASON_CLOSED_REASON, now);
    const r = (await tx.statReport.updateMany({ where, data: autoRejection(now) })).count;
    const c = (await tx.bountyClaim.updateMany({ where: claimWhere, data: autoClaimRejection(now) })).count;
    return { r, c };
  });
  if (counts.r > 0) console.warn(`[seasons] Đã từ chối ${counts.r} lần khai lọt vào mùa ${seasonId} sau giờ chốt`);
  if (counts.c > 0) console.warn(`[seasons] Đã từ chối ${counts.c} lần nhận treo thưởng lọt vào mùa ${seasonId} sau giờ chốt`);
}

// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
