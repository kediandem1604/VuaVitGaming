import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { LeaderboardRowDto, RoleDto, SeasonDto } from '../../src/shared/api-types';
import { LeaderboardPage } from '../../src/web/pages/LeaderboardPage';

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

// Thứ tự như API trả về: Ngỗng → Vịt → Phe thứ 3 (role chế độ đặc biệt xếp theo phe của nó).
const LONG_METRIC = 'Số lần tự báo xác khiến hung thủ bị vote';

const roles: RoleDto[] = [
  role({ id: 1, key: 'goose', faction: 'goose', nameVi: 'Ngỗng', icon: '🪿', metricLabel: 'Số lần vote trúng Vịt', description: 'Làm nhiệm vụ và vote loại Vịt khỏi phòng.' }),
  // Nhãn chỉ số dài nhất trong dữ liệu mẫu (40 ký tự).
  role({ id: 6, key: 'canadian', faction: 'goose', nameVi: 'Người Canada', icon: '🍁', metricLabel: LONG_METRIC }),
  role({ id: 80, key: 'inquisitor', faction: 'goose', nameVi: 'Thanh tra', icon: '🪿', metricLabel: 'Điểm', modeKey: 'corruption' }),
  role({ id: 61, key: 'swordsman', faction: 'duck', nameVi: 'Kiếm sĩ', icon: '⚔️', metricLabel: 'Số mạng chém' }),
  role({ id: 70, key: 'dodo', faction: 'neutral', nameVi: 'Chim đa đa', icon: '🦤', metricLabel: 'Số trận thắng (bị vote ra)' }),
];

const seasons: SeasonDto[] = [
  { id: '2026-10', closed: false },
  { id: '2026-09', closed: true },
];

const row = (rank: number, memberId: number, displayName: string, score: number, games: number): LeaderboardRowDto => ({
  rank,
  memberId,
  displayName,
  avatarUrl: null,
  score,
  games,
  lastApprovedAt: '2026-10-20T13:00:00.000Z',
});

const boards: Record<string, LeaderboardRowDto[]> = {
  '1@2026-10': [row(1, 1, 'Ngỗng Một', 7, 2), row(2, 3, 'Ngỗng Ba', 4, 3)],
  '6@2026-10': [row(1, 5, 'Ngỗng Năm', 3, 4)],
  '61@2026-09': [row(1, 2, 'Vịt Hai', 12, 5)],
  '61@2026-10': [],
  // Bốn hàng: bục chỉ lấy ba, bảng đầy đủ bên dưới có cả bốn.
  '70@2026-10': [row(1, 7, 'Ngỗng Bảy', 9, 3), row(2, 8, 'Vịt Tám', 6, 2), row(3, 9, 'Ngỗng Chín', 2, 1), row(4, 10, 'Vịt Mười', 1, 1)],
};

