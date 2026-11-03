/**
 * Khoảng tổng số buổi admin đặt được cho một thành viên (`PUT /api/admin/members/:id/games`)
 * và câu báo lỗi khi ra ngoài khoảng — server (route + service) và web (kiểm tra tại chỗ) dùng
 * chung để không bao giờ lệch nhau. Không import gì từ server hay Prisma.
 */

export const GAMES_MIN = 0;
export const GAMES_MAX = 10_000;
export const GAMES_INVALID_MESSAGE = `Số buổi phải là số nguyên từ ${GAMES_MIN} đến ${GAMES_MAX}`;

/** Số nguyên trong khoảng `GAMES_MIN..GAMES_MAX`. */
export function isValidGamesTotal(n: number): boolean {
  return Number.isInteger(n) && n >= GAMES_MIN && n <= GAMES_MAX;
}
