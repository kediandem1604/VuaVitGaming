/**
 * SMVP tháng (quyết định của chủ 2026-11-03, thay định nghĩa cũ "thắng nhiều hạng mục vote Khen
 * nhất"): SMVP của tháng M = người hạng 1 bảng "Cả 3 phe" của mùa M — đúng
 * `getFactionTotals(...).boards.all.top[0]`, cùng cách xếp và phân hoà; phải có điểm > 0, không ai
 * thì tháng đó không có SMVP.
 *
 * Trao lúc 00:05 giờ VN ngày 1 tháng M+1 (không đợi chốt mùa ngày 4) và đóng băng: điểm duyệt
 * muộn sau đó không đổi người nhận hay chữ "{points} điểm cả 3 phe". Trao bù: mỗi lượt bộ hẹn giờ
 * xét mọi tháng từ `SMVP_FROM` tới tháng trước tháng hiện tại — đã qua giờ trao và chưa có dòng
 * `smvp_months` thì trao ngay. Không bao giờ trao cho tháng trước `SMVP_FROM` (các tháng đó đã
 * trao SMVP theo luật cũ cùng đợt danh hiệu tháng).
 *
 * Chống trao trùng: trong MỘT giao dịch tạo dòng `smvp_months` (khoá chính `period_id` — trùng →
 * tiến trình khác đã trao, không ghi gì) rồi dòng `member_badges`. Lời chúc ở #thông-báo đăng sau
 * khi giao dịch đã lưu; Discord lỗi → giữ `announce_pending`, lượt sau đăng bù (như tổng kết tháng).
 */

import { Prisma } from '@prisma/client';
import { badgeDef, monthlyBadgeTitle } from '../../../shared/badges.js';
import type { Ctx } from '../../ctx.js';
import { escapeDiscordMarkdown } from '../../lib/discord-text.js';
import { formatSeasonLabel, previousSeasonId, seasonIdOf, smvpAwardAt, toVnDate } from '../../lib/time.js';
import { HOT_TX } from '../../lib/tx.js';
import { getFactionTotals } from '../stats/leaderboard.js';

/** Tháng đầu tiên trao SMVP theo luật mới; các tháng trước không bao giờ được xét. */
export const SMVP_FROM = '2026-10';

/** Người viewer giả khi đọc bảng tổng: id 0 không bao giờ là thành viên thật nên `me` luôn null. */
const NO_VIEWER = 0;

/** Hạng 1 bảng "Cả 3 phe" của tháng `periodId` (điểm > 0), hoặc null. Chỉ đọc. */
export async function computeSmvp(ctx: Ctx, periodId: string): Promise<{ memberId: number; points: number } | null> {
  const first = (await getFactionTotals(ctx, periodId, NO_VIEWER)).boards.all.top[0];
  // `getFactionTotals` chỉ xếp người có tổng > 0; kiểm thêm cho chắc.
  return first && first.points > 0 ? { memberId: first.memberId, points: first.points } : null;
}

/**
 * Trao SMVP tháng `periodId` đúng một lần với `awardedAt = now`. Trả về true khi chính lời gọi
 * này tạo dòng `smvp_months` (kể cả tháng không ai đạt — dòng có `member_id` null); false khi
 * tháng đã có dòng. Không kiểm tra giờ trao — `runSmvpBadges` lo.
 */
export async function awardSmvp(ctx: Ctx, periodId: string): Promise<boolean> {
  const winner = await computeSmvp(ctx, periodId);
  const now = ctx.now();
  try {
    await ctx.db.$transaction(async (tx) => {
      // Tạo trước: trùng khoá → huỷ cả giao dịch, không ghi member_badges.
      await tx.smvpMonth.create({
        data: { periodId, memberId: winner?.memberId ?? null, points: winner?.points ?? null, awardedAt: now, announcePending: winner !== null },
      });
      if (winner) {
        const def = badgeDef('smvp');
        await tx.memberBadge.createMany({
          data: [
            {
              memberId: winner.memberId,
              badgeKey: 'smvp',
              periodId,
              title: monthlyBadgeTitle(def.name, periodId),
              icon: def.icon,
              detail: `${winner.points} điểm cả 3 phe`,
              awardedAt: now,
            },
          ],
          skipDuplicates: true,
        });
      }
    }, HOT_TX);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
    throw err;
  }
  return true;
}

/** Lời chúc ở #thông-báo; tên được escape Markdown (thông báo đã tắt mọi mention). */
export function buildSmvpAnnouncement(periodId: string, displayName: string, points: number): string {
  return `🏆 Chúc mừng **${escapeDiscordMarkdown(displayName)}** đạt danh hiệu **SMVP tháng ${formatSeasonLabel(periodId)}** với ${points} điểm!`;
}

/**
 * Đăng lời chúc nếu tháng còn nợ (`announce_pending`), tên lấy theo dòng `members` hiện tại.
 * Thành công mới tắt cờ; Discord lỗi → ghi log, giữ cờ cho lượt sau. Lỗi DB ném ra.
 */
export async function deliverSmvpAnnouncement(ctx: Ctx, periodId: string): Promise<void> {
  const row = await ctx.db.smvpMonth.findUnique({
    where: { periodId },
    select: { announcePending: true, points: true, member: { select: { displayName: true } } },
  });
  if (!row?.announcePending) return;
  if (!row.member || row.points === null) {
    // Không thể có (cờ chỉ bật khi có người nhận) — xoá nợ thay vì kẹt mãi.
    await ctx.db.smvpMonth.updateMany({ where: { periodId }, data: { announcePending: false } });
    return;
  }
  try {
    await ctx.notifier.announce(buildSmvpAnnouncement(periodId, row.member.displayName, row.points));
  } catch (err) {
    console.error(`[badges] Không đăng được lời chúc SMVP tháng ${periodId} (sẽ đăng bù): ${messageOf(err)}`);
    return;
  }
  await ctx.db.smvpMonth.updateMany({ where: { periodId }, data: { announcePending: false } });
}

/**
 * Việc `badges` phần SMVP: trao mọi tháng từ `SMVP_FROM` tới tháng trước (giờ VN) đã qua giờ trao
 * mà chưa có dòng `smvp_months`, cũ nhất trước; rồi đăng bù mọi lời chúc còn nợ. Mỗi tháng độc
 * lập: một tháng lỗi ghi log, tháng khác vẫn chạy.
 */
export async function runSmvpBadges(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  const lastMonth = previousSeasonId(seasonIdOf(toVnDate(now)));
  const done = new Set((await ctx.db.smvpMonth.findMany({ select: { periodId: true } })).map((m) => m.periodId));
  const months: string[] = [];
  // Mã `YYYY-MM` so chuỗi đúng bằng so thời gian.
  for (let m = lastMonth; m >= SMVP_FROM; m = previousSeasonId(m)) months.push(m);
  for (const periodId of months.reverse()) {
    if (done.has(periodId) || now.getTime() < smvpAwardAt(periodId).getTime()) continue;
    try {
      await awardSmvp(ctx, periodId);
    } catch (err) {
      console.error(`[badges] Không trao được SMVP tháng ${periodId}: ${messageOf(err)}`);
    }
  }

  const pending = await ctx.db.smvpMonth.findMany({ where: { announcePending: true }, select: { periodId: true }, orderBy: { periodId: 'asc' } });
  for (const { periodId } of pending) {
    try {
      await deliverSmvpAnnouncement(ctx, periodId);
    } catch (err) {
      console.error(`[badges] Không đăng bù được lời chúc SMVP tháng ${periodId}: ${messageOf(err)}`);
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