/** Các mục trên bục vinh danh (tối đa 3, thứ tự DOM theo hạng). */
const podiumItems = () => within(screen.getByRole('list', { name: 'Bục vinh danh' })).getAllByRole('listitem');
/** Các hàng của bảng đầy đủ bên dưới bục (mọi hạng, kể cả top 3). */
const boardItems = () => within(screen.getByRole('list', { name: 'Mọi hạng' })).getAllByRole('listitem');
const findBoard = () => screen.findByRole('list', { name: 'Mọi hạng' });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch() {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/seasons') return Promise.resolve(json(200, seasons));
    if (url === '/api/roles') return Promise.resolve(json(200, roles));
    const match = /^\/api\/leaderboard\?roleId=(\d+)&season=(\d{4}-\d{2})&limit=50$/.exec(url);
    if (match) return Promise.resolve(json(200, boards[`${match[1]}@${match[2]}`] ?? []));
    throw new Error(`Không có tuyến giả cho ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

const renderAt = (url: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <LeaderboardPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('defaults to the first role and newest season; rank 1 wears the crown', async () => {
  const fetchMock = stubFetch();
  renderAt('/bang-xep-hang');

  expect(screen.getByRole('heading', { level: 1, name: 'Bảng xếp hạng' })).toBeInTheDocument();
  await findBoard();
  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard?roleId=1&season=2026-10&limit=50', expect.anything());

  const items = boardItems();
  expect(items).toHaveLength(2);
  const [first, second] = items as [HTMLElement, HTMLElement];
  expect(within(first).getByTitle('Hạng 1')).toHaveTextContent('👑');
  expect(first).toHaveTextContent('Ngỗng Một');
  expect(within(first).getByTitle('Số lần vote trúng Vịt')).toHaveTextContent('7');
  expect(first).toHaveTextContent('2 trận');
  expect(within(second).getByTitle('Hạng 2')).toHaveTextContent('2');
  expect(second).not.toHaveTextContent('👑');
  expect(second).toHaveTextContent('Ngỗng Ba');
  expect(within(second).getByTitle('Số lần vote trúng Vịt')).toHaveTextContent('4');
  expect(second).toHaveTextContent('3 trận');

  // Bục vinh danh: min(3, số hàng) mục theo thứ tự hạng; hạng 1 là nhân vật đủ màu, hạng 2 là avatar
  // mang tên; mỗi mục ghi tên và `{điểm} {chỉ số}`.
  const podium = podiumItems();
  expect(podium).toHaveLength(2);
  const [gold, silver] = podium as [HTMLElement, HTMLElement];
  expect(within(gold).getByRole('img', { name: 'Ngỗng: Ngỗng Một' })).toBeInTheDocument();
  expect(gold).toHaveTextContent('Ngỗng Một');
  expect(gold).toHaveTextContent('7 Số lần vote trúng Vịt');
  expect(within(silver).getByRole('img', { name: 'Ngỗng Ba' })).toBeInTheDocument();
  expect(within(silver).queryByRole('img', { name: /Ngỗng:/ })).toBeNull();
  expect(silver).toHaveTextContent('Ngỗng Ba');
  expect(silver).toHaveTextContent('4 Số lần vote trúng Vịt');
  // Chỉ một nhân vật trên cả trang: của hạng 1.
  expect(screen.getAllByRole('img', { name: /^Ngỗng: / })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 2, name: /Ngỗng/ })).toBeInTheDocument();
  expect(screen.getByText('Chỉ số: Số lần vote trúng Vịt')).toBeInTheDocument();

  const roleSelect = screen.getByRole('combobox', { name: 'Role' });
  expect(roleSelect).toHaveValue('1');
  expect(screen.getByRole('combobox', { name: 'Mùa' })).toHaveValue('2026-10');
});

test('the role select is grouped by faction with special-mode roles in their own group', async () => {
  stubFetch();
  renderAt('/bang-xep-hang');
  await screen.findAllByRole('listitem');

  const groupNames = screen.getAllByRole('group').map((group) => group.getAttribute('label'));
  expect(groupNames).toEqual(['Phe Ngỗng', 'Phe Vịt', 'Phe thứ 3', 'Chế độ đặc biệt']);
  expect(within(screen.getByRole('group', { name: 'Phe Ngỗng' })).getByRole('option', { name: '🪿 Ngỗng' })).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Phe Ngỗng' })).queryByRole('option', { name: /Thanh tra/ })).toBeNull();
  expect(within(screen.getByRole('group', { name: 'Chế độ đặc biệt' })).getByRole('option', { name: '🪿 Thanh tra' })).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Phe Vịt' })).getByRole('option', { name: '⚔️ Kiếm sĩ' })).toBeInTheDocument();
});

test('?role= and ?mua= select a role and a closed season', async () => {
  const fetchMock = stubFetch();
  renderAt('/bang-xep-hang?role=61&mua=2026-09');

  await findBoard();
  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard?roleId=61&season=2026-09&limit=50', expect.anything());
  const items = boardItems();
  expect(items).toHaveLength(1);
  expect(items[0]).toHaveTextContent('👑');
  expect(items[0]).toHaveTextContent('Vịt Hai');
  expect(within(items[0] as HTMLElement).getByTitle('Số mạng chém')).toHaveTextContent('12');
  expect(items[0]).toHaveTextContent('5 trận');
  expect(podiumItems()).toHaveLength(1);
  expect(podiumItems()[0]).toHaveTextContent('12 Số mạng chém');
  expect(screen.getByRole('img', { name: 'Kiếm sĩ: Vịt Hai' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('61');
  expect(screen.getByRole('combobox', { name: 'Mùa' })).toHaveValue('2026-09');
  expect(screen.getByText('Mùa đã chốt')).toBeInTheDocument();
});

test('rows carry only the number; a 40-char metric label appears above the list and on the podium, not per row', async () => {
  stubFetch();
  renderAt('/bang-xep-hang?role=6');

  await findBoard();
  const items = boardItems();
  expect(items).toHaveLength(1);
  const first = items[0] as HTMLElement;
  expect(screen.getByText(`Chỉ số: ${LONG_METRIC}`)).toBeInTheDocument();
  expect(podiumItems()[0]).toHaveTextContent(`3 ${LONG_METRIC}`);
  // Trong dòng: số điểm (title = tên chỉ số cho người dùng rê chuột/đọc màn hình), số trận, không lặp nhãn.
  expect(first).not.toHaveTextContent(LONG_METRIC);
  expect(within(first).getByTitle(LONG_METRIC)).toHaveTextContent('3');
  expect(first).toHaveTextContent('4 trận');
  expect(first).toHaveTextContent('Ngỗng Năm');
});

test('an empty board shows the empty copy and no character', async () => {
  stubFetch();
  renderAt('/bang-xep-hang?role=61');
  expect(await screen.findByText('Chưa có ai khai điểm mùa này')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Bục vinh danh' })).toBeNull();
  expect(screen.queryByRole('listitem')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

test('a single row gives a one-step podium', async () => {
  stubFetch();
  renderAt('/bang-xep-hang?role=6');
  await findBoard();

  const podium = podiumItems();
  expect(podium).toHaveLength(1);
  const [only] = podium as [HTMLElement];
  expect(within(only).getByRole('img', { name: 'Người Canada: Ngỗng Năm' })).toBeInTheDocument();
  expect(only).toHaveTextContent('Ngỗng Năm');
  expect(only).toHaveTextContent(`3 ${LONG_METRIC}`);
  // Không có avatar hạng 2/3: nhân vật là `img` duy nhất trên bục.
  expect(within(screen.getByRole('list', { name: 'Bục vinh danh' })).getAllByRole('img')).toHaveLength(1);
  expect(boardItems()).toHaveLength(1);
});

test('the podium stands 2-1-3 on screen while the DOM keeps rank order, and takes at most three', async () => {
  stubFetch();
  renderAt('/bang-xep-hang?role=70');
  await findBoard();

  const podium = podiumItems();
  expect(podium.map((item) => item.textContent)).toEqual([
    expect.stringContaining('Ngỗng Bảy'),
    expect.stringContaining('Vịt Tám'),
    expect.stringContaining('Ngỗng Chín'),
  ]);
  expect(podium.map((item) => item.textContent)).not.toEqual(expect.arrayContaining([expect.stringContaining('Vịt Mười')]));
  // Vị trí hiển thị bằng `order-*`: hạng 2 bên trái, hạng 1 giữa, hạng 3 bên phải.
  const orders = podium.map((item) => item.className.split(' ').find((name) => name.startsWith('order-')));
  expect(orders).toEqual(['order-2', 'order-1', 'order-3']);
  // Hạng 1 có nhân vật; hạng 2 và 3 là avatar mang tên.
  expect(within(podium[0] as HTMLElement).getByRole('img', { name: 'Chim đa đa: Ngỗng Bảy' })).toBeInTheDocument();
  expect(within(podium[1] as HTMLElement).getByRole('img', { name: 'Vịt Tám' })).toBeInTheDocument();
  expect(within(podium[2] as HTMLElement).getByRole('img', { name: 'Ngỗng Chín' })).toBeInTheDocument();
  expect(podium[2]).toHaveTextContent('2 Số trận thắng (bị vote ra)');

  // Bảng đầy đủ bên dưới vẫn có cả bốn hạng.
  const rows = boardItems();
  expect(rows).toHaveLength(4);
  expect(within(rows[0] as HTMLElement).getByTitle('Hạng 1')).toHaveTextContent('👑');
  expect(within(rows[3] as HTMLElement).getByTitle('Hạng 4')).toHaveTextContent('4');
  expect(rows[3]).toHaveTextContent('Vịt Mười');
});

test('invalid ?role= and ?mua= fall back to defaults and are never sent to the API', async () => {
  const fetchMock = stubFetch();
  renderAt('/bang-xep-hang?role=abc&mua=2030-01');
  await screen.findAllByRole('listitem');
  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard?roleId=1&season=2026-10&limit=50', expect.anything());
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('abc'), expect.anything());
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('2030-01'), expect.anything());
  cleanup();

  // Số hợp lệ nhưng không phải role nào đang bật.
  renderAt('/bang-xep-hang?role=999');
  await screen.findAllByRole('listitem');
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('roleId=999'), expect.anything());
  expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('1');
});

test('changing the selects updates the URL and loads the new board', async () => {
  const fetchMock = stubFetch();
  renderAt('/bang-xep-hang');
  await screen.findAllByRole('listitem');

  fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: '61' } });
  expect(await screen.findByText('Chưa có ai khai điểm mùa này')).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/bang-xep-hang?role=61');

  fireEvent.change(screen.getByRole('combobox', { name: 'Mùa' }), { target: { value: '2026-09' } });
  expect(await screen.findByRole('img', { name: 'Kiếm sĩ: Vịt Hai' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard?roleId=61&season=2026-09&limit=50', expect.anything());
  expect(screen.getByTestId('location')).toHaveTextContent('/bang-xep-hang?role=61&mua=2026-09');
});

test('a failed board load shows the message and Thử lại recovers', async () => {
  let fail = true;
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/seasons') return Promise.resolve(json(200, seasons));
    if (url === '/api/roles') return Promise.resolve(json(200, roles));
    if (fail) return Promise.resolve(json(500, { error: { code: 'INTERNAL', message: 'Có lỗi xảy ra, thử lại sau' } }));
    return Promise.resolve(json(200, boards['1@2026-10']));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderAt('/bang-xep-hang');

  expect(await screen.findByRole('alert')).toHaveTextContent('Có lỗi xảy ra, thử lại sau');
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await findBoard();
  expect(boardItems()).toHaveLength(2);
  expect(podiumItems()).toHaveLength(2);
});
