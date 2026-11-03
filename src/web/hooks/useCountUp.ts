/**
 * Đếm số (spec §5.6): điểm trên bục, Top 3, Tổng điểm đổi giá trị lúc đang xem → số hiện đếm
 * từ giá trị đang hiện tới giá trị mới trong `--dur-slow` (320ms, `--ease-out`). Lần render đầu
 * hiện ngay giá trị thật (không đếm từ 0 khi tải trang); máy giảm chuyển động thì nhảy thẳng.
 * Đếm bằng `requestAnimationFrame`, số hiện luôn là số nguyên, kết thúc đúng bằng giá trị đích.
 */

import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/motion';

/** Thời gian đếm (ms) — khớp `--dur-slow`. */
export const COUNT_UP_MS = 320;

/** `--ease-out` cubic-bezier(0.2, 0, 0, 1) xấp xỉ bằng hàm mũ cho tiến độ 0..1. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  shownRef.current = shown;
  const frame = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setShown(value);
      return;
    }
    const start = performance.now();
    // Tab ẩn (hoặc trình duyệt không cấp khung vẽ) thì rAF không chạy: hẹn giờ chốt số cuối để
    // không treo ở số cũ; mỗi khung vẽ kết thúc sớm thì huỷ hẹn giờ.
    const settle = window.setTimeout(() => {
      cancelAnimationFrame(frame.current);
      setShown(value);
    }, COUNT_UP_MS + 100);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      const next = t >= 1 ? value : Math.round(from + (value - from) * easeOut(t));
      setShown(next);
      if (t < 1) frame.current = requestAnimationFrame(step);
      else window.clearTimeout(settle);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(settle);
    };
  }, [value]);

  return shown;
}
