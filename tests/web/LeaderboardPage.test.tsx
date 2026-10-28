import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { FactionTopDto, FactionTopRowDto, FactionTotalRowDto, FactionTotalsDto, LeaderboardRowDto, RoleDto, SeasonDto } from '../../src/shared/api-types';
import { LeaderboardPage } from '../../src/web/pages/LeaderboardPage';

const role = (over: Pick<RoleDto, 'id' | 'key' | 'faction' | 'nameVi' | 'icon' | 'metricLabel'> & Partial<RoleDto>): RoleDto => ({
  nameEn: over.key,
  description: '',
  maxPerGame: 10,
  points: 1,
  extraMetricLabel: null,
  extraMaxPerGame: null,
  extraPoints: null,
  penaltyMetricLabel: null,
  penaltyMaxPerGame: null,
  penaltyPoints: null,
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
  // Role có chỉ số phụ: điểm mùa đã trộn hai chỉ số nên đọc "N điểm".
  role({
    id: 50,
    key: 'assassin',
    faction: 'duck',
    nameVi: 'Ám sát',
    icon: '🗡️',
    metricLabel: 'Số mạng đã giết',
    maxPerGame: 15,
    extraMetricLabel: 'Số lần ám sát trong cuộc họp',
    extraMaxPerGame: 2,
    extraPoints: 3,
  }),
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
  // Ám sát: điểm mùa (4 giết + 2 ám sát họp × 3 = 10), không còn đơn vị.
  '50@2026-10': [row(1, 11, 'Vịt Mười Một', 10, 2), row(2, 12, 'Vịt Mười Hai', 3, 1)],
  // Bốn hàng: bục chỉ lấy ba, bảng đầy đủ bên dưới có cả bốn.
  '70@2026-10': [row(1, 7, 'Ngỗng Bảy', 9, 3), row(2, 8, 'Vịt Tám', 6, 2), row(3, 9, 'Ngỗng Chín', 2, 1), row(4, 10, 'Vịt Mười', 1, 1)],
};

/** Phần role của một dòng "Top 3 mỗi phe"; `over` ghi đè điểm mỗi lần, chỉ số phụ, chỉ số phạt (mặc định ×1, không có). */
const topRole = (
  id: number,
  nameVi: string,
  icon: string,
  metricLabel: string,
  faction: FactionTopRowDto['role']['faction'],
  over: Partial<FactionTopRowDto['role']> = {},
): FactionTopRowDto['role'] => ({
  id,
  nameVi,
  icon,
  metricLabel,
  faction,
  points: 1,
  extraMetricLabel: null,
  extraPoints: null,
  penaltyMetricLabel: null,
  penaltyMaxPerGame: null,
  penaltyPoints: null,
  ...over,
});
/** Dân phòng theo điểm khởi đầu: +5 mỗi phát trúng, −3 mỗi phát bắn sai. */
const VIGILANTE = topRole(4, 'Dân phòng', '🔫', 'Số phát bắn trúng kẻ xấu', 'goose', { points: 5, penaltyMetricLabel: 'Số phát bắn sai', penaltyMaxPerGame: 1, penaltyPoints: 3 });
const GOOSE = topRole(1, 'Ngỗng', '🪿', 'Số lần vote trúng Vịt', 'goose');
const SWORDSMAN = topRole(61, 'Kiếm sĩ', '⚔️', 'Số mạng chém', 'duck');
const ASSASSIN = topRole(50, 'Ám sát', '🗡️', 'Số mạng đã giết', 'duck', { extraMetricLabel: 'Số lần ám sát trong cuộc họp', extraPoints: 3 });

/** Một dòng top phe: `value` và `points` đều là điểm mùa của cặp (người, role) — không còn hệ số ×5. */
const topRow = (rank: number, memberId: number, displayName: string, role: FactionTopRowDto['role'], value: number, games: number): FactionTopRowDto => ({
  rank,
  memberId,
  displayName,
  avatarUrl: null,
  role,
  value,
  points: value,
  games,
});

const emptyTop = (seasonId: string): FactionTopDto => ({ seasonId, factions: { goose: [], duck: [], neutral: [] } });

/** Top 3 mỗi phe có dữ liệu: cùng một người giữ hai dòng Phe Ngỗng (Dân phòng 2 phát × 5 điểm = 10 trên Ngỗng 9), Phe thứ 3 trống. */
const factionTops: Record<string, FactionTopDto> = {
  '2026-10': {
    seasonId: '2026-10',
    factions: {
      goose: [topRow(1, 1, 'Ngỗng Một', VIGILANTE, 10, 2), topRow(2, 1, 'Ngỗng Một', GOOSE, 9, 3), topRow(3, 3, 'Ngỗng Ba', GOOSE, 4, 1)],
      duck: [topRow(1, 2, 'Vịt Hai', SWORDSMAN, 11, 5)],
      neutral: [],
    },
  },
  '2026-09': { seasonId: '2026-09', factions: { goose: [], duck: [topRow(1, 2, 'Vịt Hai', SWORDSMAN, 12, 5)], neutral: [] } },
};

// --- Tổng điểm theo phe ---

const totalRow = (rank: number, memberId: number, displayName: string, points: number): FactionTotalRowDto => ({ rank, memberId, displayName, avatarUrl: null, points });
const emptyBoard = { top: [], me: null };
const emptyTotals = (seasonId: string): FactionTotalsDto => ({ seasonId, boards: { all: emptyBoard, goose: emptyBoard, duck: emptyBoard, neutral: emptyBoard } });
/** 20 dòng Phe thứ 3 (điểm 40..21) để người xem (hạng 22) nằm ngoài top. */
const crowd = Array.from({ length: 20 }, (_, i) => totalRow(i + 1, 100 + i, `Người ${i + 1}`, 40 - i));
/** Người xem là thành viên 9 "Tôi": trong top ở "Cả 3 phe" (hạng 2) và Ngỗng (hạng 1), ngoài top ở Phe thứ 3, không có điểm Vịt. */
const totals: Record<string, FactionTotalsDto> = {
  '2026-10': {
    seasonId: '2026-10',
    boards: {
      all: { top: [totalRow(1, 1, 'Ngỗng Một', 19), totalRow(2, 9, 'Tôi', 12), totalRow(3, 2, 'Vịt Hai', 11)], me: totalRow(2, 9, 'Tôi', 12) },
      goose: { top: [totalRow(1, 9, 'Tôi', 12), totalRow(2, 1, 'Ngỗng Một', 10)], me: totalRow(1, 9, 'Tôi', 12) },
      duck: { top: [totalRow(1, 2, 'Vịt Hai', 11), totalRow(2, 1, 'Ngỗng Một', 9)], me: null },
      neutral: { top: crowd, me: totalRow(22, 9, 'Tôi', 1) },
    },
  },
  '2026-09': {
    seasonId: '2026-09',
    boards: { all: { top: [totalRow(1, 2, 'Vịt Hai', 12)], me: null }, goose: emptyBoard, duck: { top: [totalRow(1, 2, 'Vịt Hai', 12)], me: null }, neutral: emptyBoard },
  },
};

/** Chọn một mùa trong ô chọn mùa ở đầu trang (mở rồi bấm dòng). */
const pickSeason = (name: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Mùa' }));
  fireEvent.click(screen.getByRole('option', { name }));
};

/** Một tab của mục "Tổng điểm theo phe". */
const totalsTab = (name: string) => within(screen.getByRole('tablist', { name: 'Phe' })).getByRole('tab', { name });
/** Danh sách của bảng đang hiện trong mục "Tổng điểm theo phe". */
const totalsList = () => within(screen.getByRole('tabpanel')).getByRole('list');
const totalsItems = () => within(totalsList()).getAllByRole('listitem');

/** Các mục trên bục vinh danh (tối đa 3, thứ tự DOM theo hạng). */
const podiumItems = () => within(screen.getByRole('list', { name: 'Bục vinh danh' })).getAllByRole('listitem');
/** Các hàng của bảng đầy đủ bên dưới bục (mọi hạng, kể cả top 3). */
const boardItems = () => within(screen.getByRole('list', { name: 'Mọi hạng' })).getAllByRole('listitem');
const findBoard = () => screen.findByRole('list', { name: 'Mọi hạng' });
/** Danh sách của một khối phe trong "Top 3 mỗi phe". */
const factionList = (label: string) => screen.getByRole('list', { name: `Top 3 ${label}` });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Mặc định "Top 3 mỗi phe" và "Tổng điểm theo phe" trống ở mọi mùa; truyền `tops`/`sums` để có dữ liệu. */
function stubFetch(tops: Record<string, FactionTopDto> = {}, sums: Record<string, FactionTotalsDto> = {}) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/seasons') return Promise.resolve(json(200, seasons));
    if (url === '/api/roles') return Promise.resolve(json(200, roles));
    const match = /^\/api\/leaderboard\?roleId=(\d+)&season=(\d{4}-\d{2})&limit=50$/.exec(url);
    if (match) return Promise.resolve(json(200, boards[`${match[1]}@${match[2]}`] ?? []));
    const top = /^\/api\/leaderboard\/factions\?season=(\d{4}-\d{2})$/.exec(url);
    if (top?.[1]) return Promise.resolve(json(200, tops[top[1]] ?? emptyTop(top[1])));
    const sum = /^\/api\/leaderboard\/totals\?season=(\d{4}-\d{2})$/.exec(url);
    if (sum?.[1]) return Promise.resolve(json(200, sums[sum[1]] ?? emptyTotals(sum[1])));
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

  // Bục vinh danh: min(3, số hàng) mục theo thứ tự hạng; hạng 1 là nhân vật đủ màu (tên chỉ ở bảng
  // tên trên đầu, không ghi lại bên dưới), hạng 2 là avatar trang trí kèm tên; mọi mục ghi `{điểm} {chỉ số}`.
  const podium = podiumItems();
  expect(podium).toHaveLength(2);
  const [gold, silver] = podium as [HTMLElement, HTMLElement];
  expect(within(gold).getByRole('img', { name: 'Ngỗng: Ngỗng Một' })).toBeInTheDocument();
  expect(within(gold).queryByText('Ngỗng Một', { selector: 'p' })).toBeNull();
  expect(gold).toHaveTextContent('7 lần vote trúng Vịt');
  // R13: avatar hạng 2 không mang nhãn (không có `img` nào), tên hiện bằng chữ bên dưới.
  expect(within(silver).queryByRole('img')).toBeNull();
  expect(within(silver).getByText('Ngỗng Ba', { selector: 'p' })).toBeInTheDocument();
  expect(silver).toHaveTextContent('4 lần vote trúng Vịt');
  // R14: chưa đủ ba hàng → thứ tự tự nhiên trên màn hình, hạng 1 bên trái hạng 2.
  expect(podium.map((item) => item.className.split(' ').find((name) => name.startsWith('order-')))).toEqual(['order-1', 'order-2']);
  // Chỉ một nhân vật trên cả trang: của hạng 1.
  expect(screen.getAllByRole('img', { name: /^Ngỗng: / })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 2, name: /Ngỗng/ })).toBeInTheDocument();
  expect(screen.getByText('Chỉ số: Số lần vote trúng Vịt')).toBeInTheDocument();

  expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('🪿 Ngỗng');
  expect(screen.getByRole('combobox', { name: 'Mùa' })).toHaveTextContent('Tháng 10/2026');
});

