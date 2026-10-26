/**
 * Danh hiệu tháng (spec huy hiệu §3.1, §4, §6.1, §8): bảy danh hiệu trao MỘT lần cho
 * mỗi tháng lịch giờ VN sau khi tháng đó chốt, ghi đóng băng vào `member_badges`.
 *
 * Tháng M được trao khi `now >= seasonCloseAt(M)` (00:05 VN ngày 4 tháng sau) và, nếu
 * có dòng `seasons` của M, dòng đó đã chốt (`closedAt`) — để Top phe dùng số liệu đã chốt.
 * Tháng không có dòng `seasons` (chỉ có vote / điểm danh) vẫn trao. Dòng `badge_months`
 * là khoá chống trao trùng: `awardMonth` tính các danh hiệu trước (chỉ đọc), rồi trong
 * MỘT giao dịch tạo dòng `badge_months` (trùng khoá → tiến trình khác đã trao → trả về
 * false, không ghi gì) và `createMany` `member_badges`.
 *
 * Tin tổng kết (§8) chỉ đăng sau khi giao dịch đã lưu, dựng lại từ `member_badges` nên
 * lần đăng bù giống y lần đầu; cờ `announcePending` chỉ tắt khi Discord đã nhận mọi
 * phần. Discord sập → giữ cờ, lượt sau của bộ hẹn giờ đăng lại (phần đã đăng được có thể
 * lặp — chấp nhận, như tổng kết mùa). Tháng không ai đạt danh hiệu → `announcePending`
 * false ngay từ đầu, không đăng gì.
 *
 * Số liệu (§4): một lần thắng vote = một dòng `awards`, tháng theo ngày VN của
 * `game_sessions.starts_at` (như Sảnh tri ân); nhóm hạng mục đọc giá trị HIỆN TẠI của
 * `award_categories.badge_group`. Một trận đã đi = điểm danh `going` ở buổi `ended`. Đa
 * diện đếm role khác nhau có lần khai đã duyệt với ngày chơi trong tháng. Top phe = hạng
 * 1 của `getFactionTop(ctx, M, 1)` (đã ×5 role tối đa 1/trận và phân hoà).
 */

import { Prisma } from '@prisma/client';
import type { Faction } from '../../../shared/api-types.js';
import { BADGES, badgeDef, monthlyBadgeTitle } from '../../../shared/badges.js';
import type { BadgeKey, MonthlyBadgeKey } from '../../../shared/badges.js';
import type { Ctx } from '../../ctx.js';
import { chunkLines } from '../../lib/chunk.js';
import { escapeDiscordMarkdown } from '../../lib/discord-text.js';
import {
  dateOnlyToDb,
  dbToDateOnly,
  formatSeasonLabel,
  previousSeasonId,
  seasonCloseAt,
  seasonDateRange,
  seasonIdOf,
  toVnDate,
  vnDayRange,
} from '../../lib/time.js';
import { HOT_TX } from '../../lib/tx.js';
import { getFactionTop } from '../stats/leaderboard.js';

/** Một danh hiệu sắp ghi vào `member_badges` (chưa có `awardedAt` — ghi lúc trao). Cột mốc (Task 3) dùng lại. */
export interface BadgeGrant {
  memberId: number;
  badgeKey: BadgeKey;
  /** `YYYY-MM` với danh hiệu tháng; `''` với cột mốc. */
  periodId: string;
  title: string;
  icon: string;
  detail: string;
}

/** Thứ tự danh hiệu tháng trong danh mục — thứ tự ghi và thứ tự dòng trong tin tổng kết. */
const MONTHLY_KEYS: readonly MonthlyBadgeKey[] = BADGES.filter((b) => b.kind === 'monthly').map((b) => b.key as MonthlyBadgeKey);
const MONTHLY_KEY_SET: ReadonlySet<string> = new Set(MONTHLY_KEYS);

const FACTION_BADGE: Record<Faction, MonthlyBadgeKey> = { goose: 'top_goose', duck: 'top_duck', neutral: 'top_neutral' };

// ---------------------------------------------------------------------------
// Tính danh hiệu của một tháng
// ---------------------------------------------------------------------------

/** Khoảng UTC [start, end) bao trọn tháng VN `periodId`. */
function monthRange(periodId: string): { start: Date; end: Date } {
  const { first, last } = seasonDateRange(periodId);
  return { start: vnDayRange(first).start, end: vnDayRange(last).end };
}

