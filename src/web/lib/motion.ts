/**
 * Bộ chuyển động thống nhất (spec §5) — phần JS đi kèm các biến `--dur-*`/`--ease-*` trong
 * `styles.css`:
 *
 * - `prefersReducedMotion()`: máy bật giảm chuyển động → mọi hiệu ứng chỉ còn mờ nhanh.
 * - `usePresence(open)`: lớp nổi (popup `Select`, `Modal`, gợi ý `RolePicker`) mở thì gắn ngay
 *   với `data-state="open"`; đóng thì giữ trong DOM với `data-state="closed"` đúng thời gian mờ ra
 *   (`--dur-fast`) rồi gỡ. Gỡ bằng hẹn giờ, không chờ `animationend` — sự kiện đó có thể không
 *   tới (tab ẩn, phần tử bị `display: none`, trình duyệt bỏ hoạt ảnh) và lớp nổi không được kẹt lại.
 * - `useStaggerOnce()`: lớp `stagger-in` cho danh sách ở lần hiện đầu — từng dòng (≤ 8) mờ + trượt
 *   so le 30ms; hết lượt thì bỏ lớp để dữ liệu làm mới sau đó không chạy lại.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * Thời gian mờ ra của lớp nổi (ms) — phải bằng `--dur-fast` trong `styles.css`. Đọc từ CSS khi
 * chạy trong trình duyệt để hai nơi không lệch nhau; không đọc được (jsdom) thì dùng số này.
 */
export const EXIT_FALLBACK_MS = 120;

/** Số dòng đầu của danh sách được so le; các dòng sau hiện ngay. Khớp `.stagger-in > :nth-child(-n + 8)`. */
export const STAGGER_ROWS = 8;
/** Bước so le giữa hai dòng (ms) — khớp `--stagger-step`. */
export const STAGGER_STEP_MS = 30;
/** Thời gian một dòng vào (ms) — khớp `--dur-base`. */
const ROW_IN_MS = 200;
/** Lượt so le dài nhất: dòng cuối bắt đầu sau 7 bước và chạy hết `--dur-base`, cộng dư để chắc. */
export const STAGGER_TOTAL_MS = (STAGGER_ROWS - 1) * STAGGER_STEP_MS + ROW_IN_MS + 100;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let exitMsCache: number | null = null;

/** `--dur-fast` tính bằng ms, đọc một lần từ `:root`; không có bố cục thật thì `EXIT_FALLBACK_MS`. */
export function exitDurationMs(): number {
  if (exitMsCache !== null) return exitMsCache;
  let ms = EXIT_FALLBACK_MS;
  if (typeof document !== 'undefined') {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-fast').trim();
    const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(raw);
    if (match) ms = Math.round(Number(match[1]) * (match[2] === 's' ? 1000 : 1));
  }
  exitMsCache = ms;
  return ms;
}

export type PresenceState = 'open' | 'closed';

export interface Presence {
  /** Còn trong DOM (đang mở, hoặc đang mờ ra). */
  mounted: boolean;
  /** Gắn vào `data-state` để CSS chạy hoạt ảnh vào/ra. */
  state: PresenceState;
}

export function usePresence(open: boolean): Presence {
  // `open` bật thì luôn gắn; tắt thì còn gắn tới khi hẹn giờ mờ ra chạy xong (`lingering`).
  const [lingering, setLingering] = useState(false);
  // Giá trị `open` của lần effect trước: lần render ngay sau khi đóng (effect chưa chạy) cũng phải
  // còn trong DOM, nên `mounted` tính cả "vừa đóng" từ ref này.
  const prevOpen = useRef(open);

  useEffect(() => {
    const wasOpen = prevOpen.current;
    prevOpen.current = open;
    if (open) {
      setLingering(false);
      return;
    }
    if (!wasOpen) return;
    // Vừa đóng: giữ lại đúng thời gian mờ ra rồi gỡ; mở lại trong lúc đó thì cleanup dọn hẹn giờ.
    setLingering(true);
    const timer = window.setTimeout(() => setLingering(false), exitDurationMs());
    return () => window.clearTimeout(timer);
  }, [open]);

  const justClosed = prevOpen.current && !open;
  return { mounted: open || lingering || justClosed, state: open ? 'open' : 'closed' };
}

/** Lớp `stagger-in` cho phần tử danh sách ở lần hiện đầu; `undefined` khi lượt so le đã chạy xong. */
export function useStaggerOnce(): string | undefined {
  const [first, setFirst] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setFirst(false), STAGGER_TOTAL_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return first ? 'stagger-in' : undefined;
}
