/**
 * Tải trước trang theo ý định của người dùng (spec §4.3): rê chuột ≥ 80ms, chạm hoặc focus
 * vào link điều hướng → import chunk của trang đó và `prefetchQuery` dữ liệu chính (nếu trang
 * đăng ký). Không tải trước khi người dùng bật "tiết kiệm dữ liệu" (`navigator.connection.saveData`).
 *
 * Sổ đăng ký `path → { load, data }` do `src/web/routes.tsx` điền lúc nạp module; `Layout` và
 * các link trong trang chỉ cần biết đường dẫn. Mọi lỗi khi tải trước đều nuốt: tải trước chỉ
 * là tối ưu, lần điều hướng thật sẽ tự tải (và `lazyPage` lo chuyện chunk hỏng).
 */

import { QueryClientContext, type QueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useRef, type FocusEvent, type PointerEvent, type TouchEvent } from 'react';

/** Rê chuột lướt qua link không tính là ý định; dừng từ 80ms mới tải. */
export const HOVER_INTENT_MS = 80;

interface RouteEntry {
  load: () => Promise<unknown>;
  data?: (queryClient: QueryClient) => void;
  /** Lời hứa import đang chạy hoặc đã xong: không gọi `load` lần hai; lỗi thì xoá để lần sau thử lại. */
  chunk: Promise<unknown> | null;
}

const registry = new Map<string, RouteEntry>();

export function registerPrefetchRoute(path: string, load: () => Promise<unknown>, data?: (queryClient: QueryClient) => void): void {
  registry.set(normalize(path), { load, data, chunk: null });
}

/** Chỉ cho test: xoá sổ đăng ký giữa các test. */
export function resetPrefetchRegistry(): void {
  registry.clear();
}

/** Bỏ query string/hash, bỏ `/` cuối (trừ gốc) để `/dai-sanh?mua=…` cũng khớp `/dai-sanh`. */
function normalize(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? '';
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

interface NetworkInformationLike {
  saveData?: boolean;
}

/** Người dùng bật tiết kiệm dữ liệu (Chrome Android "Lite mode", `Save-Data`): không tải gì khi chưa cần. */
export function saveDataOn(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return connection?.saveData === true;
}

/** Tải trước chunk + dữ liệu của trang `path`; đường dẫn chưa đăng ký hoặc đang tiết kiệm dữ liệu thì không làm gì. */
export function prefetchRoute(path: string, queryClient?: QueryClient): void {
  if (saveDataOn()) return;
  const entry = registry.get(normalize(path));
  if (!entry) return;
  if (entry.chunk === null) {
    entry.chunk = entry.load().catch(() => {
      entry.chunk = null;
    });
  }
  if (queryClient && entry.data) {
    try {
      entry.data(queryClient);
    } catch {
      // Tải trước dữ liệu lỗi không được làm hỏng tương tác.
    }
  }
}

export interface PrefetchHandlers {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
}

/**
 * Bộ handler gắn lên một link tới `path`: rê chuột dừng ≥ 80ms, focus bàn phím hoặc chạm →
 * `prefetchRoute`. Bộ đếm huỷ khi rời link hoặc unmount. Không có `QueryClientProvider` phía
 * trên (vd `Layout` render một mình trong test) thì chỉ tải chunk, bỏ phần dữ liệu.
 */
export function usePrefetchOnIntent(path: string): PrefetchHandlers {
  const queryClient = useContext(QueryClientContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const fire = () => {
    cancel();
    prefetchRoute(path, queryClient);
  };

  useEffect(() => cancel, []);

  return {
    onPointerEnter: () => {
      cancel();
      timer.current = setTimeout(fire, HOVER_INTENT_MS);
    },
    onPointerLeave: cancel,
    onFocus: fire,
    onTouchStart: fire,
  };
}
