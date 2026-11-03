import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { COUNT_UP_MS, useCountUp } from '../../src/web/hooks/useCountUp';

/**
 * Đếm số (spec §5.6): lần render đầu hiện ngay giá trị thật (không đếm từ 0 khi tải trang);
 * giá trị đổi lúc đang xem thì đếm tới giá trị mới trong `--dur-slow`; máy giảm chuyển động
 * thì nhảy thẳng.
 */

let now = 0;
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  now = 0;
  frames = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('matchMedia', undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Chạy mọi khung đã xin ở thời điểm `at` ms. */
function tick(at: number) {
  now = at;
  const batch = frames;
  frames = [];
  act(() => batch.forEach((cb) => cb(at)));
}

test('the first render shows the real value at once and asks for no frame', () => {
  const { result } = renderHook(() => useCountUp(42));
  expect(result.current).toBe(42);
  expect(frames).toHaveLength(0);
});

test('a changed value counts up to the new one within the slow duration and ends exactly on it', () => {
  const { result, rerender } = renderHook(({ value }) => useCountUp(value), { initialProps: { value: 10 } });
  rerender({ value: 20 });
  expect(frames).toHaveLength(1);

  tick(0);
  tick(COUNT_UP_MS / 2);
  const midway = result.current;
  expect(midway).toBeGreaterThan(10);
  expect(midway).toBeLessThan(20);
  expect(Number.isInteger(midway)).toBe(true);

  tick(COUNT_UP_MS);
  expect(result.current).toBe(20);
  expect(frames).toHaveLength(0);
});

test('counting down works the same way', () => {
  const { result, rerender } = renderHook(({ value }) => useCountUp(value), { initialProps: { value: 20 } });
  rerender({ value: 5 });
  tick(0);
  tick(COUNT_UP_MS / 2);
  expect(result.current).toBeLessThan(20);
  expect(result.current).toBeGreaterThan(5);
  tick(COUNT_UP_MS + 50);
  expect(result.current).toBe(5);
});

test('a second change mid-count retargets from the number currently shown', () => {
  const { result, rerender } = renderHook(({ value }) => useCountUp(value), { initialProps: { value: 0 } });
  rerender({ value: 100 });
  tick(0);
  tick(COUNT_UP_MS / 2);
  const shown = result.current;
  rerender({ value: 0 });
  tick(COUNT_UP_MS / 2);
  tick(COUNT_UP_MS / 2 + 1);
  expect(result.current).toBeLessThan(shown);
  tick(COUNT_UP_MS * 2);
  expect(result.current).toBe(0);
});

test('when no animation frame ever arrives (hidden tab) the final value still lands after the duration', () => {
  // Chỉ giả `setTimeout` — rAF vẫn là bản giả ở `beforeEach` (không bao giờ chạy), như tab ẩn.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const { result, rerender } = renderHook(({ value }) => useCountUp(value), { initialProps: { value: 1 } });
    rerender({ value: 8 });
    act(() => vi.advanceTimersByTime(COUNT_UP_MS + 99));
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(8);
  } finally {
    vi.useRealTimers();
  }
});

test('with reduced motion the new value appears immediately', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
  const { result, rerender } = renderHook(({ value }) => useCountUp(value), { initialProps: { value: 3 } });
  rerender({ value: 9 });
  expect(result.current).toBe(9);
  expect(frames).toHaveLength(0);
});
