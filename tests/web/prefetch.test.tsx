import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PrefetchLink, PrefetchNavLink } from '../../src/web/components/PrefetchLink';
import { endNavigation, pendingNavigation } from '../../src/web/lib/navPending';
import { prefetchRoute, registerPrefetchRoute, resetPrefetchRegistry, usePrefetchOnIntent } from '../../src/web/lib/prefetch';

const HOVER_MS = 80;

beforeEach(() => {
  vi.useFakeTimers();
  resetPrefetchRegistry();
  endNavigation();
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

test('a route with a :param matches any value of that segment', () => {
  const load = vi.fn(() => Promise.resolve({ default: () => null }));
  registerPrefetchRoute('/thanh-vien/:id', load);

  prefetchRoute('/thanh-vien/42?tab=x');
  prefetchRoute('/thanh-vien/7');
  prefetchRoute('/thanh-vien');
  prefetchRoute('/thanh-vien/7/khac');
  // Một mẫu = một chunk: hai id khác nhau vẫn chỉ import một lần; số đoạn khác thì không khớp.
  expect(load).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// PrefetchLink / PrefetchNavLink
// ---------------------------------------------------------------------------

const renderLinks = (initial = '/') =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <PrefetchLink to="/dai-sanh?mua=2026-09" onFocus={callerFocus} onPointerEnter={callerEnter} onClick={callerClick}>
        Đại sảnh
      </PrefetchLink>
      <PrefetchNavLink to="/huy-hieu" onTouchStart={callerTouch}>
        Huy hiệu
      </PrefetchNavLink>
    </MemoryRouter>,
  );
const callerFocus = vi.fn();
const callerEnter = vi.fn();
const callerTouch = vi.fn();
const callerClick = vi.fn();

test("the caller's own focus/pointer/touch handlers still run alongside the prefetch", () => {
  const hall = vi.fn(() => Promise.resolve({ default: () => null }));
  const badges = vi.fn(() => Promise.resolve({ default: () => null }));
  registerPrefetchRoute('/dai-sanh', hall);
  registerPrefetchRoute('/huy-hieu', badges);
  renderLinks();

  fireEvent.focus(screen.getByRole('link', { name: 'Đại sảnh' }));
  expect(callerFocus).toHaveBeenCalledTimes(1);
  expect(hall).toHaveBeenCalledTimes(1);

  fireEvent.pointerEnter(screen.getByRole('link', { name: 'Đại sảnh' }));
  expect(callerEnter).toHaveBeenCalledTimes(1);

  fireEvent.touchStart(screen.getByRole('link', { name: 'Huy hiệu' }));
  expect(callerTouch).toHaveBeenCalledTimes(1);
  expect(badges).toHaveBeenCalledTimes(1);
});

test('clicking a link starts loading the target chunk (even with Save-Data) and marks the navigation pending', () => {
  vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } });
  const badges = vi.fn(() => new Promise(() => undefined));
  registerPrefetchRoute('/huy-hieu', badges);
  renderLinks();

  fireEvent.click(screen.getByRole('link', { name: 'Huy hiệu' }));
  expect(badges).toHaveBeenCalledTimes(1);
  expect(pendingNavigation()).toBe('/huy-hieu');
});

test("a modified click, a click the caller prevented, or a click on the current page is not a pending navigation", () => {
  callerClick.mockImplementationOnce((event: { preventDefault: () => void }) => event.preventDefault());
  renderLinks('/dai-sanh');

  fireEvent.click(screen.getByRole('link', { name: 'Huy hiệu' }), { ctrlKey: true });
  expect(pendingNavigation()).toBeNull();
  // Người gọi tự chặn điều hướng.
  fireEvent.click(screen.getByRole('link', { name: 'Đại sảnh' }));
  expect(callerClick).toHaveBeenCalledTimes(1);
  expect(pendingNavigation()).toBeNull();
  // Đã ở `/dai-sanh`: chỉ đổi query string, không chờ chunk nào.
  act(() => {
    fireEvent.click(screen.getByRole('link', { name: 'Đại sảnh' }));
  });
  expect(pendingNavigation()).toBeNull();
});
