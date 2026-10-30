/**
 * Chủ đề giao diện chung cho mọi người: `night` (Sảnh đêm, mặc định) hoặc `halloween`. Admin
 * chọn trên server (`PUT /api/admin/theme`); mọi máy đọc `GET /api/theme` (làm mới mỗi phút và
 * khi quay lại tab) rồi đặt `data-theme` của `<html>` — `styles.css` đổi bộ token màu theo đó.
 *
 * Chủ đề nhận được lần trước được nhớ trong `localStorage`: `index.html` có một đoạn script nhỏ
 * đặt `data-theme` từ đó trước khi vẽ trang đầu (không nháy màu cũ), server trả về thì theo server.
 */

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import type { ThemeDto, ThemeName } from '../../shared/api-types';
import { apiGet, apiSend } from '../api';

export type Theme = ThemeName;

/** Khoá trong `localStorage` — `index.html` đọc cùng khoá này. */
export const THEME_KEY = 'ggd-theme';

/** Màu thanh trình duyệt di động (`<meta name="theme-color">`) theo nền `night-900` của từng chủ đề. */
const THEME_COLOR: Record<Theme, string> = { night: '#1B1F4A', halloween: '#1A0F26' };

/** Admin đổi chủ đề thì các máy khác thấy trong vòng một phút (hoặc ngay khi quay lại tab). */
const THEME_REFRESH_MS = 60_000;

export const themeQuery = queryOptions({
  queryKey: ['theme'] as const,
  queryFn: () => apiGet<ThemeDto>('/api/theme'),
  refetchInterval: THEME_REFRESH_MS,
  refetchOnWindowFocus: 'always',
});

const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.dataset.theme === 'halloween' ? 'halloween' : 'night';
}

/** Đặt chủ đề cho trang này (không gửi lên server) và nhớ cho lần mở sau. */
export function applyTheme(theme: Theme): void {
  if (theme === 'halloween') document.documentElement.dataset.theme = 'halloween';
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Trình duyệt chặn lưu trữ (chế độ riêng tư…): chủ đề vẫn đổi, chỉ không nhớ qua lần sau.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Chủ đề đang hiện trên trang. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => 'night');
}

/** Theo chủ đề của server: gọi một lần ở gốc ứng dụng. Lỗi mạng thì giữ chủ đề đang có. */
export function useThemeSync(): void {
  const theme = useQuery(themeQuery).data?.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}

/** Admin đổi chủ đề cho mọi người: đổi ngay trên máy mình, lỗi thì quay về chủ đề cũ. */
export function useSetSharedTheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (theme: Theme) => apiSend<ThemeDto>('PUT', '/api/admin/theme', { theme }),
    onMutate: async (theme) => {
      const previous = current();
      applyTheme(theme);
      // Lượt làm mới đang chạy (chủ đề cũ) không được đè lên lựa chọn vừa bấm.
      await queryClient.cancelQueries({ queryKey: themeQuery.queryKey });
      queryClient.setQueryData(themeQuery.queryKey, { theme });
      return { previous };
    },
    onError: (_error, _theme, context) => {
      if (!context) return;
      queryClient.setQueryData(themeQuery.queryKey, { theme: context.previous });
      applyTheme(context.previous);
    },
    onSuccess: (data) => queryClient.setQueryData(themeQuery.queryKey, data),
  });
}
