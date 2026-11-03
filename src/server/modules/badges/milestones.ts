/**
 * Cột mốc trọn đời (spec huy hiệu §3.2, §4, §6.2, §8): chín danh hiệu trao NGAY khi đạt.
 * Mỗi lượt của việc `badges` tính lại số liệu trọn đời của mọi thành viên bằng bốn truy vấn
 * gộp (không lặp theo từng người), rồi ghi những cột mốc đã đạt mà chưa có vào `member_badges`
 * với `periodId = ''`, `awardedAt = now`. Dòng đã ghi không bao giờ đổi: số liệu sau đó giảm
 * (vd admin đổi nhóm hạng mục) cũng không thu hồi danh hiệu.
 *
 * Lượt đầu — chưa có `app_settings` khoá `badges.milestones_backfilled` — trao bù mọi cột mốc
 * của dữ liệu có sẵn mà KHÔNG đăng Discord, rồi ghi khoá (giờ ISO của lượt đó). Từ lượt sau,
 * chỉ những dòng lời gọi này thực sự tạo mới được đăng thành một tin (§8); lỗi Discord chỉ ghi
 * log, không có cờ nợ và không đăng bù (khác tổng kết tháng — cột mốc lẻ không đáng đăng trễ).
 *
 * Số liệu (§4): một trận đã đi = điểm danh `going` ở buổi `ended`, cộng phần admin chỉnh
 * (`members.games_adjustment`, xem `modules/members/activity.ts`); một lần thắng MVP = một
 * dòng `awards` ở hạng mục nhóm `mvp` (đọc nhóm HIỆN TẠI); hoá thân = dòng `role_titles`
 * (một role ở một mùa đã chốt), đếm role khác nhau; Đạo diễn = lần khai `approved` có
 * `highlightMessageId`. Thành viên đã rời server vẫn được tính — danh hiệu không mất.
 */

import { BADGES, badgeDef } from '../../../shared/badges.js';
import type { MilestoneBadgeKey } from '../../../shared/badges.js';
import type { Ctx } from '../../ctx.js';
import { chunkLines } from '../../lib/chunk.js';
import { escapeDiscordMarkdown } from '../../lib/discord-text.js';
import { HOT_TX } from '../../lib/tx.js';
import { gamesTotals } from '../members/activity.js';
import type { BadgeGrant } from './monthly.js';

/** Khoá `app_settings` đánh dấu đã trao bù cột mốc lần đầu; giá trị là giờ ISO của lượt đó. */
export const MILESTONES_BACKFILLED_KEY = 'badges.milestones_backfilled';

/** `periodId` của mọi cột mốc (danh hiệu tháng dùng `YYYY-MM`). */
const MILESTONE_PERIOD = '';

/** Thứ tự cột mốc trong danh mục — thứ tự ghi và thứ tự dòng trong tin Discord. */
const MILESTONE_KEYS: readonly MilestoneBadgeKey[] = BADGES.filter((b) => b.kind === 'milestone').map((b) => b.key as MilestoneBadgeKey);
const MILESTONE_ORDER: ReadonlyMap<string, number> = new Map(MILESTONE_KEYS.map((key, i) => [key, i]));

/** Một bậc cột mốc theo số đếm: đạt khi số ≥ `min`; `detail` là chữ đóng băng lúc trao. */
interface Step {
  min: number;
  key: MilestoneBadgeKey;
  detail: string;
}

const GAMES_STEPS: readonly Step[] = [
  { min: 10, key: 'games_10', detail: 'Đã đi 10 trận' },
  { min: 50, key: 'games_50', detail: 'Đã đi 50 trận' },
  { min: 100, key: 'games_100', detail: 'Đã đi 100 trận' },
];
const MVP_STEPS: readonly Step[] = [
  { min: 1, key: 'mvp_1', detail: 'Thắng MVP lần đầu' },
  { min: 10, key: 'mvp_10', detail: 'Thắng MVP 10 lần' },
  { min: 50, key: 'mvp_50', detail: 'Thắng MVP 50 lần' },
];
const INCARNATE_STEPS: readonly Step[] = [
  { min: 1, key: 'incarnate_1', detail: 'Hoá thân lần đầu' },
  { min: 5, key: 'incarnate_5', detail: 'Đã hoá thân 5 role' },
];
const DIRECTOR_DETAIL = 'Highlight đầu tiên được duyệt';

