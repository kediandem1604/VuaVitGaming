import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { HallDto, HallRoleDto, RoleDto, SeasonDto } from '../../src/shared/api-types';
import { HallPage } from '../../src/web/pages/HallPage';

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

const goose = role({ id: 1, key: 'goose', faction: 'goose', nameVi: 'Ngỗng', icon: '🪿', metricLabel: 'Số lần vote trúng Vịt' });
const medium = role({ id: 3, key: 'medium', faction: 'goose', nameVi: 'Thầy đồng', icon: '🔮', metricLabel: 'Số xác ẩn được bạn phát hiện' });
const swordsman = role({
  id: 61,
  key: 'swordsman',
  faction: 'duck',
  nameVi: 'Kiếm sĩ',
  icon: '⚔️',
  metricLabel: 'Số mạng chém',
  mapNote: 'Có từ v4.10 (08/2026)',
});
const dodo = role({ id: 70, key: 'dodo', faction: 'neutral', nameVi: 'Chim đa đa', icon: '🦤', metricLabel: 'Số trận thắng (bị vote ra)' });
// Role của chế độ đặc biệt: phe Ngỗng nhưng phải nằm ở tab riêng, không lẫn vào Phe Ngỗng.
const inquisitor = role({ id: 80, key: 'inquisitor', faction: 'goose', nameVi: 'Thanh tra', icon: '🪿', metricLabel: 'Điểm', modeKey: 'corruption' });

const mainRoles: HallRoleDto[] = [
  { role: goose, holder: { memberId: 1, displayName: 'Ngỗng Một', score: 7 }, previous: null },
  { role: medium, holder: null, previous: null },
  { role: swordsman, holder: null, previous: { memberId: 2, displayName: 'Vịt Hai', score: 12, seasonId: '2026-09' } },
  { role: dodo, holder: { memberId: 3, displayName: 'Ngỗng Ba', score: 1 }, previous: null },
];

const specialEntry: HallRoleDto = { role: inquisitor, holder: { memberId: 4, displayName: 'Vịt Bốn', score: 2 }, previous: null };

const seasons: SeasonDto[] = [
  { id: '2026-10', closed: false },
  { id: '2026-09', closed: true },
];

