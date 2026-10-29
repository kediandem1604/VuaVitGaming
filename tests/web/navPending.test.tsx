import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { Link, MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MeDto } from '../../src/shared/api-types';
import { Layout } from '../../src/web/components/Layout';
import { beginNavigation, endNavigation, pendingNavigation, useEndStaleNavigation } from '../../src/web/lib/navPending';
import { registerPrefetchRoute, resetPrefetchRegistry } from '../../src/web/lib/prefetch';
import { useDisplayedLocation } from '../../src/web/lib/viewTransition';

/**
 * "Đang chuyển trang" không bao giờ kẹt (review cuối): lượt điều hướng bị một lượt khác đè (về lại
 * trang đang xem, Back trong lúc chờ chunk…) phải tắt vạch tiến trình, `aria-busy` và mục tô sẵn.
 */

const me: MeDto = {
  id: 1,
  memberCode: 'GGD-0001',
  displayName: 'Ngỗng Một',
  avatarUrl: null,
  email: null,
  notifyEmail: true,
  notifyDm: true,
  accessLevel: 'member',
};

/**
 * `Layout` có banner ngày nhân điểm (đọc qua TanStack Query) nên cần `QueryClientProvider`; test
 * không giả fetch nên danh sách tải lỗi và banner không vẽ gì.
 */
function QueryWrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type StartVT = (cb: () => void) => { finished: Promise<void> };
const doc = document as Document & { startViewTransition?: StartVT };

/** Giống `RoutedApp`: vị trí router điều khiển trạng thái chờ, `<Routes>` nhận vị trí hiển thị. */
function Harness() {
  useEndStaleNavigation();
  const displayed = useDisplayedLocation();
  return (
    <Routes location={displayed}>
      <Route
        element={
          <Layout me={me}>
            <Outlet />
          </Layout>
        }
      >
        <Route index element={<p>trang chủ</p>} />
        <Route path="bang-xep-hang" element={<p>bảng xếp hạng</p>} />
        <Route path="huy-hieu" element={<p>huy hiệu</p>} />
      </Route>
    </Routes>
  );
}

beforeEach(() => {
  resetPrefetchRegistry();
  vi.stubGlobal('matchMedia', undefined);
  // View Transitions giả: callback chạy ở microtask kế tiếp.
  doc.startViewTransition = ((cb: () => void) => ({ finished: Promise.resolve().then(cb) })) as StartVT;
});

afterEach(() => {
  cleanup();
  delete doc.startViewTransition;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  endNavigation();
});

const busy = () => screen.getByRole('main').getAttribute('aria-busy');
const headerLink = (name: RegExp) => screen.getAllByRole('link', { name })[0]!;

test('a navigation superseded by one back to the current page leaves no bar, no aria-busy and the right highlight', async () => {
  vi.useFakeTimers();
  // Chunk Bảng xếp hạng không bao giờ về: trang hiển thị chờ (tối đa 400ms) trước khi chuyển cảnh.
  registerPrefetchRoute('/bang-xep-hang', () => new Promise(() => undefined));
  render(
    <MemoryRouter initialEntries={['/']}>
      <Harness />
    </MemoryRouter>,
    { wrapper: QueryWrapper },
  );

  act(() => {
    fireEvent.click(headerLink(/Xếp hạng/));
  });
  expect(busy()).toBe('true');
  // 30ms sau bấm logo (NavLink thường, về đúng trang đang xem).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30);
  });
  act(() => {
    fireEvent.click(screen.getByRole('link', { name: /GGD Hub/ }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

  expect(screen.getByText('trang chủ')).toBeInTheDocument();
  expect(pendingNavigation()).toBeNull();
  expect(busy()).toBeNull();
  expect(document.querySelector('.nav-progress')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(headerLink(/Hôm nay/).className).toMatch(/\bbg-gold\b/);
  expect(headerLink(/Xếp hạng/).className).not.toMatch(/\bbg-gold\b/);
});

// Back ngay sau khi bấm (transition của router chưa kịp commit): router quay về đúng mục lịch sử cũ
// (cùng `key`), React gộp hai cập nhật nên vị trí router đã commit không hề đổi — vẫn phải hết chờ.
test('Back right after a click ends pending even when the committed router location never changed', () => {
  window.history.replaceState({}, '', '/');
  render(
    <MemoryRouter initialEntries={['/']}>
      <Harness />
    </MemoryRouter>,
    { wrapper: QueryWrapper },
  );
  act(() => beginNavigation('/huy-hieu'));
  expect(busy()).toBe('true');
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(pendingNavigation()).toBeNull();
  expect(busy()).toBeNull();
});

test('clicking the nav item of the page being shown never starts pending', () => {
  render(
    <MemoryRouter initialEntries={['/huy-hieu']}>
      <Harness />
    </MemoryRouter>,
    { wrapper: QueryWrapper },
  );
  act(() => {
    fireEvent.click(headerLink(/Huy hiệu/));
  });
  expect(pendingNavigation()).toBeNull();
  expect(busy()).toBeNull();
});

test('A then B rapidly: pending follows B and only ends when B is shown', async () => {
  vi.useFakeTimers();
  let resolveA = () => {};
  let resolveB = () => {};
  registerPrefetchRoute('/bang-xep-hang', () => new Promise<void>((r) => (resolveA = r)));
  registerPrefetchRoute('/huy-hieu', () => new Promise<void>((r) => (resolveB = r)));
  render(
    <MemoryRouter initialEntries={['/']}>
      <Harness />
    </MemoryRouter>,
    { wrapper: QueryWrapper },
  );

  act(() => {
    fireEvent.click(headerLink(/Xếp hạng/));
  });
  act(() => {
    fireEvent.click(headerLink(/Huy hiệu/));
  });
  expect(pendingNavigation()).toBe('/huy-hieu');
  await act(async () => {
    resolveA();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(pendingNavigation()).toBe('/huy-hieu');
  expect(busy()).toBe('true');
  expect(headerLink(/Huy hiệu/).className).toMatch(/\bbg-gold\b/);

  await act(async () => {
    resolveB();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText('huy hiệu')).toBeInTheDocument();
  expect(pendingNavigation()).toBeNull();
  expect(busy()).toBeNull();
});

test('Layout: showing another page does not end the pending navigation to a different page', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Layout me={me}>
        <Link to="/bang-xep-hang">tới A</Link>
        <Link to="/huy-hieu">tới B</Link>
      </Layout>
    </MemoryRouter>,
    { wrapper: QueryWrapper },
  );
  act(() => beginNavigation('/huy-hieu'));
  act(() => {
    fireEvent.click(screen.getByRole('link', { name: 'tới A' }));
  });
  expect(pendingNavigation()).toBe('/huy-hieu');
  expect(busy()).toBe('true');
  act(() => {
    fireEvent.click(screen.getByRole('link', { name: 'tới B' }));
  });
  expect(pendingNavigation()).toBeNull();
  expect(busy()).toBeNull();
});
