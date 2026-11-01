import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReportDto, RoleDto, RoundDto, SessionDto, SessionRoundsDto } from '../../src/shared/api-types';
import { ReportPage } from '../../src/web/pages/ReportPage';
import { roundSessionsToShow } from '../../src/web/pages/RoundSessions';

/** 21:00 giờ VN ngày 2/11/2026: mùa luật ván, buổi 20:00 hôm nay đã bắt đầu. */
const NOW = new Date('2026-11-02T21:00:00+07:00');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(NOW);

const roles: RoleDto[] = [
  {
    id: 61,
    key: 'swordsman',
    faction: 'duck',
    nameVi: 'Kiếm sĩ',
    nameEn: 'Swordsman',
    icon: '⚔️',
    metricLabel: 'Số mạng chém',
    maxPerGame: 15,
    description: '',
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
    sortOrder: 1,
  },
];

const session = (id: number, startsAt: string, over: Partial<SessionDto> = {}): SessionDto => ({
  id,
  startsAt,
  modeName: 'Cổ điển (Classic)',
  capacity: 16,
  roomCode: null,
  note: null,
  status: 'ended',
  attendees: [],
  myStatus: null,
  ...over,
});

// Hôm nay 2/11: buổi 20:00 (đã bắt đầu, mặc định) và 23:00 (chưa tới giờ, ẩn); 1/11: buổi 19:00; 31/10 thuộc mùa cũ (ẩn).
const today20 = session(7, '2026-11-02T13:00:00.000Z');
const today23 = session(8, '2026-11-02T16:00:00.000Z', { status: 'scheduled' });
const yesterday = session(6, '2026-11-01T12:00:00.000Z');
const cancelled = session(5, '2026-11-01T14:00:00.000Z', { status: 'cancelled' });
const october = session(4, '2026-10-31T12:00:00.000Z');

const round = (id: number, sessionId: number, number: number, over: Partial<RoundDto> = {}): RoundDto => ({
  id,
  sessionId,
  number,
  winnerFaction: null,
  winnerIds: [],
  imageUrl: `/api/rounds/${id}/image?v=1`,
  imageUpdatedAt: '2026-11-02T13:20:00.000Z',
  reports: [],
  ...over,
});

const reportRole: ReportDto['role'] = { id: 61, nameVi: 'Kiếm sĩ', icon: '⚔️', metricLabel: 'Số mạng chém', maxPerGame: 15, points: 1, extraMetricLabel: null, extraMaxPerGame: null, extraPoints: null, penaltyMetricLabel: null, penaltyMaxPerGame: null, penaltyPoints: null };
const roundReport = (over: Partial<ReportDto> = {}): ReportDto => ({
  id: 40,
  member: { id: 9, displayName: 'Tôi' },
  role: reportRole,
  value: 3,
  extraValue: 0,
  penaltyValue: 0,
  bonusPoints: 0,
  source: 'self',
  multiplier: 2,
  points: 7,
  playedOn: '2026-11-02',
  sessionId: 7,
  note: null,
  status: 'approved',
  rejectReason: null,
  createdAt: '2026-11-02T13:30:00.000Z',
  highlightUrl: null,
  accusation: null,
  accusationDuplicate: false,
  accusationWaitingFor: null,
  penaltyOf: null,
  round: { id: 101, number: 1, sessionId: 7, winnerFaction: 'duck', won: true },
  ...over,
});

const rounds7: SessionRoundsDto = {
  session: { id: 7, startsAt: today20.startsAt, modeName: today20.modeName, status: 'ended' },
  rounds: [
    round(101, 7, 1, {
      winnerFaction: 'duck',
      reports: [{ id: 40, member: { id: 9, displayName: 'Tôi', avatarUrl: null }, role: { id: 61, nameVi: 'Kiếm sĩ', icon: '⚔️', faction: 'duck' }, status: 'approved', won: true, mine: roundReport() }],
    }),
    round(102, 7, 2),
  ],
};
const rounds6: SessionRoundsDto = { session: { id: 6, startsAt: yesterday.startsAt, modeName: yesterday.modeName, status: 'ended' }, rounds: [] };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Handler = (init: RequestInit | undefined, url: string) => Response | Promise<Response>;

