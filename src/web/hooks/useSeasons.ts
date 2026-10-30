/**
 * Danh sách mùa (`GET /api/seasons`, mới nhất trước; mùa hiện tại luôn có mặt) và
 * cách chọn mùa từ `?mua=YYYY-MM`: chỉ nhận giá trị có trong danh sách — giá trị lạ
 * không bao giờ được gửi lên API — không có thì lấy mùa mới nhất.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SeasonDto } from '../../shared/api-types';
import { seasonsQuery } from '../lib/queries';

export const SEASONS_QUERY_KEY = seasonsQuery.queryKey;

/** Tên tham số URL của mùa, dùng chung cho Đại sảnh và Bảng xếp hạng. */
export const SEASON_PARAM = 'mua';

export function useSeasons(): UseQueryResult<SeasonDto[]> {
  return useQuery(seasonsQuery);
}

/** Mùa đang chọn, hoặc `null` khi danh sách chưa tải (hay rỗng). */
export function resolveSeason(requested: string | null, seasons: SeasonDto[] | undefined): SeasonDto | null {
  if (!seasons) return null;
  return seasons.find((season) => season.id === requested) ?? seasons[0] ?? null;
}
