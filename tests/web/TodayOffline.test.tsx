import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { HallOfDayDto, MeDto, OfflineEventDto, OfflinePersonDto, SessionDto } from '../../src/shared/api-types';
import { TodayPage } from '../../src/web/pages/TodayPage';

const member: MeDto = {
  id: 9,
  memberCode: 'GGD-0009',
  displayName: 'Tôi',
  avatarUrl: null,
  email: null,
  notifyEmail: false,
  notifyDm: true,
  accessLevel: 'member',
};

const person = (memberId: number, displayName: string): OfflinePersonDto => ({ memberId, displayName, avatarUrl: null });
const many = (n: number, from = 100) => Array.from({ length: n }, (_, i) => person(from + i, `Người ${i + 1}`));

const event = (over: Partial<OfflineEventDto> = {}): OfflineEventDto => ({
  id: 1,
  title: 'Cafe Ngỗng',
  // 18:30 Thứ Bảy 24/10 giờ VN.
  startsAt: '2026-10-24T11:30:00.000Z',
  place: 'Quận 1',
  description: 'Mang bài theo',
  voteDeadline: null,
  closed: false,
  open: true,
  going: [person(1, 'An'), person(2, 'Bình')],
  notGoing: [person(3, 'Chi')],
  myVote: null,
  ...over,
});