/** Điều kiện "buổi bắt đầu trong tháng" trên `game_sessions`. */
function sessionInMonth(periodId: string): Prisma.GameSessionWhereInput {
  const { start, end } = monthRange(periodId);
  return { startsAt: { gte: start, lt: end } };
}

/** Dựng một danh hiệu tháng theo danh mục: tên `{name} tháng {MM}/{YYYY}`, icon hiện tại. */
function grant(key: MonthlyBadgeKey, periodId: string, memberId: number, detail: string): BadgeGrant {
  const def = badgeDef(key);
  return { memberId, badgeKey: key, periodId, title: monthlyBadgeTitle(def.name, periodId), icon: def.icon, detail };
}

/**
 * Những người đạt số cao nhất (bằng nhau thì tất cả), chỉ khi số đó ≥ `min`; theo id
 * thành viên để thứ tự ghi luôn xác định.
 */
function leaders(counts: Map<number, number>, min: number): { memberId: number; n: number }[] {
  let best = 0;
  for (const n of counts.values()) if (n > best) best = n;
  if (best < min) return [];
  return [...counts]
    .filter(([, n]) => n === best)
    .map(([memberId, n]) => ({ memberId, n }))
    .sort((x, y) => x.memberId - y.memberId);
}

/** Số lần thắng vote trong tháng theo nhóm hạng mục (đọc nhóm hiện tại), mỗi người một số. */
async function voteWinCounts(ctx: Ctx, periodId: string, group: 'mvp' | 'fun'): Promise<Map<number, number>> {
  const rows = await ctx.db.award.groupBy({
    by: ['memberId'],
    where: { category: { badgeGroup: group }, round: { session: sessionInMonth(periodId) } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.memberId, r._count._all]));
}

/** Số trận đã đi trong tháng: điểm danh `going` ở buổi đã `ended` bắt đầu trong tháng. */
async function gamesPlayedCounts(ctx: Ctx, periodId: string): Promise<Map<number, number>> {
  const rows = await ctx.db.attendance.groupBy({
    by: ['memberId'],
    where: { status: 'going', session: { status: 'ended', ...sessionInMonth(periodId) } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.memberId, r._count._all]));
}

/** Số role khác nhau có lần khai đã duyệt với ngày chơi trong tháng, mỗi người một số. */
async function approvedRoleCounts(ctx: Ctx, periodId: string): Promise<Map<number, number>> {
  const { first, last } = seasonDateRange(periodId);
  const pairs = await ctx.db.statReport.groupBy({
    by: ['memberId', 'roleId'],
    where: { status: 'approved', playedOn: { gte: dateOnlyToDb(first), lte: dateOnlyToDb(last) } },
  });
  const counts = new Map<number, number>();
  for (const { memberId } of pairs) counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
  return counts;
}

/**
 * Bảy danh hiệu §3.1 của tháng `periodId` (`YYYY-MM`, sai dạng → ném lỗi), theo thứ tự
 * danh mục rồi id thành viên. Không ai đạt tối thiểu → không có dòng cho danh hiệu đó.
 * Chỉ đọc; không ghi gì.
 */
export async function computeMonthlyBadges(ctx: Ctx, periodId: string): Promise<BadgeGrant[]> {
  const [mvp, fun, top, games, roles] = await Promise.all([
    voteWinCounts(ctx, periodId, 'mvp'),
    voteWinCounts(ctx, periodId, 'fun'),
    getFactionTop(ctx, periodId, 1),
    gamesPlayedCounts(ctx, periodId),
    approvedRoleCounts(ctx, periodId),
  ]);

  const grants: BadgeGrant[] = [];
  for (const l of leaders(mvp, 1)) grants.push(grant('smvp', periodId, l.memberId, `${l.n} lần MVP`));
  for (const l of leaders(fun, 1)) grants.push(grant('fun_king', periodId, l.memberId, `${l.n} lần thắng hạng mục vui`));
  for (const faction of ['goose', 'duck', 'neutral'] as const) {
    // Hạng 1 của phe; `getFactionTop` chỉ trả dòng có điểm > 0 nên không cần lọc thêm.
    const first = top.factions[faction][0];
    if (first) grants.push(grant(FACTION_BADGE[faction], periodId, first.memberId, `${first.points} điểm · ${first.role.nameVi}`));
  }
  for (const l of leaders(games, 1)) grants.push(grant('grinder', periodId, l.memberId, `${l.n} trận`));
  for (const l of leaders(roles, 2)) grants.push(grant('versatile', periodId, l.memberId, `${l.n} role`));
  return grants;
}

