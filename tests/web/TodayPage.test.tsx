import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { BountyClaimDto, BountyDto, HallOfDayDto, MeDto, SessionAttendeeDto, SessionBountiesDto, SessionDto } from '../../src/shared/api-types';
import { MY_BOUNTY_CLAIMS_KEY, PENDING_BOUNTY_CLAIMS_KEY } from '../../src/web/lib/queryKeys';
import { TodayPage } from '../../src/web/pages/TodayPage';

const me: SessionAttendeeDto = { memberId: 9, displayName: 'Tôi', avatarUrl: null };
const a: SessionAttendeeDto = { memberId: 1, displayName: 'Ngỗng Một', avatarUrl: null };
const b: SessionAttendeeDto = { memberId: 2, displayName: 'Vịt Hai', avatarUrl: null };
const c: SessionAttendeeDto = { memberId: 3, displayName: 'Ngỗng Ba', avatarUrl: null };
const d: SessionAttendeeDto = { memberId: 4, displayName: 'Vịt Bốn', avatarUrl: null };

const base: Omit<SessionDto, 'id' | 'startsAt' | 'attendees'> = {
  modeName: 'Cổ điển',
  capacity: 16,
  roomCode: null,
  note: null,
  status: 'scheduled',
  myStatus: null,
};

// Trả về theo thứ tự ngược giờ để kiểm tra trang tự sắp xếp theo startsAt.
const sessions: SessionDto[] = [
  { ...base, id: 2, startsAt: '2026-10-22T14:00:00.000Z', attendees: [a, c] },
  { ...base, id: 1, startsAt: '2026-10-22T12:00:00.000Z', attendees: [a, b] },
  // Buổi đã huỷ: người của nó không tính vào tổng ngày.
  { ...base, id: 3, startsAt: '2026-10-22T16:00:00.000Z', status: 'cancelled', attendees: [d] },
];

const emptyHall: HallOfDayDto = { date: '2026-10-22', sessions: [] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (init: RequestInit | undefined, url: string) => Response | Promise<Response>;

/** Thẻ treo thưởng của buổi: test không tả gì thì buổi không có mục nào (không vẽ thẻ). */
const BOUNTIES_PATH = /^GET \/api\/sessions\/(\d+)\/bounties$/;
const noBounties: Handler = (_init, url) => {
  const sessionId = Number(BOUNTIES_PATH.exec(`GET ${url.split('?')[0]}`)?.[1]);
  return json(200, { sessionId, open: true, bounties: [], myClaims: [] });
};

/** fetch giả định tuyến theo `METHOD path` (bỏ query string). */
function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('?')[0] ?? url;
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key] ?? (BOUNTIES_PATH.test(key) ? noBounties : undefined);
    if (!handler) throw new Error(`Không có tuyến giả cho ${key}`);
    return Promise.resolve(handler(init, url));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Người đang đăng nhập (Outlet context như trong App): nhắc qua cả email và Discord. */
const member: MeDto = {
  id: 9,
  memberCode: 'GGD-0009',
  displayName: 'Tôi',
  avatarUrl: null,
  email: 'toi@example.com',
  notifyEmail: true,
  notifyDm: true,
  accessLevel: 'member',
};

const renderPage = (me: MeDto = member) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={me} />}>
            <Route path="/" element={<TodayPage />} />
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
});

test('shows the day label, distinct attendee count, ordered sessions and empty hall copy', async () => {
  stubFetch({
    'GET /api/sessions': () => json(200, sessions),
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
  });
  renderPage();

  // a, b, c là ba người khác nhau; a có mặt hai buổi; d ở buổi đã huỷ.
  expect(await screen.findByText('3 người tham gia hôm nay')).toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 1, name: 'Thứ Năm, 22/10' })).toBeInTheDocument();

  const times = screen.getAllByText(/^\d{2}:\d{2}$/).map((el) => el.textContent);
  expect(times).toEqual(['19:00', '21:00', '23:00']);

  expect(screen.getByRole('heading', { level: 2, name: 'Sảnh tri ân hôm nay' })).toBeInTheDocument();
  expect(screen.getByText('Chưa có kết quả vote hôm nay')).toBeInTheDocument();
  expect(screen.getByText('Đã huỷ')).toBeInTheDocument();
});

