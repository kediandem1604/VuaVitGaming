import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { BadgeDto, HeldRoleDto, MeDto, PublicMemberDto, RoleDto } from '../../src/shared/api-types';
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
  extraMetricLabel: null,
  extraMaxPerGame: null,
  extraPoints: null,
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

const badge = (id: number, awardedAt: string, over: Partial<BadgeDto> = {}): BadgeDto => ({
  id,
  badgeKey: 'smvp',
  kind: 'monthly',
  periodId: '2026-10',
  title: 'SMVP tháng 10/2026',
  icon: '👑',
  detail: '7 lần MVP',
  awardedAt,
  member: { id: me.id, displayName: me.displayName, avatarUrl: null },
  ...over,
});

/** Trang công khai của chính tôi (`GET /api/members/1`) với các danh hiệu đã cho. */
const publicMe = (badges: BadgeDto[]): PublicMemberDto => ({
  id: me.id,
  displayName: me.displayName,
  avatarUrl: null,
  joinedAt: '2026-01-05T03:00:00.000Z',
  daysInServer: 290,
  games: 12,
  left: false,
  badges,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * fetch giả: `/api/me/titles` trả `body`; `/api/members/1` trả trang công khai của tôi với `badges`
 * (mặc định chưa có danh hiệu); `PATCH /api/me` (nếu có `onPatch`) ghi lại body gửi lên và trả `me` đã cập nhật.
 */
function stubApi(body: HeldRoleDto[], onPatch?: (patch: Partial<MeDto>) => void, badges: BadgeDto[] = []) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/me/titles') return Promise.resolve(json(200, body));
    if (url === `/api/members/${me.id}`) return Promise.resolve(json(200, publicMe(badges)));
    if (url === '/api/me' && init?.method === 'PATCH' && onPatch) {
      const patch = JSON.parse(String(init.body)) as Partial<MeDto>;
      onPatch(patch);
      return Promise.resolve(json(200, { ...me, ...patch }));
    }
    throw new Error(`Không có tuyến giả cho ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
  expect(items[0]).toHaveTextContent('12 mạng chém');
  expect(items[1]).toHaveTextContent('PHE NGỖNG');
  expect(items[1]).toHaveTextContent('7 lần vote trúng Vịt');
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
  // Máng công tắc (ruling R15): tắt `night-700` với vòng `night-600` (≥ 3:1 trên panel) để thấy
  // được khi tắt; bật `gold` (vòng cũng vàng). Vòng là box-shadow nên núm `after:` không xê dịch.
  const track = email.nextElementSibling;
  expect(track).toHaveAttribute('aria-hidden', 'true');
  expect(track).toHaveClass('bg-night-700', 'ring-2', 'ring-night-600', 'peer-checked:bg-gold', 'peer-checked:ring-gold');
  expect(track).not.toHaveClass('border-2');
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

test('Danh hiệu của tôi lists my badges from the public member endpoint and links to the public page', async () => {
  const fetchMock = stubApi([], undefined, [
    badge(12, '2026-11-10T03:00:00.000Z', { badgeKey: 'games_50', kind: 'milestone', periodId: '', title: 'Lão làng', icon: '🏅', detail: 'Đã đi 50 trận' }),
    badge(11, '2026-11-03T17:05:00.000Z'),
  ]);
  renderPage();

  expect(screen.getByRole('heading', { level: 2, name: 'Danh hiệu của tôi' })).toBeInTheDocument();
  const list = await screen.findByRole('list', { name: 'Danh hiệu của tôi' });
  expect(fetchMock).toHaveBeenCalledWith('/api/members/1', expect.anything());

  // Cùng dữ liệu và cùng thứ tự (mới nhất trước) với trang thành viên; ngày trao theo giờ Việt Nam.
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  const [first, second] = items as [HTMLElement, HTMLElement];
  expect(first).toHaveTextContent('Lão làng');
  expect(first).toHaveTextContent('Đã đi 50 trận');
  expect(second).toHaveTextContent('SMVP tháng 10/2026');
  expect(second).toHaveTextContent('7 lần MVP');
  expect(second).toHaveTextContent('04/11/2026');
  // Là hồ sơ của chính mình: thẻ không lặp tên / không link về chính mình; link công khai nằm ngoài danh sách.
  expect(within(list).queryByRole('link')).toBeNull();
  expect(screen.getByRole('link', { name: 'Xem trang công khai' })).toHaveAttribute('href', '/thanh-vien/1');
});

test('no badges yet shows the empty copy and still offers the public page', async () => {
  stubApi([]);
  renderPage();

  expect(await screen.findByText('Chưa có danh hiệu nào')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Danh hiệu của tôi' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Xem trang công khai' })).toHaveAttribute('href', '/thanh-vien/1');
});