// ---------------------------------------------------------------------------
// Tính cột mốc
// ---------------------------------------------------------------------------

/** Dựng một cột mốc theo danh mục: tên `{name}` (không kèm tháng), icon hiện tại. */
function grant(key: MilestoneBadgeKey, memberId: number, detail: string): BadgeGrant {
  const def = badgeDef(key);
  return { memberId, badgeKey: key, periodId: MILESTONE_PERIOD, title: def.name, icon: def.icon, detail };
}

/** Mọi bậc mà số `n` đã đạt, mỗi người một dòng cho mỗi bậc. */
function reachedSteps(steps: readonly Step[], counts: Map<number, number>): BadgeGrant[] {
  const grants: BadgeGrant[] = [];
  for (const [memberId, n] of counts) {
    for (const step of steps) if (n >= step.min) grants.push(grant(step.key, memberId, step.detail));
  }
  return grants;
}

/**
 * Số trận đã đi trọn đời, mỗi người một số: điểm danh `going` ở buổi đã `ended` cộng phần
 * admin chỉnh (`gamesAdjustment`) — cùng tổng với tab Thành viên và trang thành viên công khai.
 * Chỉnh giảm không thu hồi cột mốc đã trao (dòng đã ghi không bao giờ đổi).
 */
function gamesPlayedCounts(ctx: Ctx): Promise<Map<number, number>> {
  return gamesTotals(ctx);
}

/** Số lần thắng vote trọn đời ở hạng mục nhóm Khen (đọc nhóm hiện tại), mỗi người một số. */
async function mvpWinCounts(ctx: Ctx): Promise<Map<number, number>> {
  const rows = await ctx.db.award.groupBy({
    by: ['memberId'],
    where: { category: { badgeGroup: 'mvp' } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.memberId, r._count._all]));
}

/** Số role khác nhau từng hoá thân (cặp `memberId, roleId` khác nhau trong `role_titles`), mỗi người một số. */
async function incarnatedRoleCounts(ctx: Ctx): Promise<Map<number, number>> {
  const pairs = await ctx.db.roleTitle.groupBy({ by: ['memberId', 'roleId'] });
  const counts = new Map<number, number>();
  for (const { memberId } of pairs) counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
  return counts;
}

/** Những người có ít nhất một lần khai đã duyệt kèm highlight. */
async function directorMemberIds(ctx: Ctx): Promise<number[]> {
  const rows = await ctx.db.statReport.groupBy({
    by: ['memberId'],
    where: { status: 'approved', highlightMessageId: { not: null } },
  });
  return rows.map((r) => r.memberId);
}

/**
 * Mọi cột mốc §3.2 mà từng thành viên đã đạt tính tới giờ (kể cả cột mốc đã ghi từ trước),
 * theo thứ tự danh mục rồi id thành viên. Chỉ đọc; không ghi gì.
 */
export async function computeMilestones(ctx: Ctx): Promise<BadgeGrant[]> {
  const [games, mvp, roles, directors] = await Promise.all([
    gamesPlayedCounts(ctx),
    mvpWinCounts(ctx),
    incarnatedRoleCounts(ctx),
    directorMemberIds(ctx),
  ]);
  const grants = [
    ...reachedSteps(GAMES_STEPS, games),
    ...reachedSteps(MVP_STEPS, mvp),
    ...reachedSteps(INCARNATE_STEPS, roles),
    ...directors.map((memberId) => grant('director', memberId, DIRECTOR_DETAIL)),
  ];
  return grants.sort((x, y) => (MILESTONE_ORDER.get(x.badgeKey) ?? 0) - (MILESTONE_ORDER.get(y.badgeKey) ?? 0) || x.memberId - y.memberId);
}

// ---------------------------------------------------------------------------
// Trao
// ---------------------------------------------------------------------------

/**
 * Ghi những cột mốc đã đạt mà chưa có vào `member_badges` (`awardedAt = now`) và trả về
 * đúng các dòng lời gọi này tạo mới (rỗng khi không có gì mới). Trong MỘT giao dịch: đọc các
 * cặp `(badgeKey, memberId)` đã có, lấy phần chưa có, rồi `createMany` (`skipDuplicates`).
 * Bộ hẹn giờ chỉ chạy ở một tiến trình (khoá thuê) nên không có hai lượt chen nhau; nếu có,
 * khoá duy nhất vẫn chặn dòng trùng — cùng lắm một cột mốc được đăng hai lần.
 */
