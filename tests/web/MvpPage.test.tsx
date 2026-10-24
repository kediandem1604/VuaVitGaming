import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { HallOfDayDto } from '../../src/shared/api-types';
import { vnTodayIso } from '../../src/web/lib/format';
import { MvpPage } from '../../src/web/pages/MvpPage';

const halls: Record<string, HallOfDayDto> = {
  '2026-10-22': {
    date: '2026-10-22',
    sessions: [
      {
        sessionId: 7,
        label: 'Cổ điển 21:00',
        awards: [{ categoryName: 'Giết nhiều nhất', winners: [{ memberId: 1, displayName: 'Ngỗng Một', avatarUrl: null, voteCount: 2 }] }],
      },
    ],
  },
  '2026-10-20': {
    date: '2026-10-20',
    sessions: [
      {
        sessionId: 5,
        label: 'Săn ngỗng 20:00',
        awards: [{ categoryName: 'Ngỗng chạy giỏi nhất', winners: [{ memberId: 2, displayName: 'Vịt Hai', avatarUrl: null, voteCount: 4 }] }],
      },
    ],
  },
  // Quá 30 ngày gần nhất: không có nút ngày, chỉ tới được bằng ô chọn ngày.
  '2026-08-15': {
    date: '2026-08-15',
    sessions: [
      {
        sessionId: 2,
        label: 'Đua nhiệm vụ 22:00',
        awards: [{ categoryName: 'Giết nhiều nhất', winners: [{ memberId: 3, displayName: 'Ngỗng Ba', avatarUrl: null, voteCount: 1 }] }],
      },
    ],
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(dates: string[]) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/mvp/dates') return Promise.resolve(json(200, dates));
    const match = /^\/api\/mvp\/day\?date=(\d{4}-\d{2}-\d{2})$/.exec(url);
    const hall = match?.[1] ? halls[match[1]] : undefined;
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
        <MvpPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('defaults to the newest date and lists the others as chips', async () => {
  const fetchMock = stubFetch(['2026-10-22', '2026-10-20']);
  renderAt('/tri-an');

  expect(screen.getByRole('heading', { level: 1, name: 'Tri ân' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 3, name: 'Cổ điển 21:00' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '22/10/2026' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '20/10/2026' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('heading', { level: 2, name: 'Thứ Năm, 22/10' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/mvp/day?date=2026-10-22', expect.anything());
});

test('?ngay= selects that date and clicking a chip updates the URL', async () => {
  stubFetch(['2026-10-22', '2026-10-20']);
  renderAt('/tri-an?ngay=2026-10-20');

  expect(await screen.findByRole('heading', { level: 3, name: 'Săn ngỗng 20:00' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '20/10/2026' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: '22/10/2026' }));
  expect(await screen.findByRole('heading', { level: 3, name: 'Cổ điển 21:00' })).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/tri-an?ngay=2026-10-22');
});

test('an invalid ?ngay= falls back to the newest date', async () => {
  const fetchMock = stubFetch(['2026-10-22']);
  renderAt('/tri-an?ngay=hom-qua');
  expect(await screen.findByRole('heading', { level: 3, name: 'Cổ điển 21:00' })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('hom-qua'), expect.anything());
});

test('no results at all shows the empty copy', async () => {
  stubFetch([]);
  renderAt('/tri-an');
  const copy = await screen.findByText('Chưa có kết quả tri ân nào');
  expect(copy.closest('.panel-inset')).not.toBeNull();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('date chips: the viewed day is the gold chip and the row scrolls inside itself', async () => {
  stubFetch(['2026-10-22', '2026-10-20']);
  renderAt('/tri-an');
  await screen.findByRole('heading', { level: 3, name: 'Cổ điển 21:00' });

  expect(screen.getByRole('group', { name: 'Chọn ngày' }).className.split(' ')).toContain('overflow-x-auto');
  const active = screen.getByRole('button', { name: '22/10/2026' }).className.split(' ');
  const idle = screen.getByRole('button', { name: '20/10/2026' }).className.split(' ');
  expect(active).toEqual(expect.arrayContaining(['chip', 'bg-gold', 'text-gold-ink']));
  expect(idle).toContain('chip');
  expect(idle).not.toContain('bg-gold');
});

test('a date picker reaches any past day (up to today) and keeps it in ?ngay=', async () => {
  stubFetch(['2026-10-22', '2026-10-20']);
  renderAt('/tri-an');
  await screen.findByRole('heading', { level: 3, name: 'Cổ điển 21:00' });

  const picker = screen.getByLabelText('Chọn ngày khác');
  expect(picker).toHaveAttribute('type', 'date');
  expect(picker).toHaveAttribute('max', vnTodayIso());
  expect(picker).toHaveValue('2026-10-22');

  fireEvent.change(picker, { target: { value: '2026-08-15' } });
  expect(await screen.findByRole('heading', { level: 3, name: 'Đua nhiệm vụ 22:00' })).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/tri-an?ngay=2026-08-15');
  expect(screen.getByRole('heading', { level: 2, name: 'Thứ Bảy, 15/08' })).toBeInTheDocument();
  expect(picker).toHaveValue('2026-08-15');
  // Không nút ngày nào đang chọn (ngày đó không nằm trong danh sách gần đây).
  for (const chip of screen.getAllByRole('button')) expect(chip).toHaveAttribute('aria-pressed', 'false');

  // Xoá ô chọn ngày thì giữ nguyên ngày đang xem.
  fireEvent.change(picker, { target: { value: '' } });
  expect(screen.getByTestId('location')).toHaveTextContent('/tri-an?ngay=2026-08-15');
});

test('an impossible ?ngay= (2026-13-45, 2026-02-30) counts as no selection and never reaches the API', async () => {
  for (const bad of ['2026-13-45', '2026-02-30']) {
    const fetchMock = stubFetch(['2026-10-22']);
    renderAt(`/tri-an?ngay=${bad}`);
    expect(await screen.findByRole('heading', { level: 3, name: 'Cổ điển 21:00' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining(bad), expect.anything());
    cleanup();
    vi.unstubAllGlobals();
  }
});
