/**
 * Tuỳ chọn truy vấn (khoá + hàm tải) của vài danh sách nhỏ mà nhiều nơi cùng dùng — trang hiển
 * thị và bộ tải trước (`routes.tsx`, spec §4.3) phải gọi đúng cùng một URL dưới cùng một khoá,
 * nên khai báo một chỗ. Khoá chỉ-để-làm-mới nằm ở `queryKeys.ts`; ở đây là khoá đi kèm cách tải.
 */

import { queryOptions } from '@tanstack/react-query';
import type { HeldRoleDto, MultiplierDayDto, RoleDto, SeasonDto, SessionBountiesDto } from '../../shared/api-types';
import { apiGet } from '../api';
import { MULTIPLIER_UPCOMING_KEY, SESSION_BOUNTIES_KEY } from './queryKeys';

/** Danh sách mùa (mới nhất trước; mùa hiện tại luôn có) — Đại sảnh, Bảng xếp hạng. */
export const seasonsQuery = queryOptions({ queryKey: ['seasons'] as const, queryFn: () => apiGet<SeasonDto[]>('/api/seasons') });

/** Role đang bật — Bảng xếp hạng, Khai điểm. Tab Role quản trị làm mới theo tiền tố `['roles']`. */
export const rolesQuery = queryOptions({ queryKey: ['roles'] as const, queryFn: () => apiGet<RoleDto[]>('/api/roles') });

/** 30 ngày gần nhất có kết quả tri ân — trang Tri ân và mục "Sảnh tri ân gần nhất" ở Hôm nay. */
export const mvpDatesQuery = queryOptions({ queryKey: ['mvp', 'dates'] as const, queryFn: () => apiGet<string[]>('/api/mvp/dates') });

/** Các role mình đang hoá thân mùa này — trang Hồ sơ (khoá `TITLES_QUERY_KEY` ở `queryKeys.ts`). */
export const titlesQuery = queryOptions({ queryKey: ['me', 'titles'] as const, queryFn: () => apiGet<HeldRoleDto[]>('/api/me/titles') });

/** Mục treo thưởng của một buổi kèm lần nhận của mình — thẻ "Treo thưởng" ở trang Hôm nay. */
export const sessionBountiesQuery = (sessionId: number) =>
  queryOptions({ queryKey: [...SESSION_BOUNTIES_KEY, sessionId] as const, queryFn: () => apiGet<SessionBountiesDto>(`/api/sessions/${sessionId}/bounties`) });

/**
 * Ngày nhân điểm từ hôm nay (giờ VN) trở đi, gần nhất trước — banner dưới thanh điều hướng và gợi ý
 * "Ngày này điểm cộng ×m" ở form Khai điểm (spec ngày nhân điểm §5).
 */
export const upcomingMultipliersQuery = queryOptions({
  queryKey: MULTIPLIER_UPCOMING_KEY,
  queryFn: () => apiGet<MultiplierDayDto[]>('/api/multiplier-days/upcoming'),
});

/** Hệ số của ngày `date` trong danh sách ngày nhân điểm (1 khi không có). */
export function multiplierOn(days: readonly MultiplierDayDto[] | undefined, date: string): number {
  return days?.find((item) => item.day === date)?.multiplier ?? 1;
}