// ---------------------------------------------------------------------------
// Trao
// ---------------------------------------------------------------------------

/**
 * Trao tháng `periodId` đúng một lần: tính danh hiệu (đọc), rồi trong một giao dịch tạo
 * dòng `badge_months` (`announcePending` = có ít nhất một danh hiệu) và ghi
 * `member_badges` với `awardedAt = now`. Trả về true khi chính lời gọi này tạo dòng
 * `badge_months`; false khi tháng đã có dòng (một tiến trình khác hay lượt trước đã trao
 * — không ghi gì thêm). Không kiểm tra giờ chốt hay dòng `seasons` — `runMonthlyBadges` lo.
 */
export async function awardMonth(ctx: Ctx, periodId: string): Promise<boolean> {
  const grants = await computeMonthlyBadges(ctx, periodId);
  const now = ctx.now();
  try {
    await ctx.db.$transaction(async (tx) => {
      // Tạo trước: trùng khoá → huỷ cả giao dịch, không có dòng member_badges nào được ghi.
      await tx.badgeMonth.create({ data: { periodId, awardedAt: now, announcePending: grants.length > 0 } });
      if (grants.length > 0) {
        await tx.memberBadge.createMany({ data: grants.map((g) => ({ ...g, awardedAt: now })), skipDuplicates: true });
      }
    }, HOT_TX);
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Tin tổng kết
// ---------------------------------------------------------------------------

/**
 * Văn bản tổng kết tháng (§8), chia thành các phần ≤ 2000 ký tự cắt ở ranh giới dòng:
 * `🏅 Danh hiệu tháng MM/YYYY`, một dòng `{icon} {tên danh hiệu}: {tên người}, … ({detail})`
 * cho mỗi danh hiệu có người (thứ tự danh mục; trong một danh hiệu giữ thứ tự `grants`;
 * người cùng danh hiệu luôn cùng `detail` vì bằng nhau mới cùng nhận), rồi
 * `Xem tất cả: {publicUrl}/huy-hieu`. Tên người được escape Markdown. Không có danh hiệu
 * nào → không có phần nào (không đăng gì).
 */
export function buildMonthSummary(periodId: string, grants: (BadgeGrant & { displayName: string })[], publicUrl: string): string[] {
  if (grants.length === 0) return [];
  const lines = [`🏅 Danh hiệu tháng ${formatSeasonLabel(periodId)}`];
  for (const key of MONTHLY_KEYS) {
    const own = grants.filter((g) => g.badgeKey === key);
    const first = own[0];
    if (!first) continue;
    const names = own.map((g) => escapeDiscordMarkdown(g.displayName)).join(', ');
    lines.push(`${first.icon} ${badgeDef(key).name}: ${names} (${first.detail})`);
  }
  lines.push(`Xem tất cả: ${publicUrl}/huy-hieu`);
  return chunkLines(lines);
}

/** Danh hiệu tháng đã ghi của `periodId` kèm tên hiện tại của người nhận, theo thứ tự ghi. */
async function loadGrants(ctx: Ctx, periodId: string): Promise<(BadgeGrant & { displayName: string })[]> {
  const rows = await ctx.db.memberBadge.findMany({
    where: { periodId },
    select: { memberId: true, badgeKey: true, title: true, icon: true, detail: true, member: { select: { displayName: true } } },
    orderBy: { id: 'asc' },
  });
  return rows.flatMap((r) => {
    // Khoá lạ (không có trong danh mục tháng) không thể có — bỏ qua thay vì làm hỏng cả tin.
    if (!MONTHLY_KEY_SET.has(r.badgeKey)) return [];
    const badgeKey = r.badgeKey as MonthlyBadgeKey;
    return [{ memberId: r.memberId, badgeKey, periodId, title: r.title, icon: r.icon, detail: r.detail, displayName: r.member.displayName }];
  });
}

/**
 * Đăng tin tổng kết nếu tháng còn nợ (`announcePending`), dựng lại từ `member_badges`.
 * Đăng từng phần theo thứ tự; tất cả thành công mới tắt cờ. Discord lỗi giữa chừng → ghi
 * log, giữ cờ để lượt sau đăng lại. Lỗi DB ném ra.
 */
export async function deliverMonthSummary(ctx: Ctx, periodId: string): Promise<void> {
  const month = await ctx.db.badgeMonth.findUnique({ where: { periodId }, select: { announcePending: true } });
  if (!month?.announcePending) return;

  const chunks = buildMonthSummary(periodId, await loadGrants(ctx, periodId), ctx.config.publicUrl);
  try {
    for (const chunk of chunks) await ctx.notifier.announce(chunk);
  } catch (err) {
    console.error(`[badges] Không đăng được tổng kết danh hiệu tháng ${periodId} (sẽ đăng bù): ${messageOf(err)}`);
    return;
  }
  await ctx.db.badgeMonth.updateMany({ where: { periodId }, data: { announcePending: false } });
}

// ---------------------------------------------------------------------------
// Việc định kỳ
// ---------------------------------------------------------------------------

/**
 * Tháng VN của dữ liệu cũ nhất: buổi sớm nhất (`starts_at`) hay lần khai sớm nhất
 * (`played_on`, mọi trạng thái). Chưa có gì → null.
 */
async function earliestDataMonth(ctx: Ctx): Promise<string | null> {
  const [session, report] = await Promise.all([
    ctx.db.gameSession.aggregate({ _min: { startsAt: true } }),
    ctx.db.statReport.aggregate({ _min: { playedOn: true } }),
  ]);
  const months: string[] = [];
  if (session._min.startsAt) months.push(seasonIdOf(toVnDate(session._min.startsAt)));
  if (report._min.playedOn) months.push(seasonIdOf(dbToDateOnly(report._min.playedOn)));
  // Mã `YYYY-MM` so chuỗi đúng bằng so thời gian.
  return months.length === 0 ? null : months.sort()[0]!;
}

/** Các tháng từ `from` tới `to` (bao gồm cả hai), cũ nhất trước; `from > to` → rỗng. */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let m = to; m >= from; m = previousSeasonId(m)) months.push(m);
  return months.reverse();
}

