/**
 * `React.lazy` cho trang, có "tải lại một lần" khi chunk không về (spec §4.2, Review Focus #4).
 *
 * Sau một lần deploy, chunk cũ đã bị xoá: server trả `index.html` (200, `text/html`) cho
 * `/assets/*.js` không còn, nên trình duyệt ném lỗi MIME/syntax — không phải 404, và mỗi
 * trình duyệt ném một kiểu. Vì vậy MỌI lời hứa import bị từ chối, bất kể loại lỗi, đều xử lý
 * như nhau: tải lại trang một lần để lấy `index.html` mới (không bị cache) trỏ tới chunk mới.
 * Cờ trong `sessionStorage` ngăn tải lại vòng lặp: lần hỏng thứ hai liên tiếp mới ném lỗi
 * lên (Error Boundary/màn lỗi của React). Import thành công thì xoá cờ, để lần deploy sau lại
 * được tải lại một lần.
 *
 * Trong lúc chờ trình duyệt tải lại, lời hứa treo mãi (không resolve/reject) nên `Suspense`
 * giữ khung xương thay vì nháy lỗi.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export const CHUNK_RELOAD_FLAG = 'ggd:chunk-reloaded';

type PageModule<P> = { default: ComponentType<P> };

export interface LazyPage<P> extends LazyExoticComponent<ComponentType<P>> {
  /** Tải chunk trước (prefetch); cùng một lời hứa với lần render đầu nên không import hai lần. */
  preload: () => Promise<PageModule<P>>;
}

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_FLAG) !== null;
  } catch {
    return false;
  }
}

function writeFlag(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
    else sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
  } catch {
    // sessionStorage bị chặn (chế độ riêng tư chặt): không có cờ thì vẫn tải lại — chấp nhận.
  }
}

/** Lời hứa không bao giờ xong: giữ Suspense ở fallback trong lúc `location.reload()` đang chạy. */
const forever = <T,>(): Promise<T> => new Promise<T>(() => undefined);

export function lazyPage<P extends object>(load: () => Promise<PageModule<P>>): LazyPage<P> {
  let inflight: Promise<PageModule<P>> | null = null;

  const preload = (): Promise<PageModule<P>> => {
    inflight ??= load().then(
      (mod) => {
        writeFlag(false);
        return mod;
      },
      (error: unknown) => {
        // Cho phép thử lại ở lần render/prefetch sau (vd mạng rớt tạm rồi có lại).
        inflight = null;
        if (readFlag()) throw error;
        writeFlag(true);
        location.reload();
        return forever<PageModule<P>>();
      },
    );
    return inflight;
  };

  const Component = lazy(preload) as LazyPage<P>;
  Component.preload = preload;
  return Component;
}