export async function awardMilestones(ctx: Ctx): Promise<BadgeGrant[]> {
  const grants = await computeMilestones(ctx);
  if (grants.length === 0) return [];
  const now = ctx.now();
  return ctx.db.$transaction(async (tx) => {
    const existing = await tx.memberBadge.findMany({
      where: { periodId: MILESTONE_PERIOD, badgeKey: { in: [...MILESTONE_KEYS] } },
      select: { badgeKey: true, memberId: true },
    });
    const have = new Set(existing.map((r) => `${r.badgeKey}:${r.memberId}`));
    const fresh = grants.filter((g) => !have.has(`${g.badgeKey}:${g.memberId}`));
    if (fresh.length > 0) {
      await tx.memberBadge.createMany({ data: fresh.map((g) => ({ ...g, awardedAt: now })), skipDuplicates: true });
    }
    return fresh;
  }, HOT_TX);
}

// ---------------------------------------------------------------------------
// Tin Discord
// ---------------------------------------------------------------------------

/**
 * Tin cột mốc mới (§8), một tin cho cả lượt chia thành các phần ≤ 2000 ký tự cắt ở ranh
 * giới dòng: mỗi dòng `🎖️ **Tên** vừa đạt danh hiệu {icon} {title}!`, theo thứ tự `grants`.
 * Tên người được escape Markdown. Không có cột mốc nào → không có phần nào.
 */
export function buildMilestoneAnnouncement(grants: (BadgeGrant & { displayName: string })[]): string[] {
  return chunkLines(grants.map((g) => `🎖️ **${escapeDiscordMarkdown(g.displayName)}** vừa đạt danh hiệu ${g.icon} ${g.title}!`));
}

/** Đăng tin cột mốc mới; Discord lỗi → ghi log, không thử lại (dòng đã ghi vẫn còn). Lỗi DB ném ra. */
async function announceMilestones(ctx: Ctx, fresh: BadgeGrant[]): Promise<void> {
  const members = await ctx.db.member.findMany({
    where: { id: { in: [...new Set(fresh.map((g) => g.memberId))] } },
    select: { id: true, displayName: true },
  });
  const names = new Map(members.map((m) => [m.id, m.displayName]));
  // Khoá ngoại bảo đảm người nhận luôn có; dự phòng để một dòng lạ không làm hỏng cả tin.
  const chunks = buildMilestoneAnnouncement(fresh.map((g) => ({ ...g, displayName: names.get(g.memberId) ?? `Thành viên #${g.memberId}` })));
  try {
    for (const chunk of chunks) await ctx.notifier.announce(chunk);
  } catch (err) {
    console.error(`[badges] Không đăng được tin ${fresh.length} cột mốc mới (không đăng bù): ${messageOf(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Việc định kỳ
// ---------------------------------------------------------------------------

/**
 * Việc `badges` phần cột mốc, mỗi lượt: trao mọi cột mốc đã đạt mà chưa có. Chưa có khoá
 * `badges.milestones_backfilled` → đây là lượt trao bù: không đăng gì, ghi khoá (giữ giá trị
 * cũ nếu một tiến trình khác vừa ghi). Đã có khoá → đăng những dòng vừa tạo (nếu có).
 * Trao lỗi → ném ra, khoá chưa ghi nên lượt sau vẫn là lượt trao bù im lặng.
 */
export async function runMilestoneBadges(ctx: Ctx): Promise<void> {
  const backfilled = await ctx.db.appSetting.findUnique({ where: { key: MILESTONES_BACKFILLED_KEY }, select: { key: true } });
  const fresh = await awardMilestones(ctx);
  if (backfilled === null) {
    const value = ctx.now().toISOString();
    await ctx.db.appSetting.upsert({
      where: { key: MILESTONES_BACKFILLED_KEY },
      create: { key: MILESTONES_BACKFILLED_KEY, value },
      update: {},
    });
    return;
  }
  if (fresh.length > 0) await announceMilestones(ctx, fresh);
}

// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
