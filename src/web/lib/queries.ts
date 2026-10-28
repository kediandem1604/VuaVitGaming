/**
 * Tuỳ chọn truy vấn (khoá + hàm tải) của vài danh sách nhỏ mà nhiều nơi cùng dùng — trang hiển
 * thị và bộ tải trước (`routes.tsx`, spec §4.3) phải gọi đúng cùng một URL dưới cùng một khoá,
 * nên khai báo một chỗ. Khoá chỉ-để-làm-mới nằm ở `queryKeys.ts`; ở đây là khoá đi kèm cách tải.
 */

import { queryOptions } from '@tanstack/react-query';
import type { HeldRoleDto, RoleDto, SeasonDto } from '../../shared/api-types';
import { apiGet } from '../api';

/** Danh sách mùa (mới nhất trước; mùa hiện tại luôn có) — Đại sảnh, Bảng xếp hạng. */
export const seasonsQuery = queryOptions({ queryKey: ['seasons'] as const, queryFn: () => apiGet<SeasonDto[]>('/api/seasons') });

/** Role đang bật — Bảng xếp hạng, Khai điểm. Tab Role quản trị làm mới theo tiền tố `['roles']`. */
export const rolesQuery = queryOptions({ queryKey: ['roles'] as const, queryFn: () => apiGet<RoleDto[]>('/api/roles') });

/** 30 ngày gần nhất có kết quả tri ân — trang Tri ân và mục "Sảnh tri ân gần nhất" ở Hôm nay. */
export const mvpDatesQuery = queryOptions({ queryKey: ['mvp', 'dates'] as const, queryFn: () => apiGet<string[]>('/api/mvp/dates') });

/** Các role mình đang hoá thân mùa này — trang Hồ sơ (khoá `TITLES_QUERY_KEY` ở `queryKeys.ts`). */
export const titlesQuery = queryOptions({ queryKey: ['me', 'titles'] as const, queryFn: () => apiGet<HeldRoleDto[]>('/api/me/titles') });