test("each upcoming card's reminder line follows the signed-in member's own channels", async () => {
  // Buổi còn xa trong tương lai: chưa tới giờ nên dòng nhắc còn hiện.
  const upcoming: SessionDto = { ...base, id: 5, startsAt: '2099-01-01T12:00:00.000Z', attendees: [] };
  stubFetch({
    'GET /api/sessions': () => json(200, [upcoming]),
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
  });
  // Đã bật email nhưng chưa có địa chỉ → chỉ còn Discord.
  renderPage({ ...member, email: null });
  expect(await screen.findByText('Nhắc trước giờ chơi qua Discord')).toBeInTheDocument();
  cleanup();

  renderPage({ ...member, notifyEmail: false, notifyDm: false });
  expect(await screen.findByRole('link', { name: 'Hồ sơ' })).toHaveAttribute('href', '/ho-so');
});

test('an empty day says there are no sessions yet', async () => {
  stubFetch({
    'GET /api/sessions': () => json(200, []),
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
  });
  renderPage();
  const empty = await screen.findByText('Hôm nay chưa có buổi chơi nào');
  // Câu "chưa có" nằm trong ô EmptyState dùng chung (panel-inset + ngỗng trang trí).
  expect(empty.closest('.panel-inset')).not.toBeNull();
  expect(screen.getByText('0 người tham gia hôm nay')).toBeInTheDocument();
});

test('joining replaces that card with the returned session and updates the total', async () => {
  const joined: SessionDto = { ...base, id: 1, startsAt: '2026-10-22T12:00:00.000Z', attendees: [a, b, me], myStatus: 'going' };
  const fetchMock = stubFetch({
    'GET /api/sessions': () => json(200, sessions),
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
    'POST /api/sessions/1/attendance': (init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ going: true });
      return json(200, joined);
    },
  });
  renderPage();

  const joinButtons = await screen.findAllByRole('button', { name: 'Tham gia' });
  // Thẻ đầu là buổi 19:00 (id 1) sau khi sắp xếp.
  const firstCard = joinButtons[0]?.closest('article');
  expect(firstCard).not.toBeNull();
  expect(within(firstCard as HTMLElement).getByText('19:00')).toBeInTheDocument();
  expect(within(firstCard as HTMLElement).getByText('2/16 ghế đã có người')).toBeInTheDocument();

  fireEvent.click(joinButtons[0] as HTMLElement);

  expect(await within(firstCard as HTMLElement).findByRole('button', { name: 'Huỷ tham gia' })).toBeInTheDocument();
  expect(within(firstCard as HTMLElement).getByText('3/16 ghế đã có người')).toBeInTheDocument();
  // Ghế mới có người: "Tôi" ngồi vào ô thứ ba, còn 13 ghế trống.
  const seats = within(firstCard as HTMLElement).getByRole('list', { name: 'Hàng ghế' });
  expect(within(seats).getByRole('img', { name: 'Tôi' })).toBeInTheDocument();
  expect(within(seats).getAllByLabelText('Ghế trống')).toHaveLength(13);
  expect(screen.getByText('4 người tham gia hôm nay')).toBeInTheDocument();

  // Không tải lại danh sách sau khi thành công: dùng ngay DTO trả về.
  const listCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/sessions') && !String(url).includes('attendance') && !String(url).includes('bounties'));
  expect(listCalls).toHaveLength(1);
});

test('SESSION_FULL shows the API message by that card and refetches the list', async () => {
  let listCalls = 0;
  const nowFull: SessionDto = { ...base, id: 2, startsAt: '2026-10-22T14:00:00.000Z', capacity: 2, attendees: [a, c] };
  stubFetch({
    'GET /api/sessions': () => {
      listCalls += 1;
      return json(200, listCalls === 1 ? sessions : [sessions[1] as SessionDto, nowFull, sessions[2] as SessionDto]);
    },
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
    'POST /api/sessions/2/attendance': () => json(409, { error: { code: 'SESSION_FULL', message: 'Đã đủ người' } }),
  });
  renderPage();

  const joinButtons = await screen.findAllByRole('button', { name: 'Tham gia' });
  const secondCard = joinButtons[1]?.closest('article') as HTMLElement;
  expect(within(secondCard).getByText('21:00')).toBeInTheDocument();

  fireEvent.click(joinButtons[1] as HTMLElement);

  const alert = await within(secondCard).findByRole('alert');
  expect(alert).toHaveTextContent('Đã đủ người');
  // Thẻ còn lại không hiện lỗi.
  expect(within(joinButtons[0]?.closest('article') as HTMLElement).queryByRole('alert')).not.toBeInTheDocument();

  // Danh sách được tải lại và thẻ phản ánh trạng thái mới (đã đủ người).
  await waitFor(() => expect(listCalls).toBe(2));
  expect(await within(secondCard).findByRole('button', { name: 'Đã đủ người' })).toBeDisabled();
});

