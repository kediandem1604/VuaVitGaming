import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { BadgeDto, PublicMemberDto } from '../../src/shared/api-types';
import { memberPath } from '../../src/web/lib/links';
import { MemberPage } from '../../src/web/pages/MemberPage';

const badge = (id: number, awardedAt: string, over: Partial<BadgeDto> = {}): BadgeDto => ({
  id,
  badgeKey: 'smvp',
  kind: 'monthly',
  periodId: '2026-10',
  title: 'SMVP tháng 10/2026',
  icon: '👑',
  detail: '7 lần MVP',
  awardedAt,
  member: { id: 7, displayName: 'Ngỗng Bảy', avatarUrl: null },
  ...over,
});

// 17:30Z ngày 21/10 là 00:30 ngày 22/10 ở Việt Nam: ngày vào server phải là 22/10.
const active: PublicMemberDto = {
  id: 7,
  displayName: 'Ngỗng Bảy',
  avatarUrl: null,
  joinedAt: '2026-10-21T17:30:00.000Z',
  left: false,
  badges: [
    badge(12, '2026-11-10T03:00:00.000Z', { badgeKey: 'games_50', kind: 'milestone', periodId: '', title: 'Lão làng', icon: '🏅', detail: 'Đã đi 50 trận' }),
    badge(11, '2026-11-03T17:05:00.000Z'),
  ],
};

const gone: PublicMemberDto = {
  id: 8,
  displayName: 'Vịt Tám',
  avatarUrl: 'https://cdn.example/8.png',
  joinedAt: '2026-01-05T03:00:00.000Z',
  left: true,
  badges: [],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const notFound = () => json(404, { error: { code: 'NOT_FOUND', message: 'Không tìm thấy thành viên' } });

function stubFetch(members: Record<string, PublicMemberDto>) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const match = /^\/api\/members\/(\d+)$/.exec(url);
    if (!match?.[1]) throw new Error(`Không có tuyến giả cho ${url}`);
    const found = members[match[1]];
    return Promise.resolve(found ? json(200, found) : notFound());
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderAt = (url: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="thanh-vien/:id" element={<MemberPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('memberPath builds the public member URL', () => {
  expect(memberPath(7)).toBe('/thanh-vien/7');
});

test('shows name, Vietnam join date and the badges newest first', async () => {
  const fetchMock = stubFetch({ '7': active });
  renderAt('/thanh-vien/7');

  expect(await screen.findByRole('heading', { level: 1, name: 'Ngỗng Bảy' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/members/7', expect.anything());
  expect(screen.getByText(/Vào server/)).toHaveTextContent('Vào server 22/10/2026');
  expect(screen.queryByText('Đã rời server')).toBeNull();

  const items = within(screen.getByRole('list', { name: 'Danh hiệu' })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  const [first, second] = items as [HTMLElement, HTMLElement];
  expect(first).toHaveTextContent('Lão làng');
  expect(first).toHaveTextContent('Đã đi 50 trận');
  expect(first.querySelector('[aria-hidden="true"]')).toHaveTextContent('🏅');
  // Ngày trao theo giờ Việt Nam: 17:05Z ngày 3/11 là ngày 4/11.
  expect(second).toHaveTextContent('SMVP tháng 10/2026');
  expect(second).toHaveTextContent('7 lần MVP');
  expect(second).toHaveTextContent('04/11/2026');
  // Trang đã là của người này: thẻ không lặp lại tên / link tới chính trang này.
  expect(within(first).queryByRole('link')).toBeNull();
  expect(within(second).queryByRole('link')).toBeNull();
});

test('a member who left is marked, and no badges shows the empty copy', async () => {
  stubFetch({ '8': gone });
  renderAt('/thanh-vien/8');

  expect(await screen.findByRole('heading', { level: 1, name: 'Vịt Tám' })).toBeInTheDocument();
  expect(screen.getByText('Đã rời server')).toBeInTheDocument();
  expect(screen.getByText(/Vào server/)).toHaveTextContent('Vào server 05/01/2026');
  expect(screen.getByText('Chưa có danh hiệu nào')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Danh hiệu' })).toBeNull();
});

test('an unknown id renders the not-found page', async () => {
  stubFetch({ '7': active });
  renderAt('/thanh-vien/999');

  expect(await screen.findByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Về trang Hôm nay' })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a malformed id renders the not-found page without calling the API', () => {
  const fetchMock = stubFetch({ '7': active });
  renderAt('/thanh-vien/abc');

  expect(screen.getByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a failed load shows the message and Thử lại recovers', async () => {
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      if (fail) return Promise.resolve(json(500, { error: { code: 'INTERNAL', message: 'Có lỗi xảy ra, thử lại sau' } }));
      return Promise.resolve(json(200, active));
    }),
  );
  renderAt('/thanh-vien/7');

  expect(await screen.findByRole('alert')).toHaveTextContent('Có lỗi xảy ra, thử lại sau');
  expect(screen.queryByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Ngỗng Bảy' })).toBeInTheDocument();
});
