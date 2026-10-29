/**
 * Việc `multiplier-days` của bộ hẹn giờ (spec ngày nhân điểm §6), chạy dưới khoá thuê như mọi việc khác:
 * 1. Đăng bù tin tạo của các ngày `announcedAt IS NULL` và `day ≥ hôm nay VN` (lần đăng lúc tạo bị lỗi).
 * 2. Từ 9:00 VN: nhắc "🔥 Hôm nay điểm cộng ×{m}!" cho ngày hôm nay chưa nhắc (`remindedAt IS NULL`).
 * Cả hai giành cờ trước khi gửi (`service.ts`) nên chạy lại nhiều lần trong 9:00–9:59, hay hai tiến
 * trình cùng chạy, vẫn chỉ đăng một lần. Ngày khác hôm nay không bao giờ được nhắc. Mỗi phần độc lập:
 * phần trước lỗi thì ghi log, phần sau vẫn chạy; không bao giờ ném ra ngoài.
 */

import type { Ctx } from '../../ctx.js';
import { dateOnlyToDb, toVnDate, vnDateTimeToUtc } from '../../lib/time.js';
import { REMINDER_TIME, announceCreated, remindToday } from './service.js';

/** Một lượt: đăng bù tin tạo còn nợ, rồi nhắc 9:00 của hôm nay. */
export async function runMultiplierJobs(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  const today = toVnDate(now);
  try {
    const unannounced = await ctx.db.scoreMultiplierDay.findMany({
      where: { announcedAt: null, day: { gte: dateOnlyToDb(today) } },
      select: { id: true },
      orderBy: { day: 'asc' },
    });
    for (const { id } of unannounced) await announceCreated(ctx, id);
  } catch (err) {
    console.error(`[multipliers] Phần đăng bù lỗi: ${messageOf(err)}`);
  }
  try {
    if (now.getTime() < vnDateTimeToUtc(today, REMINDER_TIME).getTime()) return;
    const due = await ctx.db.scoreMultiplierDay.findMany({
      where: { day: dateOnlyToDb(today), remindedAt: null },
      select: { id: true },
    });
    for (const { id } of due) await remindToday(ctx, id);
  } catch (err) {
    console.error(`[multipliers] Phần nhắc 9:00 lỗi: ${messageOf(err)}`);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
