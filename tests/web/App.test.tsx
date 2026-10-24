import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { MeDto } from '../../src/shared/api-types';
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