test('a failed sessions load shows the message and a retry button', async () => {
  let attempts = 0;
  stubFetch({
    'GET /api/sessions': () => {
      attempts += 1;
      return attempts === 1
        ? json(500, { error: { code: 'INTERNAL', message: 'Có lỗi xảy ra, thử lại sau' } })
        : json(200, []);
    },
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
  });
  renderPage();

  expect(await screen.findByText('Có lỗi xảy ra, thử lại sau')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Hôm nay chưa có buổi chơi nào')).toBeInTheDocument();
});

const hallOf = (date: string, label: string, winner: string): HallOfDayDto => ({
  date,
  sessions: [{ sessionId: 5, label, awards: [{ categoryName: 'Giết nhiều nhất', winners: [{ memberId: 1, displayName: winner, avatarUrl: null, voteCount: 3 }] }] }],
});

test('while today has no results yet, the most recent day with results is shown instead', async () => {
  // Vote buổi tối đóng sáng hôm sau, kết quả nằm ở ngày của buổi chơi (hôm qua).
  const fetchMock = stubFetch({
    'GET /api/sessions': () => json(200, []),
    'GET /api/mvp/day': (_init, url) =>
      json(200, url === '/api/mvp/day?date=2026-10-21' ? hallOf('2026-10-21', 'Cổ điển 21:00', 'Ngỗng Một') : emptyHall),
    'GET /api/mvp/dates': () => json(200, ['2026-10-21', '2026-10-18']),
  });
  renderPage();

  expect(await screen.findByRole('heading', { level: 2, name: 'Sảnh tri ân gần nhất — 21/10' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Cổ điển 21:00' })).toBeInTheDocument();
  expect(screen.getByText('Ngỗng Một')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2, name: 'Sảnh tri ân hôm nay' })).not.toBeInTheDocument();
  expect(screen.queryByText('Chưa có kết quả vote hôm nay')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/mvp/day?date=2026-10-21', expect.anything());
});

test("today's hall wins when it has results; the history is not even asked for", async () => {
  const fetchMock = stubFetch({
    'GET /api/sessions': () => json(200, []),
    'GET /api/mvp/day': () => json(200, hallOf('2026-10-22', 'Săn ngỗng 19:00', 'Vịt Hai')),
    'GET /api/mvp/dates': () => json(200, ['2026-10-22', '2026-10-21']),
  });
  renderPage();

  expect(await screen.findByRole('heading', { level: 3, name: 'Săn ngỗng 19:00' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Sảnh tri ân hôm nay' })).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/mvp/dates')).toBe(false);
});

test('with no results anywhere, the today hall keeps its empty copy', async () => {
  stubFetch({
    'GET /api/sessions': () => json(200, []),
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
  });
  renderPage();
  expect(await screen.findByText('Chưa có kết quả vote hôm nay')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Sảnh tri ân hôm nay' })).toBeInTheDocument();
});

test('joining is optimistic: the seat and button change before the server answers', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const joined: SessionDto = { ...base, id: 1, startsAt: '2026-10-22T12:00:00.000Z', attendees: [a, b, me], myStatus: 'going' };
  stubFetch({
    'GET /api/sessions': () => json(200, sessions),
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
    'POST /api/sessions/1/attendance': async () => {
      await gate;
      return json(200, joined);
    },
  });
  renderPage();

  const joinButtons = await screen.findAllByRole('button', { name: 'Tham gia' });
  const firstCard = joinButtons[0]?.closest('article') as HTMLElement;
  fireEvent.click(joinButtons[0] as HTMLElement);

  // Chưa có hồi âm: ghế đã có "Tôi", nút đã thành Huỷ (đang xử lý), tổng người đã +1.
  expect(await within(firstCard).findByText('3/16 ghế đã có người')).toBeInTheDocument();
  expect(within(within(firstCard).getByRole('list', { name: 'Hàng ghế' })).getByRole('img', { name: 'Tôi' })).toBeInTheDocument();
  expect(within(firstCard).getByRole('button', { name: 'Đang xử lý…' })).toBeDisabled();
  expect(screen.getByText('4 người tham gia hôm nay')).toBeInTheDocument();

  release();
  expect(await within(firstCard).findByRole('button', { name: 'Huỷ tham gia' })).toBeEnabled();
  expect(within(firstCard).getByText('3/16 ghế đã có người')).toBeInTheDocument();
});

test('a rejected join rolls the card back, shows the error and refetches', async () => {
  let listCalls = 0;
  stubFetch({
    'GET /api/sessions': () => {
      listCalls += 1;
      return json(200, sessions);
    },
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
    'POST /api/sessions/1/attendance': () => json(409, { error: { code: 'SESSION_CLOSED', message: 'Buổi đã đóng' } }),
  });
  renderPage();

  const joinButtons = await screen.findAllByRole('button', { name: 'Tham gia' });
  const firstCard = joinButtons[0]?.closest('article') as HTMLElement;
  fireEvent.click(joinButtons[0] as HTMLElement);

  const alert = await within(firstCard).findByRole('alert');
  expect(alert).toHaveTextContent('Buổi đã đóng');
  // Trả lại như cũ: 2 ghế, nút Tham gia, tổng 3 người.
  expect(within(firstCard).getByText('2/16 ghế đã có người')).toBeInTheDocument();
  expect(within(firstCard).getByRole('button', { name: 'Tham gia' })).toBeEnabled();
  expect(screen.getByText('3 người tham gia hôm nay')).toBeInTheDocument();
  await waitFor(() => expect(listCalls).toBe(2));
});

test('leaving is optimistic too: my seat frees up at once', async () => {
  const mine: SessionDto = { ...base, id: 1, startsAt: '2026-10-22T12:00:00.000Z', attendees: [a, me], myStatus: 'going' };
  const left: SessionDto = { ...mine, attendees: [a], myStatus: null };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  stubFetch({
    'GET /api/sessions': () => json(200, [mine]),
    'GET /api/mvp/day': () => json(200, emptyHall),
    'GET /api/mvp/dates': () => json(200, []),
    'POST /api/sessions/1/attendance': async (init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ going: false });
      await gate;
      return json(200, left);
    },
  });
  renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'Huỷ tham gia' }));
  expect(await screen.findByText('1/16 ghế đã có người')).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Tôi' })).not.toBeInTheDocument();
  release();
  expect(await screen.findByRole('button', { name: 'Tham gia' })).toBeEnabled();
});

