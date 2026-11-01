/**
 * Việc `offline-events` của bộ hẹn giờ (spec offline): đăng bù tin tạo của các sự kiện chưa đăng
 * (`announcedAt IS NULL` — lần đăng lúc tạo bị lỗi) và chưa diễn ra. `announceOfflineEvent` giành cờ
 * trước khi gửi nên chạy lại hay hai tiến trình cùng chạy vẫn chỉ đăng một lần. Không bao giờ ném ra ngoài.
 */

import type { Ctx } from '../../ctx.js';
import { announceOfflineEvent } from './service.js';

export async function runOfflineJobs(ctx: Ctx): Promise<void> {
  try {
    const due = await ctx.db.offlineEvent.findMany({
      where: { announcedAt: null, startsAt: { gt: ctx.now() } },
      select: { id: true },
      orderBy: { startsAt: 'asc' },
    });
    for (const { id } of due) await announceOfflineEvent(ctx, id);
  } catch (err) {
    console.error(`[offline] Phần đăng bù lỗi: ${err instanceof Error ? err.message : String(err)}`);
  }
}
