/** Hồ sơ của người đang đăng nhập, cache dưới khoá `['me']`. */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import type { MeDto } from '../../shared/api-types';
import { apiGet } from '../api';

export const ME_QUERY_KEY = ['me'] as const;

export function useMe(): UseQueryResult<MeDto> {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => apiGet<MeDto>('/api/me') });
}

/**
 * Hồ sơ đã tải xong, cho các trang nằm trong `<Layout>`: App chỉ render chúng
 * sau khi `useMe` có dữ liệu và truyền dữ liệu đó qua Outlet context.
 */
export function useCurrentMember(): MeDto {
  return useOutletContext<MeDto>();
}