// ---------------------------------------------------------------------------
// Thẻ "Treo thưởng" cạnh thẻ buổi chơi (spec treo thưởng §6)
// ---------------------------------------------------------------------------

const PELICAN = { id: 30, nameVi: 'Bồ nông', icon: '🦩', faction: 'neutral' as const };

const bounty = (over: Partial<BountyDto> & Pick<BountyDto, 'id' | 'title'>): BountyDto => ({
  description: null,
  points: 3,
  role: null,
  session: null,
  active: true,
  approvedClaims: 0,
  totalClaims: 0,
  ...over,
});

const bounties: BountyDto[] = [
  bounty({ id: 1, title: 'Bồ Nông nuốt hết vịt', description: 'Cả phe Vịt trong bụng', points: 5, role: PELICAN }),
  bounty({ id: 2, title: 'Tham gia đủ từ game đầu tới game cuối', points: 3 }),
];

const claim = (over: Partial<BountyClaimDto> & Pick<BountyClaimDto, 'id' | 'status'>): BountyClaimDto => ({
  bounty: { id: 1, title: 'Bồ Nông nuốt hết vịt', description: null },
  member: { id: 9, displayName: 'Tôi' },
  session: { id: 1, startsAt: '2026-10-22T12:00:00.000Z', modeName: 'Cổ điển' },
  playedOn: '2026-10-22',
  role: PELICAN,
  points: 5,
  rejectReason: null,
  source: 'web',
  createdAt: '2026-10-22T15:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
  ...over,
});