const session: SessionDto = {
  id: 5,
  startsAt: '2026-10-22T12:00:00.000Z',
  modeName: 'Cổ điển',
  capacity: 16,
  roomCode: null,
  note: null,
  status: 'scheduled',
  attendees: [],
  myStatus: null,
  roundCount: 0,
};
const emptyHall: HallOfDayDto = { date: '2026-10-22', sessions: [] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

function stubFetch(routes: Record<string, Handler>) {
  const all: Record<string, Handler> = {
    'GET /api/sessions': () => json(200, [session]),
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
    'GET /api/sessions/5/bounties': () => json(200, { sessionId: 5, open: true, bounties: [], myClaims: [] }),
    ...routes,
  };
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    const handler = all[key];
    if (!handler) throw new Error(`Không có tuyến giả cho ${key}`);
    return Promise.resolve(handler(init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={member} />}>
            <Route path="/" element={<TodayPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
};

const card = (title = 'Cafe Ngỗng') => screen.findByRole('region', { name: `🎉 Offline: ${title}` });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('the offline card sits right below the sessions block, nearest event first, with time, place and description', async () => {
  stubFetch({
    'GET /api/offline-events/upcoming': () =>
      json(200, [event(), event({ id: 2, title: 'BBQ', startsAt: '2026-11-01T03:00:00.000Z', description: null, going: [], notGoing: [] })]),
  });
  renderPage();
  const first = await card();
  expect(within(first).getByText('Thứ Bảy, 24/10 lúc 18:30')).toBeInTheDocument();
  expect(within(first).getByText('📍 Quận 1')).toBeInTheDocument();
  expect(within(first).getByText('Mang bài theo')).toBeInTheDocument();
  expect(within(first).getByRole('button', { name: '2 người đi được' })).toBeInTheDocument();
  expect(within(first).getByRole('button', { name: 'Mình đi được' })).toHaveAttribute('aria-pressed', 'false');
  expect(within(first).getByRole('button', { name: 'Không đi được' })).toHaveAttribute('aria-pressed', 'false');
  const second = await card('BBQ');
  expect(within(second).getByText('Chủ Nhật, 01/11 lúc 10:00')).toBeInTheDocument();

  // Thứ tự trong trang: Buổi chơi → thẻ offline (theo thứ tự server) → Sảnh tri ân.
  const sessionsHeading = screen.getByRole('heading', { level: 2, name: 'Buổi chơi hôm nay' });
  const hallHeading = screen.getByRole('heading', { level: 2, name: 'Sảnh tri ân hôm nay' });
  const follows = (x: Node, y: Node) => Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(follows(sessionsHeading, first)).toBe(true);
  expect(follows(first, second)).toBe(true);
  expect(follows(second, hallHeading)).toBe(true);
});

test('no upcoming events (or a failed load) draws nothing', async () => {
  stubFetch({ 'GET /api/offline-events/upcoming': () => json(500, { error: { code: 'X', message: 'Lỗi' } }) });
  renderPage();
  await screen.findByRole('heading', { level: 2, name: 'Buổi chơi hôm nay' });
  await waitFor(() => expect(screen.queryByText(/🎉 Offline/)).not.toBeInTheDocument());
});

test('voting is optimistic: the button and count change before the server answers, then take the server card', async () => {
  let resolve: (r: Response) => void = () => undefined;
  const fetchMock = stubFetch({
    'GET /api/offline-events/upcoming': () => json(200, [event()]),
    'PUT /api/offline-events/1/vote': () => new Promise<Response>((r) => (resolve = r)),
  });
  renderPage();
  const c = await card();
  fireEvent.click(within(c).getByRole('button', { name: 'Mình đi được' }));

  // Chưa có hồi âm: nút đã sáng, số người đã +1.
  expect(await within(c).findByRole('button', { name: '3 người đi được' })).toBeInTheDocument();
  expect(within(c).getByRole('button', { name: 'Mình đi được' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(c).getByRole('img', { name: 'Tôi' })).toBeInTheDocument();
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({ going: true });

  resolve(json(200, event({ myVote: true, going: [person(1, 'An'), person(2, 'Bình'), person(9, 'Tôi'), person(4, 'Dũng')] })));
  expect(await within(c).findByRole('button', { name: '4 người đi được' })).toBeInTheDocument();

  // Đổi ý: bấm nút kia.
  fireEvent.click(within(c).getByRole('button', { name: 'Không đi được' }));
  expect(await within(c).findByRole('button', { name: '3 người đi được' })).toBeInTheDocument();
  expect(within(c).getByRole('button', { name: 'Không đi được' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(c).getByRole('button', { name: 'Mình đi được' })).toHaveAttribute('aria-pressed', 'false');
});

test('a refused vote rolls back, shows the server message and reloads the list', async () => {
  const fetchMock = stubFetch({
    'GET /api/offline-events/upcoming': () => json(200, [event()]),
    'PUT /api/offline-events/1/vote': () => json(409, { error: { code: 'OFFLINE_VOTE_CLOSED', message: 'Đã hết hạn vote' } }),
  });
  renderPage();
  const c = await card();
  fireEvent.click(within(c).getByRole('button', { name: 'Mình đi được' }));
  expect(await within(c).findByRole('alert')).toHaveTextContent('Đã hết hạn vote');
  expect(within(c).getByRole('button', { name: '2 người đi được' })).toBeInTheDocument();
  expect(within(c).getByRole('button', { name: 'Mình đi được' })).toHaveAttribute('aria-pressed', 'false');
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/offline-events/upcoming')).toHaveLength(2));
});

test('closed or past the deadline: no buttons, "Đã chốt danh sách"', async () => {
  stubFetch({ 'GET /api/offline-events/upcoming': () => json(200, [event({ open: false, myVote: true })]) });
  renderPage();
  const c = await card();
  expect(within(c).getByText('Đã chốt danh sách')).toBeInTheDocument();
  expect(within(c).queryByRole('button', { name: 'Mình đi được' })).not.toBeInTheDocument();
  expect(within(c).queryByRole('button', { name: 'Không đi được' })).not.toBeInTheDocument();
});

test('at most 12 avatars then "+k"; the count opens both name lists', async () => {
  stubFetch({ 'GET /api/offline-events/upcoming': () => json(200, [event({ going: many(15), notGoing: [person(3, 'Chi')] })]) });
  renderPage();
  const c = await card();
  expect(within(c).getAllByRole('img')).toHaveLength(12);
  expect(within(c).getByText('+3')).toBeInTheDocument();

  fireEvent.click(within(c).getByRole('button', { name: '15 người đi được' }));
  const dialog = await screen.findByRole('dialog', { name: 'Cafe Ngỗng' });
  expect(within(dialog).getByRole('heading', { name: 'Đi được (15)' })).toBeInTheDocument();
  expect(within(dialog).getByRole('heading', { name: 'Không đi được (1)' })).toBeInTheDocument();
  expect(within(dialog).getByText('Người 15')).toBeInTheDocument();
  expect(within(dialog).getByText('Chi')).toBeInTheDocument();
});
