import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { MeDto } from '../../src/shared/api-types';
import { AdminPage } from '../../src/web/pages/admin/AdminPage';

/**
 * Chunk tab Quản trị: tải trước khi trang mở (để đổi tab không chờ), và trong lúc chunk tab chưa
 * về thì chip tab đích sáng ngay, tabpanel hiện khung xương + "Đang tải…" (tabpanel có `key`
 * theo tab nên là một `Suspense` mới, React không giữ tab cũ).
 *
 * Tab Cài đặt (chỉ admin) được giả lập: import treo tới khi test mở cổng, và ghi lại lúc bị import.
 */
const settings = vi.hoisted(() => {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  return { imported: false, gate, open: () => open() };
});

vi.mock('../../src/web/pages/admin/SettingsTab', async () => {
  settings.imported = true;
  await settings.gate;
  return { SettingsTab: () => <h2>Cài đặt chung</h2> };
});

const mod: MeDto = {
  id: 1,
  memberCode: 'GGD-0001',
  displayName: 'Mod Một',
  avatarUrl: null,
  email: null,
  notifyEmail: true,
  notifyDm: true,
  accessLevel: 'mod',
};
const admin: MeDto = { ...mod, id: 2, accessLevel: 'admin' };

function stubEmptyApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))),
  );
}

const renderAt = (me: MeDto) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/quan-tri']}>
        <Routes>
          <Route element={<Outlet context={me} />}>
            <Route path="/quan-tri" element={<AdminPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Chạy trước: module chỉ import một lần trong file.
test('a mod does not preload admin-only tab chunks', async () => {
  stubEmptyApi();
  renderAt(mod);
  await screen.findByRole('heading', { level: 2, name: 'Tạo buổi chơi' });
  await new Promise((r) => setTimeout(r, 20));
  expect(settings.imported).toBe(false);
});

test('an admin preloads every tab on mount; switching to a tab still loading highlights it at once and shows the loading state', async () => {
  stubEmptyApi();
  renderAt(admin);
  // Chưa ai bấm "Cài đặt" mà chunk đã được xin.
  await vi.waitFor(() => expect(settings.imported).toBe(true));
  await screen.findByRole('heading', { level: 2, name: 'Tạo buổi chơi' });

  act(() => {
    fireEvent.click(screen.getByRole('tab', { name: 'Cài đặt' }));
  });
  // Chip đích sáng ngay; tabpanel chờ chunk, sau 150ms báo "Đang tải…" (khung xương ẩn khỏi cây truy cập).
  expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Cài đặt');
  expect(await screen.findByRole('status')).toHaveTextContent('Đang tải…');
  expect(screen.getByRole('tabpanel').querySelector('[data-skeleton="rows"]')).not.toBeNull();

  await act(async () => {
    settings.open();
    await settings.gate;
  });
  expect(await screen.findByRole('heading', { level: 2, name: 'Cài đặt chung' })).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
