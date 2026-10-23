import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** fetch giả: `/api/me/titles` trả `body`; `PATCH /api/me` (nếu có `onPatch`) ghi lại body gửi lên và trả `me` đã cập nhật. */
function stubApi(body: HeldRoleDto[], onPatch?: (patch: Partial<MeDto>) => void) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/me/titles') return Promise.resolve(json(200, body));
      if (url === '/api/me' && init?.method === 'PATCH' && onPatch) {
        const patch = JSON.parse(String(init.body)) as Partial<MeDto>;
        onPatch(patch);
        return Promise.resolve(json(200, { ...me, ...patch }));
      }
      throw new Error(`Không có tuyến giả cho ${init?.method ?? 'GET'} ${url}`);
    }),
  );
}

/** Trang nằm trong Outlet có context `me` như trong App; trả `queryClient` để xem cache `['me']` sau khi PATCH. */
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
  return queryClient;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // jsdom không có `navigator.clipboard`; test chép mã tự gắn rồi gỡ ở đây.
  delete (navigator as { clipboard?: unknown }).clipboard;
});

test('held roles render as role cards with the faction band, my name on the character and the score', async () => {
  stubApi(titles);
  renderPage();

  expect(screen.getByRole('heading', { level: 2, name: 'Role đang giữ mùa này' })).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: 'Kiếm sĩ: Ngỗng Một' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Ngỗng: Ngỗng Một' })).toBeInTheDocument();
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(2);
  // Thẻ role (`RoleCard`): băng phe viết hoa trên cùng, rồi tên role và dòng điểm.
  expect(items[0]).toHaveTextContent('PHE VỊT');
  expect(items[0]).toHaveTextContent('⚔️ Kiếm sĩ');
  expect(items[0]).toHaveTextContent('12 Số mạng chém');
  expect(items[1]).toHaveTextContent('PHE NGỖNG');
  expect(items[1]).toHaveTextContent('7 Số lần vote trúng Vịt');
  // Role đang giữ không bao giờ là ô trống.
  expect(screen.queryByText('Khai điểm để giành')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Xem lịch sử khai điểm' })).toHaveAttribute('href', '/khai-diem');
});

test('the member code sits on the passport and can still be copied', async () => {
  stubApi([]);
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderPage();

  expect(screen.getByText('Ngỗng Một')).toBeInTheDocument();
  expect(screen.getByText('GGD-0001')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('GGD-0001'));
  expect(await screen.findByRole('button', { name: 'Đã chép' })).toBeInTheDocument();
});

test('the reminder switches keep their checkbox nature and names, and patch on toggle', async () => {
  let patched: unknown = null;
  stubApi([], (patch) => {
    patched = patch;
  });
  const queryClient = renderPage();

  const email = screen.getByRole('switch', { name: 'Nhận nhắc qua email' });
  const dm = screen.getByRole('switch', { name: 'Nhận nhắc qua Discord' });
  expect(email).toHaveAttribute('type', 'checkbox');
  expect(dm).toHaveAttribute('type', 'checkbox');
  expect(email).toBeChecked();
  expect(dm).toBeChecked();
  // Chưa có email: lời nhắc màu vàng cảnh báo (trong cả hai khối Email và Nhắc giờ).
  for (const note of screen.getAllByText('Chưa có email — bạn chỉ nhận nhắc qua Discord')) {
    expect(note).toHaveClass('text-gold');
  }

  fireEvent.click(email);
  await waitFor(() => expect(patched).toEqual({ notifyEmail: false }));
  // Kết quả PATCH ghi vào cache `['me']` (App đọc cache này để truyền context mới xuống trang).
  await waitFor(() => expect(queryClient.getQueryData(['me'])).toMatchObject({ notifyEmail: false }));
});

test('holding nothing shows the empty copy', async () => {
  stubApi([]);
  renderPage();
  expect(await screen.findByText('Chưa giữ role nào mùa này')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Xem lịch sử khai điểm' })).toBeInTheDocument();
});