const sessionBounties = (over: Partial<SessionBountiesDto> = {}): SessionBountiesDto => ({ sessionId: 1, open: true, bounties, myClaims: [], ...over });

const oneSession: SessionDto = { ...base, id: 1, startsAt: '2026-10-22T12:00:00.000Z', attendees: [a, me], myStatus: 'going' };

const dayRoutes = (list: SessionDto[]): Record<string, Handler> => ({
  'GET /api/sessions': () => json(200, list),
  'GET /api/mvp/day': () => json(200, emptyHall),
  'GET /api/mvp/dates': () => json(200, []),
});

const bountyCard = () => screen.findByRole('region', { name: /^Treo thưởng/ });

test('a session with bounties gets a "Treo thưởng" card beside it: two columns on lg, stacked below', async () => {
  stubFetch({ ...dayRoutes([oneSession]), 'GET /api/sessions/1/bounties': () => json(200, sessionBounties()) });
  renderPage();

  const card = await bountyCard();
  const sessionCard = screen.getByRole('article', { name: '19:00 Cổ điển' });
  // Cùng một lưới: một cột trên màn nhỏ (xếp dưới), hai cột từ `lg` (buổi trái, treo thưởng phải).
  const grid = card.parentElement as HTMLElement;
  expect(grid).toBe(sessionCard.parentElement);
  expect(grid).toHaveClass('grid', 'lg:grid-cols-2');
  expect(grid.children[0]).toBe(sessionCard);
  expect(grid.children[1]).toBe(card);
  expect(sessionCard).toHaveClass('lg:col-start-1');
  expect(card).toHaveClass('lg:col-start-2');

  // Tiêu đề theo buổi (nhiều buổi trong ngày vẫn rõ thẻ nào của buổi nào).
  expect(within(card).getByText('19:00 · Cổ điển')).toBeInTheDocument();
  const items = within(card).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('🦩');
  expect(items[0]).toHaveTextContent('Bồ Nông nuốt hết vịt');
  expect(items[0]).toHaveTextContent('Cả phe Vịt trong bụng');
  expect(within(items[0] as HTMLElement).getByText('+5')).toHaveClass('bg-gold');
  // Mục không role: icon 🎯.
  expect(items[1]).toHaveTextContent('🎯');
  expect(within(items[1] as HTMLElement).getByRole('button', { name: /^Tôi đã hoàn thành/ })).toHaveClass('btn-secondary');
});

test('a session without bounties draws no card (no empty right column)', async () => {
  const fetchMock = stubFetch(dayRoutes([oneSession]));
  renderPage();
  const sessionCard = await screen.findByRole('article', { name: '19:00 Cổ điển' });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/sessions/1/bounties')).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('region', { name: /^Treo thưởng/ })).not.toBeInTheDocument();
  // Ngày không có treo thưởng: giữ lưới cũ (không ép cột 1, không chừa cột phải trống).
  expect(sessionCard).not.toHaveClass('lg:col-start-1');
});

test('a day with several sessions and no bounties keeps them side by side (no forced column)', async () => {
  const early: SessionDto = { ...oneSession, id: 1, startsAt: '2026-10-22T10:00:00.000Z' };
  const late: SessionDto = { ...oneSession, id: 2, startsAt: '2026-10-22T13:00:00.000Z' };
  const empty = () => json(200, sessionBounties({ bounties: [], myClaims: [] }));
  const fetchMock = stubFetch({ ...dayRoutes([early, late]), 'GET /api/sessions/1/bounties': empty, 'GET /api/sessions/2/bounties': empty });
  renderPage();
  const earlyCard = await screen.findByRole('article', { name: '17:00 Cổ điển' });
  const lateCard = screen.getByRole('article', { name: '20:00 Cổ điển' });
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/bounties'))).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('region', { name: /^Treo thưởng/ })).not.toBeInTheDocument();
  expect(earlyCard).not.toHaveClass('lg:col-start-1');
  expect(lateCard).not.toHaveClass('lg:col-start-1');
});

