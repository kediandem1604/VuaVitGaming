import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { prefetchRoute, registerPrefetchRoute, resetPrefetchRegistry, usePrefetchOnIntent } from '../../src/web/lib/prefetch';

const HOVER_MS = 80;

beforeEach(() => {
  vi.useFakeTimers();
  resetPrefetchRegistry();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Probe({ path }: { path: string }) {
  const handlers = usePrefetchOnIntent(path);
  return <a href={path} {...handlers}>đi</a>;
}

const renderProbe = (path = '/dai-sanh') => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Probe path={path} />
    </QueryClientProvider>,
  );
  return queryClient;
};

test('prefetchRoute loads the registered chunk and the page data once', async () => {
  const load = vi.fn(() => Promise.resolve({ default: () => null }));
  const queryFn = vi.fn(() => Promise.resolve(['2026-10']));
  registerPrefetchRoute('/dai-sanh', load, (queryClient) => void queryClient.prefetchQuery({ queryKey: ['seasons'], queryFn }));
  const queryClient = new QueryClient();

  prefetchRoute('/dai-sanh', queryClient);
  prefetchRoute('/dai-sanh', queryClient);
  // Chỉ tiến vài ms: `runAllTimers` sẽ chạy luôn bộ đếm gcTime 5 phút và dọn query khỏi cache.
  await vi.advanceTimersByTimeAsync(10);

  // Chunk chỉ import một lần dù gọi hai lần; dữ liệu đã có trong cache.
  expect(load).toHaveBeenCalledTimes(1);
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect(queryClient.getQueryData(['seasons'])).toEqual(['2026-10']);
});

test('an unknown path is a no-op', () => {
  expect(() => prefetchRoute('/khong-co', new QueryClient())).not.toThrow();
});

test('hover shorter than 80ms does not prefetch; 80ms does', () => {
  const load = vi.fn(() => Promise.resolve({ default: () => null }));
  registerPrefetchRoute('/dai-sanh', load);
  renderProbe();
  const link = screen.getByRole('link');

  fireEvent.pointerEnter(link);
  vi.advanceTimersByTime(HOVER_MS - 1);
  fireEvent.pointerLeave(link);
  vi.advanceTimersByTime(HOVER_MS);
  expect(load).not.toHaveBeenCalled();

  fireEvent.pointerEnter(link);
  vi.advanceTimersByTime(HOVER_MS);
  expect(load).toHaveBeenCalledTimes(1);
});

test('focus and touch prefetch right away', () => {
  const load = vi.fn(() => Promise.resolve({ default: () => null }));
  registerPrefetchRoute('/dai-sanh', load);
  renderProbe();
  const link = screen.getByRole('link');

  fireEvent.focus(link);
  expect(load).toHaveBeenCalledTimes(1);
  fireEvent.touchStart(link);
  // Lần hai vẫn chỉ một lần import.
  expect(load).toHaveBeenCalledTimes(1);
});

test('with Save-Data on nothing is prefetched', () => {
  vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } });
  const load = vi.fn(() => Promise.resolve({ default: () => null }));
  registerPrefetchRoute('/dai-sanh', load);
  renderProbe();
  const link = screen.getByRole('link');

  fireEvent.focus(link);
  fireEvent.pointerEnter(link);
  vi.advanceTimersByTime(HOVER_MS * 2);
  expect(load).not.toHaveBeenCalled();
});

test('a failed chunk prefetch is swallowed so the next intent can try again', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('mạng rớt')).mockResolvedValue({ default: () => null });
  registerPrefetchRoute('/dai-sanh', load);
  const queryClient = new QueryClient();

  prefetchRoute('/dai-sanh', queryClient);
  await vi.runAllTimersAsync();
  prefetchRoute('/dai-sanh', queryClient);
  await vi.runAllTimersAsync();
  expect(load).toHaveBeenCalledTimes(2);
});
