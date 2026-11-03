/**
 * Chuyển trang bằng View Transitions (spec §5.1).
 *
 * `BrowserRouter` đổi vị trí ngay khi điều hướng, nên để trình duyệt chụp được khung cũ, cây
 * `<Routes>` nhận vị trí qua prop `location` từ `useDisplayedLocation()` chứ không đọc thẳng từ
 * router: vị trí hiển thị đi sau vị trí thật đúng một nhịp `document.startViewTransition`.
 *
 * - Chỉ khi đổi `pathname`; đổi query string/hash (vd `?tab=`, `?mua=`) thì cập nhật ngay, không
 *   chuyển cảnh.
 * - Trình duyệt không có `startViewTransition` hoặc máy giảm chuyển động → cập nhật ngay (CSS
 *   `.page-enter` lo phần mờ vào khi khoá route đổi).
 * - Chờ chunk của trang đích (tối đa `CHUNK_WAIT_MS`) trước khi chụp để khung mới không phải là
 *   khung xương/trang trắng; chunk thường đã về nhờ tải trước theo ý định (spec §4.3).
 * - Điều hướng dồn dập (Back/forward nhanh): mỗi lần đổi vị trí là một lượt mới, lượt cũ bị bỏ
 *   (`startViewTransition` gọi lại sẽ tự bỏ transition đang chạy) nên vị trí hiển thị cuối cùng
 *   luôn là vị trí mới nhất. Callback của transition không chạy (tab ẩn không có khung vẽ, transition
 *   bị huỷ) thì sau `CALLBACK_FALLBACK_MS` cập nhật thẳng — không bao giờ kẹt ở trang cũ.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, type Location } from 'react-router';
import { prefersReducedMotion } from './motion';
import { endNavigationUnless } from './navPending';
import { routeChunkReady } from './prefetch';

/** Chờ chunk trang đích tối đa chừng này rồi chuyển cảnh dù chưa về. */
export const CHUNK_WAIT_MS = 400;
/**
 * Sau khi gọi `startViewTransition`, nếu callback cập nhật chưa chạy trong chừng này (tab ẩn nên
 * không có khung vẽ, transition bị huỷ với InvalidStateError…) thì cập nhật thẳng — vị trí hiển
 * thị không bao giờ kẹt ở trang cũ (Review Focus #1).
 */
export const CALLBACK_FALLBACK_MS = 300;

interface ViewTransitionLike {
  ready?: Promise<void>;
  finished?: Promise<void>;
  updateCallbackDone?: Promise<void>;
}

type StartViewTransition = (update: () => void) => ViewTransitionLike | undefined;

export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function';
}

const swallow = () => undefined;

/**
 * `startViewTransition` an toàn: không có (hoặc ném lỗi) thì gọi thẳng `update`. Các lời hứa của
 * transition bị bỏ qua (`AbortError: Transition was skipped` khi lượt mới đè lượt cũ là chuyện
 * bình thường) — nuốt để không thành unhandled rejection.
 */
function startTransition(update: () => void): void {
  const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== 'function') {
    update();
    return;
  }
  let transition: ViewTransitionLike | undefined;
  try {
    transition = start.call(document, update);
  } catch {
    update();
    return;
  }
  transition?.ready?.catch(swallow);
  transition?.finished?.catch(swallow);
  transition?.updateCallbackDone?.catch(swallow);
}

/** Chunk trang đích sẵn sàng, hoặc hết `CHUNK_WAIT_MS` — cái nào tới trước. */
function chunkReadyBounded(pathname: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, CHUNK_WAIT_MS);
    void routeChunkReady(pathname).then(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

function sameLocation(a: Location, b: Location): boolean {
  return a.key === b.key && a.pathname === b.pathname && a.search === b.search && a.hash === b.hash;
}

/** Vị trí để render (`<Routes location={…}>`): bằng vị trí router, trừ lúc đang chuyển cảnh. */
export function useDisplayedLocation(): Location {
  const location = useLocation();
  const [displayed, setDisplayed] = useState(location);
  const seq = useRef(0);

  useLayoutEffect(() => {
    if (sameLocation(displayed, location)) return;
    const pathChanged = displayed.pathname !== location.pathname;
    if (!pathChanged || !supportsViewTransitions() || prefersReducedMotion()) {
      // Cùng `pathname` (về lại trang đang hiện, lượt đang chờ chunk bị đè): `Layout` không thấy đổi
      // trang nên tự hết chờ ở đây nếu đích khác.
      if (!pathChanged) endNavigationUnless(location.pathname);
      setDisplayed(location);
      return;
    }
    const mine = ++seq.current;
    let cancelled = false;
    let applied = false;
    let fallback = 0;
    // Chỉ cập nhật một lần, và chỉ khi đây vẫn là lượt mới nhất.
    const apply = () => {
      if (applied || cancelled || mine !== seq.current) return;
      applied = true;
      window.clearTimeout(fallback);
      setDisplayed(location);
    };
    void chunkReadyBounded(location.pathname).then(() => {
      // Đã có lượt mới hơn (hoặc đã gỡ): lượt đó tự cập nhật.
      if (cancelled || mine !== seq.current) return;
      // Callback không chạy kịp (tab ẩn, transition bị huỷ) thì cập nhật thẳng sau `CALLBACK_FALLBACK_MS`.
      fallback = window.setTimeout(apply, CALLBACK_FALLBACK_MS);
      startTransition(() => {
        // Cập nhật DOM ngay trong callback để trình duyệt chụp đúng khung mới.
        flushSync(apply);
      });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
    // `displayed` chỉ đổi do chính effect này; chạy theo vị trí router là đủ.
  }, [location]);

  return displayed;
}
