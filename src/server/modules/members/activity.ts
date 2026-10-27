/**
 * Hoạt động của thành viên: số ngày trong server và số buổi đã đi — dùng chung cho danh
 * sách quản trị, trang thành viên công khai và cột mốc huy hiệu, để mọi nơi hiện cùng một số.
 *
 * - Ngày vào server hiệu lực = `guildJoinedAt` (theo Discord) nếu có, không thì `joinedAt`
 *   (lúc app thấy người đó lần đầu). Số ngày = số ngày lịch VN từ đó tới `leftAt` (người đã
 *   rời) hoặc bây giờ, nhỏ nhất 0.
 * - Số buổi = số điểm danh `going` ở buổi `ended` (tự đếm) + `gamesAdjustment` (admin chỉnh,
 *   có thể âm), nhỏ nhất 0. Đếm gộp một truy vấn cho nhiều người, không lặp từng người.
 */

import type { Member } from '@prisma/client';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { vnDaysBetween } from '../../lib/time.js';

/** Số buổi do admin đặt phải nằm trong khoảng này (body `PUT /api/admin/members/:id/games`). */
export const GAMES_MIN = 0;
export const GAMES_MAX = 10_000;
export const GAMES_INVALID_MESSAGE = 'Số buổi phải là số nguyên từ 0 đến 10000';

type ActivityMember = Pick<Member, 'joinedAt' | 'guildJoinedAt' | 'status' | 'leftAt'>;

/** Ngày vào server hiệu lực: theo Discord khi biết, không thì lúc app thấy lần đầu. */
export function serverJoinedAt(m: Pick<Member, 'joinedAt' | 'guildJoinedAt'>): Date {
  return m.guildJoinedAt ?? m.joinedAt;
}

/** Số ngày lịch VN trong server: tới `leftAt` với người đã rời, tới `now` với người còn lại; nhỏ nhất 0. */
export function daysInServer(m: ActivityMember, now: Date): number {
  const until = m.status === 'left' && m.leftAt !== null ? m.leftAt : now;
  return vnDaysBetween(serverJoinedAt(m), until);
}

/** Tổng số buổi hiển thị: tự đếm cộng phần chỉnh, không dưới 0. */
export function gamesTotal(attended: number, adjustment: number): number {
  return Math.max(0, attended + adjustment);
}

/**
 * Số buổi tự đếm (điểm danh `going` ở buổi `ended`) theo id thành viên, một truy vấn gộp.
 * `memberIds` bỏ trống → mọi người. Người chưa đi buổi nào vắng trong Map (hiểu là 0).
 */
export async function attendedGamesCounts(ctx: Ctx, memberIds?: number[]): Promise<Map<number, number>> {
  if (memberIds !== undefined && memberIds.length === 0) return new Map();
  const rows = await ctx.db.attendance.groupBy({
    by: ['memberId'],
    where: {
      status: 'going',
      session: { status: 'ended' },
      ...(memberIds !== undefined ? { memberId: { in: memberIds } } : {}),
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.memberId, r._count._all]));
}

/**
 * Tổng số buổi sau chỉnh của mọi thành viên có ít nhất một buổi tự đếm hoặc phần chỉnh khác 0
 * (người không có gì vắng trong Map) — nguồn cho cột mốc "số trận" của huy hiệu: người chỉ
 * được admin chỉnh mà chưa điểm danh lần nào vẫn được tính.
 */
export async function gamesTotals(ctx: Ctx): Promise<Map<number, number>> {
  const [attended, adjusted] = await Promise.all([
    attendedGamesCounts(ctx),
    ctx.db.member.findMany({ where: { gamesAdjustment: { not: 0 } }, select: { id: true, gamesAdjustment: true } }),
  ]);
  const totals = new Map<number, number>();
  const adjustments = new Map(adjusted.map((m) => [m.id, m.gamesAdjustment]));
  for (const id of new Set([...attended.keys(), ...adjustments.keys()])) {
    totals.set(id, gamesTotal(attended.get(id) ?? 0, adjustments.get(id) ?? 0));
  }
  return totals;
}

/**
 * Admin đặt tổng số buổi của một thành viên: lưu `gamesAdjustment = games − số tự đếm hiện
 * tại`, nên buổi kết thúc sau đó vẫn cộng tiếp lên tổng vừa đặt. `games` phải là số nguyên
 * 0..10000 → `VALIDATION`; không có thành viên → `NOT_FOUND`. Trả về thành viên sau khi ghi
 * kèm số tự đếm (để dựng DTO không cần đếm lại) và tổng trước khi chỉnh (để ghi log).
 */
export async function setGamesTotal(
  ctx: Ctx,
  memberId: number,
  games: number,
): Promise<{ member: Member; attended: number; previousGames: number }> {
  if (!Number.isInteger(games) || games < GAMES_MIN || games > GAMES_MAX) throw appError('VALIDATION', GAMES_INVALID_MESSAGE);
  const existing = await ctx.db.member.findUnique({ where: { id: memberId } });
  if (!existing) throw appError('NOT_FOUND');
  const attended = (await attendedGamesCounts(ctx, [memberId])).get(memberId) ?? 0;
  const member = await ctx.db.member.update({ where: { id: memberId }, data: { gamesAdjustment: games - attended } });
  return { member, attended, previousGames: gamesTotal(attended, existing.gamesAdjustment) };
}
