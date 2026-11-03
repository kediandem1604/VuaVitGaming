/**
 * Tính điểm theo ván (spec 2026-11-01 game rounds §2, §3) — phần dùng chung server và web. Không
 * import gì từ server hay Prisma.
 */

import type { Faction } from './api-types.js';
import type { MetricRole, ReportValues } from './metric.js';

/** Mùa có mã ≥ giá trị này (`YYYY-MM`, so chuỗi đúng bằng so thời gian) dùng luật khai và tính điểm theo ván. */
export const ROUND_SCORING_FROM = '2026-11';

/** Mùa `seasonId` (`YYYY-MM`) dùng luật ván hay không. */
export function isRoundSeason(seasonId: string): boolean {
  return seasonId >= ROUND_SCORING_FROM;
}

/**
 * Lần khai của một ván có thắng không (spec ván §3): role thuộc phe thắng của ván, và khi Phe thứ 3
 * thắng thì người khai phải được tick là người thắng. Ván chưa chọn phe thắng → `false`.
 */
export function roundWon(roleFaction: Faction, winnerFaction: Faction | null, isNeutralWinner: boolean): boolean {
  if (winnerFaction === null || roleFaction !== winnerFaction) return false;
  return winnerFaction !== 'neutral' || isNeutralWinner;
}

/**
 * Điểm một lần khai theo ván = `won ? (1 + (value × points + extraValue × extraPoints) × m) : 0`
 * `− penaltyValue × penaltyPoints + bonusPoints` (spec ván §3; `m` = hệ số ngày nhân của ngày chơi).
 * Thua vẫn bị trừ điểm phạt; +1 thắng không nhân hệ số. Có thể âm.
 */
export function roundReportPoints(r: ReportValues, role: MetricRole, multiplier: number, won: boolean): number {
  const plus = won ? 1 + (r.value * role.points + r.extraValue * (role.extraPoints ?? 0)) * multiplier : 0;
  return plus - r.penaltyValue * (role.penaltyPoints ?? 0) + r.bonusPoints;
}

/** Lỗi khai theo ván (spec ván §5) — câu đúng nguyên văn spec, web và Discord cùng hiện. */
export const ROUND_REPORT_DUPLICATE_MESSAGE = 'Bạn đã khai ván này rồi';
export const ROUND_REPORT_CLOSED_MESSAGE = 'Ván này không còn nhận khai';
/** `POST /api/reports` (khai theo ngày) cho ngày thuộc mùa ≥ `ROUND_SCORING_FROM`. */
export const DAY_REPORTS_REPLACED_MESSAGE = 'Từ tháng 11 khai điểm theo ván — chọn buổi và ván để khai';

/** URL ảnh của ván — `?v=` đổi theo mỗi lần thay ảnh (RoundDto và ReportDto.round dùng chung). */
export function roundImageUrl(id: number, imageUpdatedAt: Date): string {
  return `/api/rounds/${id}/image?v=${imageUpdatedAt.getTime()}`;
}

/** URL ảnh nhỏ của ván (lưới, danh sách) — server trả ảnh gốc khi ván chưa có ảnh nhỏ. */
export function roundThumbUrl(id: number, imageUpdatedAt: Date): string {
  return `/api/rounds/${id}/image?size=thumb&v=${imageUpdatedAt.getTime()}`;
}