function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('?')[0] ?? url;
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Không có tuyến giả cho ${key}`);
    return Promise.resolve(handler(init, url));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const byDate: Record<string, SessionDto[]> = {
  '2026-11-02': [today23, today20],
  '2026-11-01': [yesterday, cancelled],
  '2026-10-31': [october],
  '2026-10-30': [],
};

const baseRoutes = (mine: ReportDto[] = []): Record<string, Handler> => ({
  'GET /api/roles': () => json(200, roles),
  'GET /api/reports/mine': () => json(200, mine),
  'GET /api/reports/highlight-config': () => json(200, { enabled: false, maxBytes: 0 }),
  'GET /api/bounty-claims/mine': () => json(200, []),
  'GET /api/multiplier-days/upcoming': () => json(200, []),
  'GET /api/sessions': (_init, url) => json(200, byDate[new URL(url, 'http://x').searchParams.get('date') ?? ''] ?? []),
  'GET /api/sessions/7/rounds': () => json(200, rounds7),
  'GET /api/sessions/6/rounds': () => json(200, rounds6),
});

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('picking sessions: default first, then started ones newest first; no cancelled, future or old-season sessions', () => {
  expect(roundSessionsToShow([october, yesterday, cancelled, today23, today20], NOW).map((s) => s.id)).toEqual([7, 6]);
  // Trước 6:00 sáng: buổi mặc định là buổi của hôm qua.
  expect(roundSessionsToShow([yesterday, today20], new Date('2026-11-03T05:00:00+07:00')).map((s) => s.id)).toEqual([7, 6]);
});

test('the new season replaces the day form with sessions and their rounds', async () => {
  stubFetch(baseRoutes());
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Khai theo ván' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Khai một trận' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Ngày chơi')).not.toBeInTheDocument();

  const list = await screen.findByRole('list', { name: 'Buổi chơi gần đây' });
  const blocks = within(list).getAllByRole('region');
  expect(blocks.map((b) => b.getAttribute('aria-label'))).toEqual(['Buổi 20:00 02/11', 'Buổi 19:00 01/11']);

  const first = blocks[0] as HTMLElement;
  const rows = within(await within(first).findByRole('list', { name: 'Các ván Buổi 20:00 02/11' })).getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent('Ván 1');
  expect(rows[0]).toHaveTextContent('🦆 Vịt thắng');
  expect(rows[0]).toHaveTextContent('Đã khai: ⚔️ Kiếm sĩ');
  expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Xem ván 1' })).toHaveAttribute('href', '/buoi/7#van-1');
  expect(rows[1]).toHaveTextContent('Chưa chọn phe thắng');

  // "Khai" mở form ngay dưới ván.
  fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'Khai ván 2' }));
  expect(within(rows[1] as HTMLElement).getByRole('form', { name: 'Khai role ván 2' })).toBeInTheDocument();

  expect(await within(blocks[1] as HTMLElement).findByText('Buổi này chưa có ảnh ván, chờ mod up')).toBeInTheDocument();
});

test('"Lần khai của tôi" labels a round report with its session, round and win/lose chip', async () => {
  stubFetch(baseRoutes([roundReport(), roundReport({ id: 41, multiplier: 2, round: { id: 102, number: 2, sessionId: 7, winnerFaction: 'goose', won: false } }), roundReport({ id: 42, round: { id: 103, number: 3, sessionId: 7, winnerFaction: null, won: false } })]));
  renderPage();

  const heading = await screen.findByRole('heading', { name: 'Lần khai của tôi' });
  const section = heading.closest('section') as HTMLElement;
  await waitFor(() => expect(within(section).getAllByText(/^Buổi 20:00 02\/11 · Ván/)).toHaveLength(3));
  const items = within(section).getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('Buổi 20:00 02/11 · Ván 1');
  expect(within(items[0] as HTMLElement).getByText('Thắng')).toBeInTheDocument();
  expect(within(items[0] as HTMLElement).getByText('×2')).toBeInTheDocument();
  // Ván thua: chip "Thua" và không có chip ×m.
  expect(within(items[1] as HTMLElement).getByText('Thua')).toBeInTheDocument();
  expect(within(items[1] as HTMLElement).queryByText('×2')).not.toBeInTheDocument();
  expect(within(items[2] as HTMLElement).getByText('Chưa có phe thắng')).toBeInTheDocument();
});

test('editing a pending round report never sends the day', async () => {
  const pending = roundReport({ status: 'pending' });
  const fetchMock = stubFetch({ ...baseRoutes([pending]), 'PATCH /api/reports/40': () => json(200, { ...pending, value: 4 }) });
  renderPage();

  const section = (await screen.findByRole('heading', { name: 'Lần khai của tôi' })).closest('section') as HTMLElement;
  fireEvent.click(await within(section).findByRole('button', { name: 'Sửa' }));
  expect(within(section).queryByLabelText('Ngày chơi')).not.toBeInTheDocument();
  fireEvent.change(within(section).getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '4' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(true));
  const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
  expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ value: 4, note: null });
});
