import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { HeldRoleDto, MeDto, RoleDto } from '../../src/shared/api-types';
import { ProfilePage } from '../../src/web/pages/ProfilePage';

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

const role = (over: Pick<RoleDto, 'id' | 'key' | 'faction' | 'nameVi' | 'icon' | 'metricLabel'> & Partial<RoleDto>): RoleDto => ({
  nameEn: over.key,
  description: '',
  maxPerGame: 10,
  mapNote: null,
  modeKey: null,
  hasImage: false,
  active: true,
  sortOrder: over.id,
  ...over,
});

const titles: HeldRoleDto[] = [
  { role: role({ id: 61, key: 'swordsman', faction: 'duck', nameVi: 'Kiếm sĩ', icon: '⚔️', metricLabel: 'Số mạng chém' }), score: 12 },
  { role: role({ id: 1, key: 'goose', faction: 'goose', nameVi: 'Ngỗng', icon: '🪿', metricLabel: 'Số lần vote trúng Vịt' }), score: 7 },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubTitles(body: HeldRoleDto[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/me/titles') return Promise.resolve(json(200, body));
      throw new Error(`Không có tuyến giả cho ${url}`);
    }),
  );
}

/** Trang nằm trong Outlet có context `me` như trong App. */
const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ho-so']}>
        <Routes>
          <Route element={<Outlet context={me} />}>
            <Route path="/ho-so" element={<ProfilePage />} />
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

test('held roles render a small character with my name, the role and its score', async () => {
  stubTitles(titles);
  renderPage();

  expect(screen.getByRole('heading', { level: 2, name: 'Role đang giữ mùa này' })).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: 'Kiếm sĩ: Ngỗng Một' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Ngỗng: Ngỗng Một' })).toBeInTheDocument();
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('⚔️ Kiếm sĩ');
  expect(items[0]).toHaveTextContent('12 Số mạng chém');
  expect(items[1]).toHaveTextContent('7 Số lần vote trúng Vịt');
  expect(screen.getByRole('link', { name: 'Xem lịch sử khai điểm' })).toHaveAttribute('href', '/khai-diem');
});

test('holding nothing shows the empty copy', async () => {
  stubTitles([]);
  renderPage();
  expect(await screen.findByText('Chưa giữ role nào mùa này')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Xem lịch sử khai điểm' })).toBeInTheDocument();
});
