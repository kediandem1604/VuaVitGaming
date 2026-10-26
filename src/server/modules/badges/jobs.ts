/**
 * Việc `badges` của bộ hẹn giờ (spec huy hiệu §6): chạy sau việc `season` trong
 * `defaultJobs()` để tháng vừa chốt được trao danh hiệu ngay trong cùng lượt. Hiện gồm
 * danh hiệu tháng (`runMonthlyBadges`); cột mốc trọn đời (§6.2) sẽ được thêm vào đây.
 */

import type { Ctx } from '../../ctx.js';
import { runMonthlyBadges } from './monthly.js';

/** Một lượt của việc `badges`: trao danh hiệu tháng đến hạn và đăng bù tổng kết còn nợ. */
export async function runBadgeJobs(ctx: Ctx): Promise<void> {
  await runMonthlyBadges(ctx);
}
