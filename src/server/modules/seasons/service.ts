/**
 * Mùa giải (spec §4.7): một tháng dương lịch theo giờ Việt Nam, mã `YYYY-MM`.
 *
 * Phần này chỉ có hai việc nền mà khai điểm cần: tạo dòng `seasons` khi lần đầu có
 * lần khai thuộc mùa đó, và hỏi mùa đã chốt chưa. Chốt mùa, nhắc mod và bảng tổng kết
 * nằm ở Task 17.
 */

import { Prisma } from '@prisma/client';
import type { Ctx } from '../../ctx.js';
import { seasonDateRange, vnDayRange } from '../../lib/time.js';

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

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
