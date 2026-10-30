/**
 * `React.lazy` cho trang, có "tải lại một lần" khi chunk không về (spec §4.2, Review Focus #4).
 *
 * Sau một lần deploy, chunk cũ đã bị xoá: server trả `index.html` (200, `text/html`) cho
 * `/assets/*.js` không còn, nên trình duyệt ném lỗi MIME/syntax — không phải 404, và mỗi
 * trình duyệt ném một kiểu. Vì vậy MỌI lời hứa import bị từ chối LÚC RENDER, bất kể loại lỗi,
 * đều xử lý như nhau: tải lại trang để lấy `index.html` mới (không bị cache) trỏ tới chunk mới.
 *
 * Ba quy tắc an toàn:
 * - Chỉ lần render thật mới được tải lại. `preload()` (tải trước khi rê chuột/focus/bấm) là lần
 *   import thô: lỗi thì từ chối và xoá lời hứa để lần sau thử lại, không bao giờ tải lại trang —
 *   một lần mạng chập chờn lúc rê chuột không được làm mất form người dùng đang gõ.
 * - `sessionStorage[CHUNK_RELOAD_FLAG]` giữ thời điểm lần tải lại gần nhất. Đã tải lại trong
 *   `RELOAD_WINDOW_MS` thì ném lỗi lên (màn lỗi của `PageErrorBoundary`) thay vì tải lại nữa.
 *   Dấu không bị xoá khi một import khác thành công (trang cha rồi tab con, hay một lần tải trước
 *   không liên quan) — nếu xoá, hai chunk lồng nhau có thể đẩy nhau tải lại mãi; dấu tự hết hạn
 *   sau cửa sổ nên lần deploy sau lại được tải lại một lần.
 * - `sessionStorage` không dùng được (bị chặn, ném lỗi, đầy) → không có cách chống vòng lặp, nên
 *   không bao giờ tải lại: ném lỗi lên luôn.
 *
 * Trong lúc chờ trình duyệt tải lại, lời hứa treo mãi (không resolve/reject) nên `Suspense`
 * giữ khung xương thay vì nháy lỗi.
 *
 * Module đã về (tải trước xong) thì giữ lại và render thẳng `mod.default`, không qua `React.lazy`:
 * payload của `React.lazy` chỉ khởi tạo ở lần render đầu, nên dù chunk đã tải trước, lần render
 * đầu vẫn treo một nhịp và `Suspense` commit fallback — trong `flushSync` của View Transition
 * (spec §5.1) khung mới chụp được là `main` trống (`Delayed` chưa hiện gì).
 */

import { createElement, lazy, useState, type ComponentType, type ReactElement } from 'react';

export const CHUNK_RELOAD_FLAG = 'ggd:chunk-reloaded';
/** Đã tải lại trong khoảng này thì lần hỏng tiếp theo ném lỗi chứ không tải lại nữa. */
export const RELOAD_WINDOW_MS = 30_000;

type PageModule<P> = { default: ComponentType<P> };

export interface LazyPage<P> {
  (props: P): ReactElement;
  /**
   * Import chunk thô (tải trước): cùng một lời hứa với lần render nên không import hai lần; lỗi thì
   * từ chối (lần gọi sau thử lại) và KHÔNG tải lại trang.
   */
  preload: () => Promise<PageModule<P>>;
}

/**
 * Ghi dấu "sắp tải lại" nếu được phép. `false` khi vừa tải lại trong cửa sổ, hoặc `sessionStorage`
 * không đọc/ghi được (không ghi được dấu thì tải lại có thể lặp mãi).
 */
function claimReload(): boolean {
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_FLAG));
    const since = now - last;
    if (last > 0 && since >= 0 && since < RELOAD_WINDOW_MS) return false;
    const stamp = String(now);
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, stamp);
    // Một số trình duyệt "ghi" mà không lưu (bộ nhớ tạm bị tắt): đọc lại cho chắc.
    return sessionStorage.getItem(CHUNK_RELOAD_FLAG) === stamp;
  } catch {
    return false;
  }
}

/** Lời hứa không bao giờ xong: giữ Suspense ở fallback trong lúc `location.reload()` đang chạy. */
const forever = <T,>(): Promise<T> => new Promise<T>(() => undefined);

export function lazyPage<P extends object>(load: () => Promise<PageModule<P>>): LazyPage<P> {
  let inflight: Promise<PageModule<P>> | null = null;
  /** Module đã về: render thẳng, không treo. */
  let resolved: PageModule<P> | null = null;

  const preload = (): Promise<PageModule<P>> => {
    inflight ??= load().then(
      (mod) => {
        resolved = mod;
        return mod;
      },
      (error: unknown) => {
        // Cho phép thử lại ở lần render/tải trước sau (vd mạng rớt tạm rồi có lại).
        inflight = null;
        throw error;
      },
    );
    return inflight;
  };

  // Chỉ lần render (React gọi hàm này) mới được tải lại trang.
  const Lazy = lazy(() =>
    preload().catch((error: unknown) => {
      if (!claimReload()) throw error;
      location.reload();
      return forever<PageModule<P>>();
    }),
  );

  // Chọn một lần cho mỗi lần gắn: đổi kiểu phần tử giữa chừng (lazy → trực tiếp sau khi chunk về)
  // sẽ gỡ và gắn lại trang, mất trạng thái (form đang gõ).
  // Ép `ComponentType<object>`: `P` chung chung nên TS không chứng minh được props khớp kiểu phần tử; hai nhánh cùng `P`.
  const Component = Object.assign(
    (props: P): ReactElement => {
      const [type] = useState<ComponentType<P>>(() => resolved?.default ?? Lazy);
      return createElement(type as ComponentType<object>, props);
    },
    { preload },
  );
  return Component;
}
