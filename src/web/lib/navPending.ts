/**
 * "Đang chuyển trang" (Review: phản hồi khi điều hướng tới chunk lười).
 *
 * App dùng `BrowserRouter` (không phải data router) nên không có `useNavigation()`; React Router
 * v7 lại đổi vị trí trong một transition, nên trong lúc chunk trang đích chưa về React giữ nguyên
 * trang cũ — không khung xương, mục điều hướng cũng chưa đổi. Kho nhỏ này lấp chỗ đó: link
 * (`PrefetchLink`/`PrefetchNavLink`) gọi `beginNavigation(path)` ngay lúc bấm (cập nhật khẩn, vẽ
 * ngay), `Layout` gọi `endNavigation()` khi trang hiển thị đã đổi `pathname`. Trong khoảng đó
 * `Layout` hiện vạch tiến trình trên cùng (sau 150ms) và tô sẵn mục điều hướng đích.
 */

import { useSyncExternalStore } from 'react';

let pending: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Bắt đầu điều hướng tới `pathname` (đã bỏ query string). */
export function beginNavigation(pathname: string): void {
  if (pending === pathname) return;
  pending = pathname;
  emit();
}

/** Trang hiển thị đã đổi (hoặc huỷ): không còn chờ. */
export function endNavigation(): void {
  if (pending === null) return;
  pending = null;
  emit();
}

/** Đường dẫn đang chờ, hoặc `null`. */
export function pendingNavigation(): string | null {
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePendingNavigation(): string | null {
  return useSyncExternalStore(subscribe, pendingNavigation, () => null);
}
