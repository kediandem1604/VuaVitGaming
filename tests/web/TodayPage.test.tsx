import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { HallOfDayDto, MeDto, SessionAttendeeDto, SessionDto } from '../../src/shared/api-types';
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

/** fetch giả định tuyến theo `METHOD path` (bỏ query string). */
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
  const listCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/sessions') && !String(url).includes('attendance'));
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