test('the role select opens a searchable listbox grouped by faction with special-mode roles in their own group', async () => {
  stubFetch();
  renderAt('/bang-xep-hang');
  await screen.findAllByRole('listitem');

  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(screen.getByRole('combobox', { name: 'Role' }));
  const list = screen.getByRole('listbox', { name: 'Role' });
  const groupName = (group: HTMLElement) => document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent;
  expect(within(list).getAllByRole('group').map(groupName)).toEqual(['Ngỗng', 'Vịt', 'Phe thứ 3', 'Chế độ đặc biệt']);
  expect(within(screen.getByRole('group', { name: 'Ngỗng' })).getByRole('option', { name: '🪿 Ngỗng' })).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('group', { name: 'Ngỗng' })).queryByRole('option', { name: /Thanh tra/ })).toBeNull();
  expect(within(screen.getByRole('group', { name: 'Chế độ đặc biệt' })).getByRole('option', { name: '🪿 Thanh tra' })).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Vịt' })).getByRole('option', { name: '⚔️ Kiếm sĩ' })).toBeInTheDocument();

  // Ô tìm lọc không phân biệt dấu: "kiem" → Kiếm sĩ; không khớp → thông báo.
  const search = screen.getByRole('textbox', { name: 'Tìm role' });
  expect(search).toHaveAttribute('placeholder', 'Tìm role…');
  fireEvent.change(search, { target: { value: 'kiem' } });
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['⚔️ Kiếm sĩ']);
  fireEvent.change(search, { target: { value: 'zzz' } });
  expect(screen.getByText('Không có role nào khớp')).toBeInTheDocument();
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
  expect(podiumItems()[0]).toHaveTextContent('12 mạng chém');
  expect(screen.getByRole('img', { name: 'Kiếm sĩ: Vịt Hai' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('⚔️ Kiếm sĩ');
  expect(screen.getByRole('combobox', { name: 'Mùa' })).toHaveTextContent('Tháng 9/2026 (đã chốt)');
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
  expect(podiumItems()[0]).toHaveTextContent(`3 ${LONG_METRIC.replace(/^Số /, '')}`);
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
  // Tên chỉ ở bảng tên của nhân vật, không ghi lại bên dưới.
  expect(within(only).queryByText('Ngỗng Năm', { selector: 'p' })).toBeNull();
  expect(only).toHaveTextContent(`3 ${LONG_METRIC.replace(/^Số /, '')}`);
  // Không có avatar hạng 2/3: nhân vật là `img` duy nhất trên bục; một hàng đứng ở vị trí đầu.
  expect(within(screen.getByRole('list', { name: 'Bục vinh danh' })).getAllByRole('img')).toHaveLength(1);
  expect(only.className.split(' ')).toContain('order-1');
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
  // Đủ ba hàng → vị trí hiển thị bằng `order-*`: hạng 2 bên trái, hạng 1 giữa, hạng 3 bên phải.
  const orders = podium.map((item) => item.className.split(' ').find((name) => name.startsWith('order-')));
  expect(orders).toEqual(['order-2', 'order-1', 'order-3']);
  // Hạng 1 có nhân vật (tên ở bảng tên); hạng 2 và 3 là avatar trang trí kèm tên bằng chữ (R13).
  expect(within(podium[0] as HTMLElement).getByRole('img', { name: 'Chim đa đa: Ngỗng Bảy' })).toBeInTheDocument();
  expect(within(podium[0] as HTMLElement).queryByText('Ngỗng Bảy', { selector: 'p' })).toBeNull();
  expect(within(podium[1] as HTMLElement).queryByRole('img')).toBeNull();
  expect(within(podium[1] as HTMLElement).getByText('Vịt Tám', { selector: 'p' })).toBeInTheDocument();
  expect(within(podium[2] as HTMLElement).queryByRole('img')).toBeNull();
  expect(within(podium[2] as HTMLElement).getByText('Ngỗng Chín', { selector: 'p' })).toBeInTheDocument();
  expect(podium[2]).toHaveTextContent('2 trận thắng (bị vote ra)');

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
  expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('🪿 Ngỗng');
});

test('changing the selects updates the URL and loads the new board', async () => {
  const fetchMock = stubFetch();
  renderAt('/bang-xep-hang');
  await screen.findAllByRole('listitem');

  fireEvent.click(screen.getByRole('combobox', { name: 'Role' }));
  fireEvent.click(screen.getByRole('option', { name: '⚔️ Kiếm sĩ' }));
  expect(await screen.findByText('Chưa có ai khai điểm mùa này')).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/bang-xep-hang?role=61');
  expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('⚔️ Kiếm sĩ');

  // Chọn mùa bằng bàn phím: ↓ mở, ↓ tới mùa trước, Enter chọn.
  const seasonSelect = screen.getByRole('combobox', { name: 'Mùa' });
  fireEvent.keyDown(seasonSelect, { key: 'ArrowDown' });
  fireEvent.keyDown(seasonSelect, { key: 'ArrowDown' });
  fireEvent.keyDown(seasonSelect, { key: 'Enter' });
  expect(await screen.findByRole('img', { name: 'Kiếm sĩ: Vịt Hai' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard?roleId=61&season=2026-09&limit=50', expect.anything());
  expect(screen.getByTestId('location')).toHaveTextContent('/bang-xep-hang?role=61&mua=2026-09');
});

test('Top 3 mỗi phe: three faction blocks, rows in rank order with medal, role and season points — no ×5 line', async () => {
  const fetchMock = stubFetch(factionTops);
  renderAt('/bang-xep-hang');
  await findBoard();

  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard/factions?season=2026-10', expect.anything());
  expect(screen.getByRole('heading', { level: 2, name: 'Top 3 mỗi phe' })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Phe Ngỗng', 'Phe Vịt', 'Phe thứ 3']);

  const goose = within(factionList('Phe Ngỗng')).getAllByRole('listitem');
  expect(goose).toHaveLength(3);
  const [first, second, third] = goose as [HTMLElement, HTMLElement, HTMLElement];
  // Hạng 1: Dân phòng 2 phát × 5 điểm = 10 điểm mùa, xếp trên Ngỗng 9 vote của chính người đó. Role có
  // points ≠ 1 đọc điểm mùa là "10 điểm" (không còn đơn vị), và không còn dòng hệ số "2 × 5".
  expect(within(first).getByTitle('Hạng 1')).toHaveTextContent('🥇');
  expect(first).toHaveTextContent('Ngỗng Một');
  expect(first).toHaveTextContent('Dân phòng · 10 điểm');
  expect(first).toHaveTextContent('10 điểm');
  expect(first).not.toHaveTextContent('×');
  expect(first).not.toHaveTextContent('phát bắn trúng kẻ xấu');
  expect(within(first).getByRole('link', { name: /Dân phòng/ })).toHaveAttribute('href', '/bang-xep-hang?role=4&mua=2026-10');
  // Cùng một người ở hạng 2 với role khác, ×1: điểm mùa đọc theo nhãn chỉ số.
  expect(within(second).getByTitle('Hạng 2')).toHaveTextContent('🥈');
  expect(second).toHaveTextContent('Ngỗng Một');
  expect(second).toHaveTextContent('Ngỗng · 9 lần vote trúng Vịt');
  expect(second).toHaveTextContent('9 điểm');
  expect(second).not.toHaveTextContent('×');
  // Tên khớp đúng "Ngỗng": dòng còn có link tên người "Ngỗng Một" tới trang thành viên.
  expect(within(second).getByRole('link', { name: 'Ngỗng' })).toHaveAttribute('href', '/bang-xep-hang?role=1&mua=2026-10');
  expect(within(third).getByTitle('Hạng 3')).toHaveTextContent('🥉');
  expect(third).toHaveTextContent('Ngỗng Ba');
  expect(third).toHaveTextContent('4 điểm');

  const duck = within(factionList('Phe Vịt')).getAllByRole('listitem');
  expect(duck).toHaveLength(1);
  expect(duck[0]).toHaveTextContent('Vịt Hai');
  expect(duck[0]).toHaveTextContent('Kiếm sĩ · 11 mạng chém');
  expect(duck[0]).toHaveTextContent('11 điểm');

  // Phe chưa có ai: không có danh sách, chỉ câu trống.
  expect(screen.queryByRole('list', { name: 'Top 3 Phe thứ 3' })).toBeNull();
  expect(screen.getByText('Chưa có ai')).toBeInTheDocument();

  // Bảng theo role bên dưới vẫn như cũ.
  expect(boardItems()).toHaveLength(2);
  expect(podiumItems()).toHaveLength(2);
  expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('🪿 Ngỗng');
});

test('Top 3 mỗi phe follows ?mua= and the season select', async () => {
  const fetchMock = stubFetch(factionTops);
  renderAt('/bang-xep-hang?role=61&mua=2026-09');
  await findBoard();

  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard/factions?season=2026-09', expect.anything());
  expect(fetchMock).not.toHaveBeenCalledWith('/api/leaderboard/factions?season=2026-10', expect.anything());
  expect(within(factionList('Phe Vịt')).getAllByRole('listitem')).toHaveLength(1);
  expect(factionList('Phe Vịt')).toHaveTextContent('12 điểm');
  expect(within(factionList('Phe Vịt')).getByRole('link', { name: /Kiếm sĩ/ })).toHaveAttribute('href', '/bang-xep-hang?role=61&mua=2026-09');
  expect(screen.getAllByText('Chưa có ai')).toHaveLength(2);

  pickSeason('Tháng 10/2026');
  expect(within(await screen.findByRole('list', { name: 'Top 3 Phe Ngỗng' })).getAllByRole('listitem')).toHaveLength(3);
  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard/factions?season=2026-10', expect.anything());
  expect(screen.getByTestId('location')).toHaveTextContent('/bang-xep-hang?role=61&mua=2026-10');
});

test('member names link to the public member page while role links stay', async () => {
  stubFetch(factionTops);
  renderAt('/bang-xep-hang?role=70');
  await findBoard();

  // Top 3 mỗi phe: tên người là link tới trang thành viên; link role trên dòng dưới vẫn như cũ.
  const [first, second] = within(factionList('Phe Ngỗng')).getAllByRole('listitem') as [HTMLElement, HTMLElement];
  expect(within(first).getByRole('link', { name: 'Ngỗng Một' })).toHaveAttribute('href', '/thanh-vien/1');
  expect(within(first).getByRole('link', { name: /Dân phòng/ })).toHaveAttribute('href', '/bang-xep-hang?role=4&mua=2026-10');
  expect(within(second).getByRole('link', { name: 'Ngỗng Một' })).toHaveAttribute('href', '/thanh-vien/1');
  expect(within(factionList('Phe Vịt')).getByRole('link', { name: 'Vịt Hai' })).toHaveAttribute('href', '/thanh-vien/2');

  // Bục: hạng 1 là nhân vật (tên trên bảng tên) nằm trong link; hạng 2–3 avatar + tên là một link.
  const [gold, silver, bronze] = podiumItems() as [HTMLElement, HTMLElement, HTMLElement];
  const goldLink = within(gold).getByRole('link', { name: /Ngỗng Bảy/ });
  expect(goldLink).toHaveAttribute('href', '/thanh-vien/7');
  expect(within(goldLink).getByRole('img', { name: 'Chim đa đa: Ngỗng Bảy' })).toBeInTheDocument();
  expect(within(gold).queryByText('Ngỗng Bảy', { selector: 'p' })).toBeNull();
  expect(within(silver).getByRole('link', { name: 'Vịt Tám' })).toHaveAttribute('href', '/thanh-vien/8');
  expect(within(bronze).getByRole('link', { name: 'Ngỗng Chín' })).toHaveAttribute('href', '/thanh-vien/9');

  // Bảng đầy đủ: mọi hàng, kể cả hàng ngoài bục.
  const rows = boardItems();
  expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Ngỗng Bảy' })).toHaveAttribute('href', '/thanh-vien/7');
  expect(within(rows[3] as HTMLElement).getByRole('link', { name: 'Vịt Mười' })).toHaveAttribute('href', '/thanh-vien/10');

  // Không có link lồng trong link ở bất kỳ đâu trên trang.
  for (const link of screen.getAllByRole('link')) expect(within(link).queryByRole('link')).toBeNull();
});

test('an extra-metric role reads "N điểm" on the podium, in the table and in Top 3 mỗi phe, with both metrics on the "Chỉ số:" line', async () => {
  const tops: Record<string, FactionTopDto> = {
    '2026-10': {
      seasonId: '2026-10',
      factions: {
        goose: [],
        // Ám sát 10 điểm mùa (hệ số 1) xếp trên Kiếm sĩ 7 mạng chém.
        duck: [topRow(1, 11, 'Vịt Mười Một', ASSASSIN, 10, 1, 2), topRow(2, 2, 'Vịt Hai', SWORDSMAN, 7, 1, 3)],
        neutral: [],
      },
    },
  };
  stubFetch(tops);
  renderAt('/bang-xep-hang?role=50');
  await findBoard();

  expect(screen.getByRole('heading', { level: 2, name: /Ám sát/ })).toBeInTheDocument();
  expect(screen.getByText('Chỉ số: Số mạng đã giết (+1 điểm) · Số lần ám sát trong cuộc họp (+3 điểm)')).toBeInTheDocument();

  // Bục và bảng: "10 điểm", không in nhãn chỉ số nào.
  const [gold, silver] = podiumItems() as [HTMLElement, HTMLElement];
  expect(gold).toHaveTextContent('10 điểm');
  expect(silver).toHaveTextContent('3 điểm');
  expect(gold).not.toHaveTextContent('mạng đã giết');
  const [first, second] = boardItems() as [HTMLElement, HTMLElement];
  expect(first).toHaveTextContent('Vịt Mười Một');
  expect(first).toHaveTextContent('10 điểm');
  expect(first).toHaveTextContent('2 trận');
  expect(first).not.toHaveTextContent('mạng đã giết');
  expect(second).toHaveTextContent('3 điểm');

  // Top 3 mỗi phe: dòng của Ám sát đọc "10 điểm" thay cho `{giá trị} {nhãn}`; Kiếm sĩ như cũ.
  const duck = within(factionList('Phe Vịt')).getAllByRole('listitem');
  expect(duck).toHaveLength(2);
  expect(duck[0]).toHaveTextContent('Ám sát · 10 điểm');
  expect(duck[0]).not.toHaveTextContent('mạng đã giết');
  expect(duck[1]).toHaveTextContent('Kiếm sĩ · 7 mạng chém');
  expect(duck[1]).toHaveTextContent('7 điểm');
});

test('a failed board load shows the message and Thử lại recovers', async () => {
  let fail = true;
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/seasons') return Promise.resolve(json(200, seasons));
    if (url === '/api/roles') return Promise.resolve(json(200, roles));
    // Chỉ bảng theo role lỗi; "Top 3 mỗi phe" vẫn tải được.
    if (url.startsWith('/api/leaderboard/factions?')) return Promise.resolve(json(200, emptyTop('2026-10')));
    if (url.startsWith('/api/leaderboard/totals?')) return Promise.resolve(json(200, emptyTotals('2026-10')));
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

// ---------------------------------------------------------------------------
// Tổng điểm theo phe
// ---------------------------------------------------------------------------

test('Tổng điểm theo phe: four tabs switch boards, arrow keys move between tabs, medals for 1-3 and names link to the member page', async () => {
  const fetchMock = stubFetch({}, totals);
  renderAt('/bang-xep-hang');
  await findBoard();

  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard/totals?season=2026-10', expect.anything());
  expect(screen.getByRole('heading', { level: 2, name: 'Tổng điểm theo phe' })).toBeInTheDocument();
  const tabs = within(screen.getByRole('tablist', { name: 'Phe' })).getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Cả 3 phe', 'Ngỗng', 'Vịt', 'Phe thứ 3']);
  expect(totalsTab('Cả 3 phe')).toHaveAttribute('aria-selected', 'true');
  // Mọi tab trỏ `aria-controls` tới đúng một panel đang có trong DOM.
  for (const tab of tabs) expect(document.getElementById(tab.getAttribute('aria-controls') ?? '')).toBe(screen.getByRole('tabpanel'));

  // Mặc định "Cả 3 phe": ba dòng theo hạng với huy chương, tên là link tới trang thành viên, "{điểm} điểm".
  const all = await within(screen.getByRole('tabpanel')).findAllByRole('listitem');
  expect(all).toHaveLength(3);
  const [first, second, third] = all as [HTMLElement, HTMLElement, HTMLElement];
  expect(within(first).getByTitle('Hạng 1')).toHaveTextContent('🥇');
  expect(within(first).getByRole('link', { name: 'Ngỗng Một' })).toHaveAttribute('href', '/thanh-vien/1');
  expect(first).toHaveTextContent('19 điểm');
  expect(within(second).getByTitle('Hạng 2')).toHaveTextContent('🥈');
  expect(within(third).getByTitle('Hạng 3')).toHaveTextContent('🥉');
  expect(third).toHaveTextContent('Vịt Hai');
  expect(third).toHaveTextContent('11 điểm');

  // Bấm tab Vịt: bảng Vịt, đúng hai dòng theo thứ tự hạng.
  fireEvent.click(totalsTab('Vịt'));
  expect(totalsTab('Vịt')).toHaveAttribute('aria-selected', 'true');
  expect(totalsTab('Cả 3 phe')).toHaveAttribute('aria-selected', 'false');
  expect(totalsItems().map((item) => item.textContent)).toEqual([expect.stringContaining('Vịt Hai'), expect.stringContaining('Ngỗng Một')]);
  expect(totalsItems()[0]).toHaveTextContent('11 điểm');
  expect(totalsItems()[1]).toHaveTextContent('9 điểm');

  // Phím mũi tên: → sang Phe thứ 3 (tab nhận focus và được chọn), ← quay lại; Home về tab đầu; hai đầu vòng nhau.
  totalsTab('Vịt').focus();
  fireEvent.keyDown(totalsTab('Vịt'), { key: 'ArrowRight' });
  expect(totalsTab('Phe thứ 3')).toHaveAttribute('aria-selected', 'true');
  expect(totalsTab('Phe thứ 3')).toHaveFocus();
  expect(totalsItems()).toHaveLength(20);
  fireEvent.keyDown(totalsTab('Phe thứ 3'), { key: 'ArrowLeft' });
  expect(totalsTab('Vịt')).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(totalsTab('Vịt'), { key: 'Home' });
  expect(totalsTab('Cả 3 phe')).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(totalsTab('Cả 3 phe'), { key: 'ArrowLeft' });
  expect(totalsTab('Phe thứ 3')).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(totalsTab('Phe thứ 3'), { key: 'ArrowRight' });
  expect(totalsTab('Cả 3 phe')).toHaveAttribute('aria-selected', 'true');
  // Chỉ tab đang chọn nằm trong thứ tự Tab của bàn phím.
  expect(totalsTab('Cả 3 phe')).not.toHaveAttribute('tabindex', '-1');
  expect(totalsTab('Vịt')).toHaveAttribute('tabindex', '-1');
});

test('Tổng điểm theo phe: my row is highlighted with a screen-reader "(bạn)"; outside the top 20 a "Hạng của bạn" line is added; no points → nothing', async () => {
  stubFetch({}, totals);
  renderAt('/bang-xep-hang');
  await findBoard();

  // "Cả 3 phe": tôi ở hạng 2 trong top → dòng tô sáng, không thêm dòng "Hạng của bạn".
  const all = await within(screen.getByRole('tabpanel')).findAllByRole('listitem');
  const mine = all[1] as HTMLElement;
  expect(mine).toHaveTextContent('Tôi');
  expect(mine).toHaveAttribute('aria-current', 'true');
  expect(within(mine).getByText('(bạn)')).toHaveClass('sr-only');
  expect(all[0]).not.toHaveAttribute('aria-current');
  expect(within(all[0] as HTMLElement).queryByText('(bạn)')).toBeNull();
  expect(screen.queryByText(/Hạng của bạn/)).toBeNull();

  // Phe thứ 3: tôi hạng 22, ngoài top 20 → không dòng nào tô sáng, thêm "Hạng của bạn: #22 · 1 điểm".
  fireEvent.click(totalsTab('Phe thứ 3'));
  expect(totalsItems()).toHaveLength(20);
  expect(totalsItems().some((item) => item.getAttribute('aria-current') === 'true')).toBe(false);
  expect(screen.getByText('Hạng của bạn: #22 · 1 điểm')).toBeInTheDocument();

  // Vịt: tôi không có điểm → không tô sáng, không thêm gì.
  fireEvent.click(totalsTab('Vịt'));
  expect(totalsItems()).toHaveLength(2);
  expect(screen.queryByText(/Hạng của bạn/)).toBeNull();
  expect(screen.queryByText('(bạn)')).toBeNull();
});

test('Tổng điểm theo phe: an empty board shows its own empty copy, and the season select reloads the totals', async () => {
  const fetchMock = stubFetch({}, totals);
  renderAt('/bang-xep-hang?mua=2026-09');
  // Role Ngỗng chưa có ai mùa 9 nên không chờ bảng theo role; chờ bảng tổng điểm.
  expect(await within(await screen.findByRole('tabpanel')).findAllByRole('listitem')).toHaveLength(1);

  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard/totals?season=2026-09', expect.anything());
  expect(fetchMock).not.toHaveBeenCalledWith('/api/leaderboard/totals?season=2026-10', expect.anything());
  fireEvent.click(totalsTab('Ngỗng'));
  expect(within(screen.getByRole('tabpanel')).queryByRole('list')).toBeNull();
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Chưa có ai có điểm trong mùa này');

  // Đổi mùa ở đầu trang: gọi lại API với mùa mới, tab đang chọn giữ nguyên, bảng Ngỗng của mùa 10 có hai dòng.
  pickSeason('Tháng 10/2026');
  expect(await within(screen.getByRole('tabpanel')).findByRole('list')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard/totals?season=2026-10', expect.anything());
  expect(totalsTab('Ngỗng')).toHaveAttribute('aria-selected', 'true');
  expect(totalsItems()).toHaveLength(2);
  expect(totalsItems()[0]).toHaveTextContent('Tôi');
  expect(totalsItems()[0]).toHaveAttribute('aria-current', 'true');
});

test('switching season keeps the old board dimmed with aria-busy until the new one arrives; the season label changes at once', async () => {
  // Bảng mùa 2026-09 của Ngỗng treo cho tới khi test cho phép.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const base = stubFetch();
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/leaderboard?roleId=1&season=2026-09&limit=50') await gate;
    return base(input);
  });
  vi.stubGlobal('fetch', fetchMock);
  renderAt('/bang-xep-hang');
  await findBoard();
  expect(boardItems()).toHaveLength(2);

  pickSeason('Tháng 9/2026 (đã chốt)');
  // Tiêu đề mùa đổi ngay, bảng cũ vẫn đứng (không nháy trống) nhưng khối đó báo bận.
  expect(screen.getByText('Tháng 9/2026')).toBeInTheDocument();
  const busyBlock = screen.getByRole('list', { name: 'Mọi hạng' }).closest('.query-block');
  expect(busyBlock).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText('Chưa có ai khai điểm mùa này')).not.toBeInTheDocument();

  release();
  // Mùa 9 của Ngỗng không có ai: bảng cũ nhường chỗ cho câu trống, hết bận.
  expect(await screen.findByText('Chưa có ai khai điểm mùa này')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Mọi hạng' })).not.toBeInTheDocument();
  expect(document.querySelector('.query-block[aria-busy="true"]')).toBeNull();
});