test('while bounty queries are loading the old grid is kept; pairs appear only once all have resolved', async () => {
  const early: SessionDto = { ...oneSession, id: 1, startsAt: '2026-10-22T10:00:00.000Z' };
  const late: SessionDto = { ...oneSession, id: 2, startsAt: '2026-10-22T13:00:00.000Z' };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  stubFetch({
    ...dayRoutes([early, late]),
    'GET /api/sessions/1/bounties': () => json(200, sessionBounties()),
    'GET /api/sessions/2/bounties': async () => {
      await gate;
      return json(200, sessionBounties({ sessionId: 2, bounties: [], myClaims: [] }));
    },
  });
  renderPage();
  const earlyCard = await screen.findByRole('article', { name: '17:00 Cổ điển' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Buổi 1 đã có treo thưởng nhưng buổi 2 chưa trả lời: chưa đổi lưới, chưa vẽ thẻ.
  expect(screen.queryByRole('region', { name: /^Treo thưởng/ })).not.toBeInTheDocument();
  expect(earlyCard).not.toHaveClass('lg:col-start-1');

  release();
  const card = await bountyCard();
  expect(earlyCard).toHaveClass('lg:col-start-1');
  expect(screen.getByRole('article', { name: '20:00 Cổ điển' })).toHaveClass('lg:col-start-1');
  expect(card).toHaveClass('lg:col-start-2');
});

test('several sessions where only some have bounties: each session in column 1, its bounty card beside it in column 2', async () => {
  const early: SessionDto = { ...oneSession, id: 1, startsAt: '2026-10-22T10:00:00.000Z' };
  const late: SessionDto = { ...oneSession, id: 2, startsAt: '2026-10-22T13:00:00.000Z' };
  stubFetch({
    ...dayRoutes([late, early]),
    'GET /api/sessions/1/bounties': () => json(200, sessionBounties({ bounties: [], myClaims: [] })),
    'GET /api/sessions/2/bounties': () => json(200, sessionBounties({ sessionId: 2 })),
  });
  renderPage();

  const card = await bountyCard();
  const earlyCard = screen.getByRole('article', { name: '17:00 Cổ điển' });
  const lateCard = screen.getByRole('article', { name: '20:00 Cổ điển' });
  const grid = card.parentElement as HTMLElement;
  // Thứ tự: buổi sớm (không treo thưởng) → buổi muộn → thẻ treo thưởng của buổi muộn; không ô trống xen giữa.
  expect([...grid.children]).toEqual([earlyCard, lateCard, card]);
  expect(earlyCard).toHaveClass('lg:col-start-1');
  expect(lateCard).toHaveClass('lg:col-start-1');
  expect(card).toHaveClass('lg:col-start-2');
  expect(within(card).getByText('20:00 · Cổ điển')).toBeInTheDocument();
});

test('a cancelled session does not even ask for bounties', async () => {
  const cancelled: SessionDto = { ...oneSession, status: 'cancelled', myStatus: null, attendees: [] };
  const fetchMock = stubFetch(dayRoutes([cancelled]));
  renderPage();
  await screen.findByText('Đã huỷ');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/bounties'))).toBe(false);
});

test('"Tôi đã hoàn thành" posts the claim, shows "Chờ duyệt" and refreshes the review queue', async () => {
  let posted: unknown = null;
  stubFetch({
    ...dayRoutes([oneSession]),
    'GET /api/sessions/1/bounties': () => json(200, sessionBounties()),
    'POST /api/sessions/1/bounties/2/claim': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, claim({ id: 77, status: 'pending', bounty: { id: 2, title: 'Tham gia đủ', description: null }, role: null, points: 3 }));
    },
  });
  const queryClient = renderPage();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const card = await bountyCard();
  const second = within(card).getAllByRole('listitem')[1] as HTMLElement;

  // Tên nút kèm tên mục: trình đọc màn hình phân biệt được các nút giống nhau.
  fireEvent.click(within(second).getByRole('button', { name: 'Tôi đã hoàn thành: Tham gia đủ từ game đầu tới game cuối' }));

  // Chip mới nằm trong vùng thông báo (đã có sẵn trước khi bấm) nên được đọc lên.
  const status = within(second).getByRole('status');
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(await within(status).findByText('Chờ duyệt')).toBeInTheDocument();
  expect(posted).toEqual({});
  expect(within(second).queryByRole('button', { name: /^Tôi đã hoàn thành/ })).not.toBeInTheDocument();
  // Mục kia vẫn còn nút.
  expect(within(within(card).getAllByRole('listitem')[0] as HTMLElement).getByRole('button', { name: /^Tôi đã hoàn thành/ })).toBeInTheDocument();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: PENDING_BOUNTY_CLAIMS_KEY });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: MY_BOUNTY_CLAIMS_KEY });
});

