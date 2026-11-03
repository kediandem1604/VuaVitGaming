import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { MeDto, PublicMemberDto } from '../../src/shared/api-types';
import { App } from '../../src/web/App';

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

const serverError = () =>
  new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Có lỗi xảy ra, thử lại sau' } }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });

const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

test('a failed background refetch keeps the layout when me is already loaded', async () => {
  // Trang 404 không tự gọi API nào: mọi "Thử lại"/alert xuất hiện chỉ có thể là của
  // màn hình lỗi toàn trang (các trang thật đều có truy vấn và nút Thử lại riêng).
  window.history.replaceState({}, '', '/khong-co-trang-nay');
  const queryClient = makeClient();
  queryClient.setQueryData(['me'], me);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverError()));

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();

  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['me'] });
    // notifyManager của TanStack báo cho component qua setTimeout(0): chờ nó chạy.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  // Query thật sự đã lỗi nhưng vẫn giữ dữ liệu cũ…
  expect(queryClient.getQueryState(['me'])?.status).toBe('error');
  expect(queryClient.getQueryData(['me'])).toEqual(me);
  // …và khung trang vẫn còn, không bị thay bằng màn hình lỗi.
  expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const stubRoutes = (routes: Record<string, unknown>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url in routes) return Promise.resolve(json(200, routes[url]));
      throw new Error(`Không có tuyến giả cho ${url}`);
    }),
  );

test('/huy-hieu opens the Huy hiệu page inside the layout', async () => {
  window.history.replaceState({}, '', '/huy-hieu');
  const queryClient = makeClient();
  queryClient.setQueryData(['me'], me);
  stubRoutes({ '/api/badges?limit=50': [] });

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );

  // Trang Huy hiệu là chunk riêng: tiêu đề tới sau khi chunk về.
  expect(await screen.findByRole('heading', { level: 1, name: 'Huy hiệu' })).toBeInTheDocument();
  expect(await screen.findByText('Chưa có danh hiệu nào — đầu tháng sau sẽ có SMVP đầu tiên!')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
});

test('/thanh-vien/:id opens the public member page inside the layout', async () => {
  window.history.replaceState({}, '', '/thanh-vien/7');
  const queryClient = makeClient();
  queryClient.setQueryData(['me'], me);
  const seven: PublicMemberDto = { id: 7, displayName: 'Ngỗng Bảy', avatarUrl: null, joinedAt: '2026-10-21T17:30:00.000Z', daysInServer: 0, games: 0, left: false, badges: [] };
  stubRoutes({ '/api/members/7': seven });

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('heading', { level: 1, name: 'Ngỗng Bảy' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
});

test('without any me data a failed load shows the full-screen error', async () => {
  const queryClient = makeClient();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverError()));

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Có lỗi xảy ra, thử lại sau');
  expect(screen.queryByRole('button', { name: 'Đăng xuất' })).not.toBeInTheDocument();
});

test('a lazy route shows the layout at once and the page when its chunk arrives', async () => {
  window.history.replaceState({}, '', '/bang-xep-hang');
  const queryClient = makeClient();
  queryClient.setQueryData(['me'], me);
  stubRoutes({ '/api/seasons': [], '/api/roles': [] });

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  // Khung trang có ngay; trang Bảng xếp hạng là chunk riêng nên tới sau.
  expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 1, name: 'Bảng xếp hạng' })).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 1, name: 'Bảng xếp hạng' })).toBeInTheDocument();
  expect(document.querySelector('[data-skeleton="page"]')).toBeNull();
});

test('while a lazy chunk is pending the page skeleton appears after 150ms, never a blank main', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.history.replaceState({}, '', '/tri-an');
  const queryClient = makeClient();
  queryClient.setQueryData(['me'], me);
  stubRoutes({ '/api/mvp/dates': [] });
  try {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
    // Ngay lúc đầu chưa có khung xương (tránh nháy khi chunk về nhanh)…
    expect(document.querySelector('[data-skeleton="page"]')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
    });
    // …sau 150ms thì có khung xương hoặc trang đã tới — không bao giờ là màn trống.
    const skeleton = document.querySelector('[data-skeleton="page"]');
    const heading = screen.queryByRole('heading', { level: 1, name: 'Tri ân' });
    expect(skeleton !== null || heading !== null).toBe(true);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tri ân' })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