/**
 * Tháng M đủ điều kiện trao: đã tới giờ chốt mùa và dòng `seasons` của M (nếu có) đã chốt.
 */
async function isMonthDue(ctx: Ctx, periodId: string, now: Date): Promise<boolean> {
  if (now.getTime() < seasonCloseAt(periodId).getTime()) return false;
  const season = await ctx.db.season.findUnique({ where: { id: periodId }, select: { closedAt: true } });
  return season === null || season.closedAt !== null;
}

/**
 * Việc `badges` phần tháng: với mọi tháng từ tháng của dữ liệu cũ nhất tới tháng trước
 * tháng hiện tại (giờ VN) chưa có dòng `badge_months`, cũ nhất trước — đủ điều kiện thì
 * trao; chưa thì để lượt sau. Rồi đăng bù tổng kết của mọi tháng còn `announcePending`.
 * Mỗi tháng độc lập: một tháng lỗi được ghi log, tháng khác vẫn chạy.
 */
export async function runMonthlyBadges(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  const earliest = await earliestDataMonth(ctx);
  if (earliest !== null) {
    const lastDue = previousSeasonId(seasonIdOf(toVnDate(now)));
    const awarded = new Set((await ctx.db.badgeMonth.findMany({ select: { periodId: true } })).map((m) => m.periodId));
    for (const periodId of monthsBetween(earliest, lastDue)) {
      if (awarded.has(periodId)) continue;
      try {
        if (await isMonthDue(ctx, periodId, now)) await awardMonth(ctx, periodId);
      } catch (err) {
        console.error(`[badges] Không trao được danh hiệu tháng ${periodId}: ${messageOf(err)}`);
      }
    }
  }

  const pending = await ctx.db.badgeMonth.findMany({ where: { announcePending: true }, select: { periodId: true }, orderBy: { periodId: 'asc' } });
  for (const { periodId } of pending) {
    try {
      await deliverMonthSummary(ctx, periodId);
    } catch (err) {
      console.error(`[badges] Không đăng bù được tổng kết danh hiệu tháng ${periodId}: ${messageOf(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