test('a failed claim shows the server message under that bounty and refetches the card', async () => {
  let calls = 0;
  stubFetch({
    ...dayRoutes([oneSession]),
    'GET /api/sessions/1/bounties': () => {
      calls += 1;
      return json(200, sessionBounties());
    },
    'POST /api/sessions/1/bounties/1/claim': () => json(409, { error: { code: 'BOUNTY_ALREADY_CLAIMED', message: 'Bạn đã nhận mục này ở buổi này rồi' } }),
  });
  renderPage();
  const first = within(await bountyCard()).getAllByRole('listitem')[0] as HTMLElement;
  fireEvent.click(within(first).getByRole('button', { name: /^Tôi đã hoàn thành/ }));
  expect(await within(first).findByRole('alert')).toHaveTextContent('Bạn đã nhận mục này ở buổi này rồi');
  await waitFor(() => expect(calls).toBe(2));
});

test('my claims show their status chip instead of the button', async () => {
  stubFetch({
    ...dayRoutes([oneSession]),
    'GET /api/sessions/1/bounties': () =>
      json(
        200,
        sessionBounties({
          bounties: [...bounties, bounty({ id: 3, title: 'Binh lính giết 3 vịt', points: 4 }), bounty({ id: 4, title: 'Sống sót tới cuối', points: 2 })],
          myClaims: [
            claim({ id: 1, status: 'approved', points: 5 }),
            claim({ id: 2, status: 'rejected', bounty: { id: 2, title: 'x', description: null }, rejectReason: 'Không có clip' }),
            claim({ id: 3, status: 'revoked', bounty: { id: 3, title: 'y', description: null }, rejectReason: 'Nhầm buổi' }),
            claim({ id: 4, status: 'pending', bounty: { id: 4, title: 'z', description: null } }),
          ],
        }),
      ),
  });
  renderPage();
  const items = within(await bountyCard()).getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('Đã nhận +5');
  expect(items[1]).toHaveTextContent('Bị từ chối: Không có clip');
  expect(items[2]).toHaveTextContent('Đã bị huỷ: Nhầm buổi');
  expect(items[3]).toHaveTextContent('Chờ duyệt');
  expect(screen.queryByRole('button', { name: /^Tôi đã hoàn thành/ })).not.toBeInTheDocument();
});

test('a claim of a bounty that was turned off still shows on the card', async () => {
  stubFetch({
    ...dayRoutes([oneSession]),
    'GET /api/sessions/1/bounties': () =>
      json(200, sessionBounties({ bounties: [], myClaims: [claim({ id: 5, status: 'pending', bounty: { id: 9, title: 'Mục đã tắt', description: null } })] })),
  });
  renderPage();
  const items = within(await bountyCard()).getAllByRole('listitem');
  expect(items).toHaveLength(1);
  expect(items[0]).toHaveTextContent('Mục đã tắt');
  expect(items[0]).toHaveTextContent('Chờ duyệt');
});

// Chưa tham gia hay đã huỷ tham gia (`myStatus: null`) vẫn nhận được — chủ server chốt 2026-10-30.
test('not attending: the button still shows to every member while open', async () => {
  const notGoing: SessionDto = { ...oneSession, attendees: [a], myStatus: null };
  stubFetch({ ...dayRoutes([notGoing]), 'GET /api/sessions/1/bounties': () => json(200, sessionBounties()) });
  renderPage();
  const card = await bountyCard();
  expect(within(card).getAllByRole('button', { name: /^Tôi đã hoàn thành/ })).toHaveLength(2);
  expect(within(card).queryByText('Tham gia buổi để nhận thưởng')).not.toBeInTheDocument();
});

test('expired (open = false): the button is hidden, the bounties still show', async () => {
  stubFetch({ ...dayRoutes([oneSession]), 'GET /api/sessions/1/bounties': () => json(200, sessionBounties({ open: false })) });
  renderPage();
  const card = await bountyCard();
  expect(within(card).getAllByRole('listitem')).toHaveLength(2);
  expect(within(card).queryByRole('button', { name: /^Tôi đã hoàn thành/ })).not.toBeInTheDocument();
});

