import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { MeDto } from '../../src/shared/api-types';
import { AdminPage } from '../../src/web/pages/admin/AdminPage';

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
const admin: MeDto = { ...mod, id: 2, memberCode: 'GGD-0002', displayName: 'Admin Hai', accessLevel: 'admin' };

const MOD_TABS = ['Buổi chơi', 'Duyệt điểm', 'Thành viên', 'Gửi lỗi'];
const ADMIN_TABS = [...MOD_TABS, 'Hạng mục MVP', 'Role', 'Cài đặt'];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Mọi truy vấn GET của các tab trả danh sách rỗng — ở đây chỉ kiểm tra khung trang. */
function stubEmptyApi() {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api/admin/settings')) return Promise.resolve(json(200, { voteDurationHours: 12, autoEndHours: 4, reminderLeadMinutes: 15 }));
    return Promise.resolve(json(200, []));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

const renderAt = (me: MeDto, url = '/quan-tri') => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route element={<Outlet context={me} />}>
            <Route path="/quan-tri" element={<AdminPage />} />
          </Route>
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('a mod sees the four mod tabs, defaulting to Buổi chơi', async () => {
  stubEmptyApi();
  renderAt(mod);

  expect(screen.getByRole('heading', { level: 1, name: 'Quản trị' })).toBeInTheDocument();
  expect(tabNames()).toEqual(MOD_TABS);
  expect(selectedTab()).toBe('Buổi chơi');
  expect(await screen.findByRole('heading', { level: 2, name: 'Tạo buổi chơi' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Cài đặt' })).not.toBeInTheDocument();
});

test('an admin additionally sees Hạng mục MVP, Role and Cài đặt', async () => {
  stubEmptyApi();
  renderAt(admin);
  expect(tabNames()).toEqual(ADMIN_TABS);
  expect(selectedTab()).toBe('Buổi chơi');

  fireEvent.click(screen.getByRole('tab', { name: 'Cài đặt' }));
  expect(selectedTab()).toBe('Cài đặt');
  expect(screen.getByTestId('location')).toHaveTextContent('/quan-tri?tab=cai-dat');
  expect(await screen.findByLabelText('Thời gian mở vote (giờ)')).toHaveValue(12);
});

test('?tab= opens that tab; a mod asking for an admin tab falls back to the default', async () => {
  stubEmptyApi();
  renderAt(admin, '/quan-tri?tab=role');
  expect(selectedTab()).toBe('Role');
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Role');
  cleanup();

  stubEmptyApi();
  renderAt(mod, '/quan-tri?tab=cai-dat');
  expect(selectedTab()).toBe('Buổi chơi');
  expect(await screen.findByRole('heading', { level: 2, name: 'Tạo buổi chơi' })).toBeInTheDocument();
  cleanup();

  stubEmptyApi();
  renderAt(mod, '/quan-tri?tab=duyet-diem');
  expect(selectedTab()).toBe('Duyệt điểm');
  expect(await screen.findByText('Không có lần khai nào chờ duyệt')).toBeInTheDocument();
});
