/**
 * Việc `badges` của bộ hẹn giờ (spec huy hiệu §6): chạy sau việc `season` trong
 * `defaultJobs()` để tháng vừa chốt được trao danh hiệu ngay trong cùng lượt. Gồm ba phần
 * nối tiếp: danh hiệu tháng (`runMonthlyBadges`, §6.1), SMVP (`runSmvpBadges` — trao riêng
 * 00:05 ngày 1 tháng sau, quyết định 2026-11-03) rồi cột mốc trọn đời (`runMilestoneBadges`, §6.2). Mỗi phần độc lập: phần trước ném lỗi (vd DB) thì ghi log và
 * phần sau vẫn chạy; không bao giờ ném ra ngoài.
 */

import type { Ctx } from '../../ctx.js';
import { runMilestoneBadges } from './milestones.js';
import { runMonthlyBadges } from './monthly.js';
import { runSmvpBadges } from './smvp.js';

/** Một lượt của việc `badges`: trao danh hiệu tháng đến hạn và đăng bù tổng kết còn nợ, trao SMVP đến hạn và đăng bù lời chúc, rồi trao cột mốc mới. */
export async function runBadgeJobs(ctx: Ctx): Promise<void> {
  try {
    await runMonthlyBadges(ctx);
  } catch (err) {
    console.error(`[badges] Phần danh hiệu tháng lỗi: ${messageOf(err)}`);
  }
  try {
    await runSmvpBadges(ctx);
  } catch (err) {
    console.error(`[badges] Phần SMVP lỗi: ${messageOf(err)}`);
  }
  try {
    await runMilestoneBadges(ctx);
  } catch (err) {
    console.error(`[badges] Phần cột mốc lỗi: ${messageOf(err)}`);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