const halls: Record<string, HallDto> = {
  '2026-10': { seasonId: '2026-10', closed: false, roles: mainRoles },
  '2026-09': {
    seasonId: '2026-09',
    closed: true,
    roles: [
      { role: goose, holder: null, previous: null },
      { role: medium, holder: null, previous: null },
      { role: swordsman, holder: { memberId: 2, displayName: 'Vịt Hai', score: 12 }, previous: null },
      { role: dodo, holder: null, previous: null },
    ],
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(hallBySeason: Record<string, HallDto> = halls) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/seasons') return Promise.resolve(json(200, seasons));
    const match = /^\/api\/hall\?season=(\d{4}-\d{2})$/.exec(url);
    const hall = match?.[1] ? hallBySeason[match[1]] : undefined;
    if (hall) return Promise.resolve(json(200, hall));
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
        <HallPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const characters = () => screen.queryAllByRole('img').map((node) => node.getAttribute('aria-label'));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('defaults to the newest season and the goose tab, showing only goose main roles', async () => {
  const fetchMock = stubFetch();
  renderAt('/dai-sanh');

  expect(screen.getByRole('heading', { level: 1, name: 'Đại sảnh hoá thân' })).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: 'Ngỗng: Ngỗng Một' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/hall?season=2026-10', expect.anything());
  // Nhãn mùa trong đầu trang (ô chọn mùa cũng có một <option> cùng chữ).
  expect(screen.getByText('Tháng 10/2026', { selector: 'span' })).toBeInTheDocument();
  expect(screen.queryByText('Mùa đã chốt')).not.toBeInTheDocument();

  expect(screen.getByRole('button', { name: 'Phe Ngỗng' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Phe Vịt' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Phe thứ 3' })).toHaveAttribute('aria-pressed', 'false');
  // Không có role chế độ đặc biệt đang bật → không có tab đó.
  expect(screen.queryByRole('button', { name: 'Chế độ đặc biệt' })).not.toBeInTheDocument();

  expect(characters()).toEqual(['Ngỗng: Ngỗng Một', 'Thầy đồng: Chưa ai hoá thân']);

  // Ô có người giữ: điểm + tên chỉ số; ô trống thì không có dòng điểm.
  const gooseCard = screen.getByRole('link', { name: /Ngỗng: Ngỗng Một/ });
  expect(gooseCard).toHaveTextContent('7 Số lần vote trúng Vịt');
  expect(gooseCard).toHaveAttribute('href', '/bang-xep-hang?role=1&mua=2026-10');
  expect(screen.getByRole('link', { name: /Thầy đồng/ })).not.toHaveTextContent('Số xác');
});

test('switching to Phe Vịt shows duck roles, with the previous holder marked', async () => {
  stubFetch();
  renderAt('/dai-sanh');
  await screen.findByRole('img', { name: 'Ngỗng: Ngỗng Một' });

  fireEvent.click(screen.getByRole('button', { name: 'Phe Vịt' }));

  expect(screen.getByRole('button', { name: 'Phe Vịt' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Phe Ngỗng' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByTestId('location')).toHaveTextContent('/dai-sanh?phe=duck');
  expect(characters()).toEqual(['Kiếm sĩ: Vịt Hai (mùa trước)']);

  const card = screen.getByRole('link', { name: /Kiếm sĩ/ });
  expect(within(card).getByText('Mùa trước')).toBeInTheDocument();
  expect(card).toHaveTextContent('12 Số mạng chém');
  expect(card).toHaveTextContent('mùa trước');
  expect(card).toHaveTextContent('Có từ v4.10 (08/2026)');
  expect(card).toHaveAttribute('href', '/bang-xep-hang?role=61&mua=2026-10');
});

test('the special-mode tab appears only when such roles exist and keeps them out of the faction tabs', async () => {
  stubFetch({ '2026-10': { seasonId: '2026-10', closed: false, roles: [...mainRoles, specialEntry] } });
  renderAt('/dai-sanh');
  await screen.findByRole('img', { name: 'Ngỗng: Ngỗng Một' });

  // Thanh tra là phe Ngỗng nhưng thuộc chế độ đặc biệt → không nằm trong tab Phe Ngỗng.
  expect(characters()).toEqual(['Ngỗng: Ngỗng Một', 'Thầy đồng: Chưa ai hoá thân']);

  fireEvent.click(screen.getByRole('button', { name: 'Chế độ đặc biệt' }));
  expect(screen.getByRole('button', { name: 'Chế độ đặc biệt' })).toHaveAttribute('aria-pressed', 'true');
  expect(characters()).toEqual(['Thanh tra: Vịt Bốn']);
  expect(screen.getByTestId('location')).toHaveTextContent('/dai-sanh?phe=special');
});

test('?mua= and ?phe= select a closed season and a tab', async () => {
  const fetchMock = stubFetch();
  renderAt('/dai-sanh?mua=2026-09&phe=neutral');

  expect(await screen.findByRole('img', { name: 'Chim đa đa: Chưa ai hoá thân' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/hall?season=2026-09', expect.anything());
  expect(fetchMock).not.toHaveBeenCalledWith('/api/hall?season=2026-10', expect.anything());
  expect(screen.getByText('Tháng 9/2026', { selector: 'span' })).toBeInTheDocument();
  expect(screen.getByText('Mùa đã chốt')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Mùa' })).toHaveValue('2026-09');
  expect(screen.getByRole('option', { name: 'Tháng 9/2026 (đã chốt)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Phe thứ 3' })).toHaveAttribute('aria-pressed', 'true');
});

test('invalid ?mua= and ?phe= fall back to defaults and are never sent to the API', async () => {
  const fetchMock = stubFetch();
  renderAt('/dai-sanh?mua=2030-01&phe=xyz');

  expect(await screen.findByRole('img', { name: 'Ngỗng: Ngỗng Một' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/hall?season=2026-10', expect.anything());
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('2030-01'), expect.anything());
  expect(screen.getByRole('button', { name: 'Phe Ngỗng' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('combobox', { name: 'Mùa' })).toHaveValue('2026-10');
});

test('?phe=special falls back to goose when no special-mode role exists', async () => {
  stubFetch();
  renderAt('/dai-sanh?phe=special');
  expect(await screen.findByRole('img', { name: 'Ngỗng: Ngỗng Một' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Phe Ngỗng' })).toHaveAttribute('aria-pressed', 'true');
});

test('choosing a season in the select updates the URL and reloads the hall', async () => {
  const fetchMock = stubFetch();
  renderAt('/dai-sanh?phe=duck');
  await screen.findByRole('img', { name: 'Kiếm sĩ: Vịt Hai (mùa trước)' });

  fireEvent.change(screen.getByRole('combobox', { name: 'Mùa' }), { target: { value: '2026-09' } });

  expect(await screen.findByRole('img', { name: 'Kiếm sĩ: Vịt Hai' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/hall?season=2026-09', expect.anything());
  expect(screen.getByTestId('location')).toHaveTextContent('/dai-sanh?phe=duck&mua=2026-09');
  expect(screen.getByText('Mùa đã chốt')).toBeInTheDocument();
  // Vẫn ở tab Phe Vịt; link ô dẫn tới mùa đang xem.
  expect(screen.getByRole('button', { name: 'Phe Vịt' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('link', { name: /Kiếm sĩ/ })).toHaveAttribute('href', '/bang-xep-hang?role=61&mua=2026-09');
});

test('a failed hall load shows the message and Thử lại recovers', async () => {
  let fail = true;
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/seasons') return Promise.resolve(json(200, seasons));
    if (fail) return Promise.resolve(json(500, { error: { code: 'INTERNAL', message: 'Có lỗi xảy ra, thử lại sau' } }));
    return Promise.resolve(json(200, halls['2026-10']));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderAt('/dai-sanh');

  expect(await screen.findByRole('alert')).toHaveTextContent('Có lỗi xảy ra, thử lại sau');
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('img', { name: 'Ngỗng: Ngỗng Một' })).toBeInTheDocument();
});
