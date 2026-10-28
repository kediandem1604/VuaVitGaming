/**
 * "Đang chuyển trang" (Review: phản hồi khi điều hướng tới chunk lười).
 *
 * App dùng `BrowserRouter` (không phải data router) nên không có `useNavigation()`; React Router
 * v7 lại đổi vị trí trong một transition, nên trong lúc chunk trang đích chưa về React giữ nguyên
 * trang cũ — không khung xương, mục điều hướng cũng chưa đổi. Kho nhỏ này lấp chỗ đó: link
 * (`PrefetchLink`/`PrefetchNavLink`) gọi `beginNavigation(path)` ngay lúc bấm (cập nhật khẩn, vẽ
 * ngay). Trong khoảng chờ `Layout` hiện vạch tiến trình trên cùng (sau 150ms) và tô sẵn mục đích.
 *
 * Hai chỗ kết thúc chờ — không bao giờ kẹt:
 * - `Layout` gọi `arriveNavigation(pathname)` khi trang HIỂN THỊ đổi `pathname`: chỉ hết chờ nếu đó
 *   đúng là trang đích (bấm A rồi B thật nhanh: A hiện lên không được xoá trạng thái chờ của B).
 * - `useEndStaleNavigation()` (trong `RoutedApp`, ngoài `<Routes>`, đọc vị trí ROUTER) hết chờ ngay
 *   khi vị trí router khác trang đích: lượt điều hướng đã bị lượt khác đè (bấm logo về trang đang
 *   xem, Back trong lúc chờ chunk…) — trang hiển thị có thể không đổi `pathname` nên `Layout` không
 *   tự biết được. Thêm `popstate`: Back/Forward ngay sau khi bấm có thể không làm vị trí router đã
 *   commit đổi chút nào (xem hook).
 */

import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { normalize } from './prefetch';

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

/** Huỷ chờ (bất kể trang đích). */
export function endNavigation(): void {
  if (pending === null) return;
  pending = null;
  emit();
}

/** Trang hiển thị vừa thành `pathname`: hết chờ nếu đó là trang đích. */
export function arriveNavigation(pathname: string): void {
  if (pending !== null && pending === normalize(pathname)) endNavigation();
}

/** Router đang ở `pathname`: trang đích khác thì lượt chờ đã bị đè — hết chờ. */
export function endNavigationUnless(pathname: string): void {
  if (pending !== null && pending !== normalize(pathname)) endNavigation();
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

/**
 * Gọi ở nơi đọc vị trí ROUTER (ngoài `<Routes location>`). Chạy mỗi lần điều hướng (`key` đổi cả khi
 * về lại đúng `pathname`), không chạy khi chỉ trạng thái chờ đổi: link gọi `beginNavigation` trước
 * khi router kịp đổi vị trí, lúc đó vị trí cũ khác đích là chuyện bình thường.
 */
export function useEndStaleNavigation(): void {
  const { pathname, key } = useLocation();
  useLayoutEffect(() => endNavigationUnless(pathname), [pathname, key]);
  // Back/Forward ngay sau khi bấm: router về đúng mục lịch sử cũ (cùng `key`) và React gộp hai cập
  // nhật transition, nên vị trí đã commit có thể không đổi chút nào — effect trên không chạy. Lúc
  // `popstate` thì URL trình duyệt đã là đích mới: so với nó.
  useEffect(() => {
    const onPopState = () => endNavigationUnless(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
