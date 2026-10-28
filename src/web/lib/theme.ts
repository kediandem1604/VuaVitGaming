/**
 * Chủ đề giao diện: `night` (Sảnh đêm, mặc định) hoặc `halloween`. Chủ đề nằm ở
 * `data-theme` của `<html>` — `styles.css` đổi bộ token màu theo đó — và được nhớ trong
 * `localStorage` của máy này. `index.html` có một đoạn script nhỏ đặt `data-theme` trước khi
 * vẽ trang đầu (không nháy màu cũ); hook `useTheme` giữ nút bật/tắt và lớp trang trí đồng bộ.
 */

import { useSyncExternalStore } from 'react';

export type Theme = 'night' | 'halloween';

/** Khoá trong `localStorage` — `index.html` đọc cùng khoá này. */
export const THEME_KEY = 'ggd-theme';

/** Màu thanh trình duyệt di động (`<meta name="theme-color">`) theo nền `night-900` của từng chủ đề. */
const THEME_COLOR: Record<Theme, string> = { night: '#1B1F4A', halloween: '#1A0F26' };

const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.dataset.theme === 'halloween' ? 'halloween' : 'night';
}

export function setTheme(theme: Theme): void {
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

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => 'night');
}
