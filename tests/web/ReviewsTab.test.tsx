import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AccusationDto, ReportDto, ReviewedReportDto } from '../../src/shared/api-types';
import { APPROVED_REPORTS_KEY, LEADERBOARD_TOTALS_KEY, MY_REPORTS_KEY, PENDING_REPORTS_KEY, TITLES_QUERY_KEY } from '../../src/web/lib/queryKeys';
import { ReviewsTab } from '../../src/web/pages/admin/ReviewsTab';

/** Phần role của một lần khai; `over` ghi đè điểm mỗi lần, chỉ số phụ, chỉ số phạt (mặc định ×1, không có). */
const reportRole = (id: number, nameVi: string, icon: string, metricLabel: string, maxPerGame = 15, over: Partial<ReportDto['role']> = {}): ReportDto['role'] => ({
  id,
  nameVi,
  icon,
  metricLabel,
  maxPerGame,
  points: 1,
  extraMetricLabel: null,
  extraMaxPerGame: null,
  extraPoints: null,
  penaltyMetricLabel: null,
  penaltyMaxPerGame: null,
  penaltyPoints: null,
  ...over,
});

const ASSASSIN = reportRole(50, 'Ám sát', '🗡️', 'Số mạng đã giết', 15, { extraMetricLabel: 'Số lần ám sát trong cuộc họp', extraMaxPerGame: 2, extraPoints: 3 });
const SHERIFF = reportRole(20, 'Cảnh sát trưởng', '⭐', 'Số phát bắn trúng kẻ xấu', 10, { points: 3, penaltyMetricLabel: 'Số phát bắn sai', penaltyMaxPerGame: 10, penaltyPoints: 1 });

const report = (over: Partial<ReportDto> & Pick<ReportDto, 'id'>): ReportDto => ({
  member: { id: 9, displayName: 'Ngỗng Chín' },
  role: reportRole(61, 'Kiếm sĩ', '⚔️', 'Số mạng chém'),
  value: 4,
  extraValue: 0,
  penaltyValue: 0,
  bonusPoints: 0,
  source: 'self',
  points: over.value ?? 4,
  playedOn: '2026-10-22',
  sessionId: 7,
  note: 'Trận cuối',
  status: 'pending',
  rejectReason: null,
  createdAt: '2026-10-22T13:00:00.000Z',
  highlightUrl: null,
  accusation: null,
  accusationDuplicate: false,
  accusationWaitingFor: null,
  penaltyOf: null,
  ...over,
});

const queue: ReportDto[] = [
  report({ id: 1 }),
  report({ id: 2, member: { id: 10, displayName: 'Vịt Mười' }, role: reportRole(1, 'Ngỗng', '🪿', 'Số lần vote trúng Vịt', 10), value: 2, sessionId: null, note: null }),
];

/** Lần khai đã duyệt trong mục "Đã duyệt gần đây": người duyệt mặc định là Mod Mười Hai, duyệt 21:30 22/10 giờ VN. */
const approvedReport = (over: Partial<ReviewedReportDto> & Pick<ReviewedReportDto, 'id'>): ReviewedReportDto => ({
  ...report({ id: over.id, status: 'approved' }),
  reviewedBy: { id: 12, displayName: 'Mod Mười Hai' },
  reviewedAt: '2026-10-22T14:30:00.000Z',
  ...over,
});

const approved: ReviewedReportDto[] = [
  approvedReport({ id: 21 }),
  approvedReport({ id: 22, member: { id: 10, displayName: 'Vịt Mười' }, role: ASSASSIN, value: 4, extraValue: 2, points: 10, reviewedBy: null, note: null }),
];

const PENDING_ROUTE = 'GET /api/admin/reports?status=pending';
const APPROVED_ROUTE = 'GET /api/admin/reports?status=approved';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Tuyến giả; hai danh sách (hàng chờ, đã duyệt) mặc định rỗng để mỗi test chỉ tả phần mình cần. */
function stubFetch(routes: Record<string, Handler>) {
  const all: Record<string, Handler> = { [PENDING_ROUTE]: () => json(200, []), [APPROVED_ROUTE]: () => json(200, []), ...routes };
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = all[key];
    if (!handler) throw new Error(`Không có tuyến giả cho ${key}`);
    return Promise.resolve(handler(init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderTab = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewsTab />
    </QueryClientProvider>,
  );
  return queryClient;
};

/** Mục "Đã duyệt gần đây" (section có tiêu đề riêng) — để không lẫn với dòng của hàng chờ. */
const approvedSection = () => screen.getByRole('region', { name: /^Đã duyệt gần đây/ });
const approvedItems = async () => within(await screen.findByRole('region', { name: /^Đã duyệt gần đây/ })).findAllByRole('listitem');

const postCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('the queue shows member, role, value with metric, date, note and session', async () => {
  stubFetch({ 'GET /api/admin/reports?status=pending': () => json(200, queue) });
  renderTab();

  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(2);
  const first = items[0] as HTMLElement;
  expect(first).toHaveTextContent('Ngỗng Chín');
  expect(first).toHaveTextContent('⚔️ Kiếm sĩ');
  expect(first).toHaveTextContent('4 mạng chém');
  expect(first).toHaveTextContent('22/10/2026');
  expect(first).toHaveTextContent('Trận cuối');
  expect(first).toHaveTextContent('Buổi #7');
  expect(within(first).getByRole('button', { name: 'Duyệt' })).toBeInTheDocument();
  expect(within(first).getByRole('button', { name: 'Từ chối' })).toBeInTheDocument();
  expect(items[1]).not.toHaveTextContent('Buổi #');
});

test('a report of an extra-metric role reads "x + y"; others are unchanged', async () => {
  stubFetch({
    'GET /api/admin/reports?status=pending': () =>
      json(200, [report({ id: 3, member: { id: 11, displayName: 'Vịt Mười Một' }, role: ASSASSIN, value: 4, extraValue: 2, points: 10 }), ...queue]),
  });
  renderTab();

  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent('🗡️ Ám sát');
  expect(items[0]).toHaveTextContent('4 mạng đã giết + 2 lần ám sát trong cuộc họp');
  expect(items[1]).toHaveTextContent('4 mạng chém');
  expect(items[1]).not.toHaveTextContent('+');
});

test('a report of a penalty role reads "x − z" only when penaltyValue > 0', async () => {
  stubFetch({
    'GET /api/admin/reports?status=pending': () =>
      json(200, [
        report({ id: 4, member: { id: 12, displayName: 'Ngỗng Mười Hai' }, role: SHERIFF, value: 4, penaltyValue: 1, points: 11 }),
        report({ id: 5, member: { id: 13, displayName: 'Ngỗng Mười Ba' }, role: SHERIFF, value: 2, penaltyValue: 0, points: 6 }),
      ]),
  });
  renderTab();

  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('⭐ Cảnh sát trưởng');
  expect(items[0]).toHaveTextContent('4 phát bắn trúng kẻ xấu − 1 phát bắn sai');
  expect(items[1]).toHaveTextContent('2 phát bắn trúng kẻ xấu');
  expect(items[1]).not.toHaveTextContent('−');
});

test('rejecting requires a reason before anything is sent', async () => {
  let posted: unknown = null;
  const fetchMock = stubFetch({
    'GET /api/admin/reports?status=pending': () => json(200, queue),
    'POST /api/admin/reports/1/review': (init) => {
      posted = JSON.parse(String(init?.body));
      return noContent();
    },
  });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Từ chối' }));
  const reason = within(first).getByRole('textbox', { name: 'Lý do từ chối' });
  expect(reason).toHaveAttribute('maxlength', '200');

  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận từ chối' }));
  expect(await within(first).findByRole('alert')).toHaveTextContent('Cần ghi lý do từ chối');
  expect(postCalls(fetchMock)).toHaveLength(0);

  // Toàn khoảng trắng cũng không được.
  fireEvent.change(reason, { target: { value: '   ' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận từ chối' }));
  expect(postCalls(fetchMock)).toHaveLength(0);

  fireEvent.change(reason, { target: { value: 'Quá giới hạn của role' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận từ chối' }));
  await waitFor(() => expect(posted).toEqual({ approve: false, reason: 'Quá giới hạn của role' }));
  // Lần khai rời hàng chờ; lần còn lại vẫn đó.
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  expect(screen.getByRole('listitem')).toHaveTextContent('Vịt Mười');
});

test('approving posts approve: true and removes the report', async () => {
  let posted: unknown = null;
  stubFetch({
    'GET /api/admin/reports?status=pending': () => json(200, queue),
    'POST /api/admin/reports/2/review': (init) => {
      posted = JSON.parse(String(init?.body));
      return noContent();
    },
  });
  renderTab();
  const second = (await screen.findAllByRole('listitem'))[1] as HTMLElement;
  fireEvent.click(within(second).getByRole('button', { name: 'Duyệt' }));
  await waitFor(() => expect(posted).toEqual({ approve: true }));
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  expect(screen.getByRole('listitem')).toHaveTextContent('Ngỗng Chín');
});

test('NOT_PENDING shows the server message and refetches the queue', async () => {
  let listCalls = 0;
  stubFetch({
    'GET /api/admin/reports?status=pending': () => {
      listCalls += 1;
      return json(200, listCalls === 1 ? queue : [report({ id: 1, value: 9 })]);
    },
    'POST /api/admin/reports/1/review': () => json(409, { error: { code: 'NOT_PENDING', message: 'Lần khai vừa được sửa, hãy xem lại' } }),
  });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Lần khai vừa được sửa, hãy xem lại');
  await waitFor(() => expect(listCalls).toBe(2));
  expect(await screen.findByText('9 mạng chém')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
});

test('a report with a highlight shows a "Xem highlight" link opening in a new tab', async () => {
  const highlightUrl = 'https://discord.com/channels/1/2/3';
  stubFetch({
    'GET /api/admin/reports?status=pending': () => json(200, [report({ id: 1, highlightUrl }), queue[1] as ReportDto]),
  });
  renderTab();

  const [first, second] = (await screen.findAllByRole('listitem')) as [HTMLElement, HTMLElement];
  const link = within(first).getByRole('link', { name: 'Xem highlight' });
  expect(link).toHaveAttribute('href', highlightUrl);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(within(second).queryByRole('link')).not.toBeInTheDocument();
});

test('an empty queue says so', async () => {
  stubFetch({ 'GET /api/admin/reports?status=pending': () => json(200, []) });
  renderTab();
  expect(await screen.findByText('Không có lần khai nào chờ duyệt')).toBeInTheDocument();
});

// ----- Đã duyệt gần đây -----

test('recently approved shows member, role, value, play date and "Duyệt bởi {tên} lúc …"', async () => {
  stubFetch({ [APPROVED_ROUTE]: () => json(200, approved) });
  renderTab();

  const items = await approvedItems();
  expect(items).toHaveLength(2);
  expect(screen.getByRole('heading', { name: 'Đã duyệt gần đây (2)' })).toBeInTheDocument();
  const first = items[0] as HTMLElement;
  expect(first).toHaveTextContent('Ngỗng Chín');
  expect(first).toHaveTextContent('⚔️ Kiếm sĩ');
  expect(first).toHaveTextContent('4 mạng chém');
  expect(first).toHaveTextContent('22/10/2026');
  expect(first).toHaveTextContent('Trận cuối');
  // 14:30Z = 21:30 giờ Việt Nam.
  expect(first).toHaveTextContent('Duyệt bởi Mod Mười Hai lúc 21:30 22/10/2026');
  expect(first).not.toHaveTextContent('Khai lúc');
  expect(within(first).getByRole('button', { name: 'Huỷ duyệt' })).toBeInTheDocument();
  expect(within(first).queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();

  // Không rõ người duyệt → gạch ngang; role có chỉ số phụ đọc "x + y".
  const second = items[1] as HTMLElement;
  expect(second).toHaveTextContent('Duyệt bởi — lúc 21:30 22/10/2026');
  expect(second).toHaveTextContent('4 mạng đã giết + 2 lần ám sát trong cuộc họp');
});

test('revoking requires a non-blank reason before anything is sent', async () => {
  const fetchMock = stubFetch({ [APPROVED_ROUTE]: () => json(200, approved) });
  renderTab();
  const first = (await approvedItems())[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ duyệt' }));
  const reason = within(first).getByRole('textbox', { name: 'Lý do huỷ duyệt' });
  expect(reason).toHaveAttribute('maxlength', '200');
  expect(first).toHaveTextContent('0/200');

  fireEvent.change(reason, { target: { value: '   ' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận huỷ duyệt' }));
  expect(await within(first).findByRole('alert')).toHaveTextContent('Cần ghi lý do huỷ duyệt');
  expect(postCalls(fetchMock)).toHaveLength(0);
});

test('revoking posts the trimmed reason, removes the row and refreshes leaderboards', async () => {
  let posted: unknown = null;
  stubFetch({
    [APPROVED_ROUTE]: () => json(200, posted === null ? approved : approved.filter((r) => r.id !== 21)),
    'POST /api/admin/reports/21/revoke': (init) => {
      posted = JSON.parse(String(init?.body));
      return noContent();
    },
  });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const first = (await approvedItems())[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ duyệt' }));
  fireEvent.change(within(first).getByRole('textbox', { name: 'Lý do huỷ duyệt' }), { target: { value: '  Clip không khớp  ' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận huỷ duyệt' }));

  await waitFor(() => expect(posted).toEqual({ reason: 'Clip không khớp' }));
  // Dòng rời danh sách ngay; dòng còn lại vẫn đó.
  await waitFor(() => expect(within(approvedSection()).getAllByRole('listitem')).toHaveLength(1));
  expect(within(approvedSection()).getByRole('listitem')).toHaveTextContent('Vịt Mười');
  // Điểm mùa, Top 3 mỗi phe, Đại sảnh và trang thành viên phải tải lại.
  for (const key of ['leaderboard', 'leaderboard-factions', 'hall', 'member']) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  }
  // Danh hiệu ở Hồ sơ và danh sách lần khai của người khai cũng không còn tính lần này.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: TITLES_QUERY_KEY });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: MY_REPORTS_KEY });
  // Bảng "Tổng điểm theo phe" cũng tính lần khai này.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: LEADERBOARD_TOTALS_KEY });
  // Mục trừ điểm do báo cáo kèm lần khai này cũng vừa bị huỷ dây chuyền → tải lại danh sách đã duyệt.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: APPROVED_REPORTS_KEY });
});

test('NOT_APPROVED shows the server message and refetches the list', async () => {
  let listCalls = 0;
  stubFetch({
    [APPROVED_ROUTE]: () => {
      listCalls += 1;
      return json(200, listCalls === 1 ? approved : [approved[1] as ReviewedReportDto]);
    },
    'POST /api/admin/reports/21/revoke': () => json(409, { error: { code: 'NOT_APPROVED', message: 'Lần khai không còn ở trạng thái đã duyệt' } }),
  });
  renderTab();
  const first = (await approvedItems())[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ duyệt' }));
  fireEvent.change(within(first).getByRole('textbox', { name: 'Lý do huỷ duyệt' }), { target: { value: 'Khai gian' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận huỷ duyệt' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Lần khai không còn ở trạng thái đã duyệt');
  await waitFor(() => expect(listCalls).toBe(2));
  await waitFor(() => expect(within(approvedSection()).getAllByRole('listitem')).toHaveLength(1));
  expect(within(approvedSection()).getByRole('listitem')).toHaveTextContent('Vịt Mười');
});

test('SEASON_CLOSED shows the server message and refetches the list', async () => {
  let listCalls = 0;
  stubFetch({
    [APPROVED_ROUTE]: () => {
      listCalls += 1;
      // Mùa vừa chốt trong lúc danh sách đang mở: lần tải lại không còn dòng nào.
      return json(200, listCalls === 1 ? approved : []);
    },
    'POST /api/admin/reports/21/revoke': () => json(409, { error: { code: 'SEASON_CLOSED', message: 'Mùa đã chốt, không huỷ duyệt được nữa' } }),
  });
  renderTab();
  const first = (await approvedItems())[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ duyệt' }));
  fireEvent.change(within(first).getByRole('textbox', { name: 'Lý do huỷ duyệt' }), { target: { value: 'Khai gian' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận huỷ duyệt' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Mùa đã chốt, không huỷ duyệt được nữa');
  await waitFor(() => expect(listCalls).toBe(2));
  expect(await within(approvedSection()).findByText('Chưa có lần khai nào được duyệt trong mùa đang mở')).toBeInTheDocument();
});

test('approving from the queue refreshes the recently approved list', async () => {
  stubFetch({
    [PENDING_ROUTE]: () => json(200, queue),
    'POST /api/admin/reports/1/review': () => noContent(),
  });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt' }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: APPROVED_REPORTS_KEY }));
});

test('no recently approved report says so', async () => {
  stubFetch({});
  renderTab();
  expect(await screen.findByText('Chưa có lần khai nào được duyệt trong mùa đang mở')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Đã duyệt gần đây (0)' })).toBeInTheDocument();
});

test('"Thôi" closes the revoke form without sending', async () => {
  const fetchMock = stubFetch({ [APPROVED_ROUTE]: () => json(200, approved) });
  renderTab();
  const first = (await approvedItems())[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ duyệt' }));
  fireEvent.change(within(first).getByRole('textbox', { name: 'Lý do huỷ duyệt' }), { target: { value: 'Nhầm' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Thôi' }));

  expect(within(first).queryByRole('textbox')).not.toBeInTheDocument();
  expect(within(first).getByRole('button', { name: 'Huỷ duyệt' })).toBeInTheDocument();
  expect(postCalls(fetchMock)).toHaveLength(0);
});

test('"Thôi" after a failed revoke clears the error under the row', async () => {
  stubFetch({
    [APPROVED_ROUTE]: () => json(200, approved),
    'POST /api/admin/reports/21/revoke': () => json(500, { error: { code: 'INTERNAL', message: 'Lỗi máy chủ' } }),
  });
  renderTab();
  const first = (await approvedItems())[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ duyệt' }));
  fireEvent.change(within(first).getByRole('textbox', { name: 'Lý do huỷ duyệt' }), { target: { value: 'Khai gian' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận huỷ duyệt' }));
  expect(await within(first).findByRole('alert')).toHaveTextContent('Lỗi máy chủ');

  fireEvent.click(within(first).getByRole('button', { name: 'Thôi' }));
  await waitFor(() => expect(within(first).queryByRole('alert')).not.toBeInTheDocument());
  expect(within(first).getByRole('button', { name: 'Huỷ duyệt' })).toBeInTheDocument();
});

test('"Huỷ" after a failed rejection clears the error under the row', async () => {
  stubFetch({
    [PENDING_ROUTE]: () => json(200, queue),
    'POST /api/admin/reports/1/review': () => json(500, { error: { code: 'INTERNAL', message: 'Lỗi máy chủ' } }),
  });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Từ chối' }));
  fireEvent.change(within(first).getByRole('textbox', { name: 'Lý do từ chối' }), { target: { value: 'Khai gian' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận từ chối' }));
  expect(await within(first).findByRole('alert')).toHaveTextContent('Lỗi máy chủ');

  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ' }));
  await waitFor(() => expect(within(first).queryByRole('alert')).not.toBeInTheDocument());
  expect(within(first).getByRole('button', { name: 'Từ chối' })).toBeInTheDocument();
});

// ----- Báo cáo người chơi (spec điểm role §6) -----

/** Báo cáo đang hiện ở hàng chờ: Vịt Mười chơi Dân phòng bắn Ngỗng Mười Một phe Ngỗng. */
const accusation = (over: Partial<AccusationDto> = {}): AccusationDto => ({
  id: 1,
  status: 'pending',
  accused: { id: 10, displayName: 'Vịt Mười' },
  accusedRole: { id: 21, nameVi: 'Dân phòng', icon: '🔫', penaltyPoints: 3 },
  victim: { id: 11, displayName: 'Ngỗng Mười Một' },
  victimFaction: 'goose',
  rejectReason: null,
  ...over,
});
const ACCUSATION_LINE = 'Báo cáo: Vịt Mười (Dân phòng) bắn Ngỗng Mười Một — phe Ngỗng';
const REVIEW_1 = 'POST /api/admin/reports/1/review';

test('a queued report with an accusation shows the box and three buttons; "Duyệt" approves both', async () => {
  let posted: unknown = null;
  stubFetch({
    // Sau khi duyệt, hàng chờ tải lại (báo cáo vừa được quyết) không còn lần khai 1.
    [PENDING_ROUTE]: () => json(200, posted === null ? [report({ id: 1, accusation: accusation() }), queue[1] as ReportDto] : [queue[1] as ReportDto]),
    [REVIEW_1]: (init) => {
      posted = JSON.parse(String(init?.body));
      return noContent();
    },
  });
  renderTab();
  const [first, second] = (await screen.findAllByRole('listitem')) as [HTMLElement, HTMLElement];

  expect(first).toHaveTextContent(ACCUSATION_LINE);
  expect(within(first).getByRole('button', { name: 'Duyệt' })).toBeInTheDocument();
  expect(within(first).getByRole('button', { name: 'Duyệt, bỏ báo cáo' })).toBeInTheDocument();
  expect(within(first).getByRole('button', { name: 'Từ chối' })).toBeInTheDocument();
  // Không có báo cáo: như cũ, hai nút.
  expect(second).not.toHaveTextContent('Báo cáo:');
  expect(within(second).queryByRole('button', { name: 'Duyệt, bỏ báo cáo' })).not.toBeInTheDocument();

  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt' }));
  await waitFor(() => expect(posted).toEqual({ approve: true, accusation: 'approve' }));
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
});

test('"Duyệt, bỏ báo cáo" needs a reason, then approves the report while rejecting the accusation', async () => {
  let posted: unknown = null;
  const fetchMock = stubFetch({
    [PENDING_ROUTE]: () => json(200, posted === null ? [report({ id: 1, accusation: accusation() })] : []),
    [REVIEW_1]: (init) => {
      posted = JSON.parse(String(init?.body));
      return noContent();
    },
  });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;

  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt, bỏ báo cáo' }));
  const reason = within(first).getByRole('textbox', { name: 'Lý do bỏ báo cáo' });
  expect(reason).toHaveAttribute('maxlength', '200');
  // Form lý do thay ba nút; chỉ còn nút xác nhận và Huỷ.
  expect(within(first).queryByRole('button', { name: 'Từ chối' })).not.toBeInTheDocument();
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận duyệt, bỏ báo cáo' }));
  expect(await within(first).findByRole('alert')).toHaveTextContent('Cần ghi lý do bỏ báo cáo');
  expect(postCalls(fetchMock)).toHaveLength(0);

  fireEvent.change(reason, { target: { value: '  Không phải Dân phòng  ' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận duyệt, bỏ báo cáo' }));
  await waitFor(() => expect(posted).toEqual({ approve: true, accusation: 'reject', reason: 'Không phải Dân phòng' }));
  await waitFor(() => expect(screen.queryByRole('listitem')).not.toBeInTheDocument());
});

test('"Huỷ" closes the drop-accusation form and brings the three buttons back', async () => {
  const fetchMock = stubFetch({ [PENDING_ROUTE]: () => json(200, [report({ id: 1, accusation: accusation() })]) });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt, bỏ báo cáo' }));
  fireEvent.change(within(first).getByRole('textbox', { name: 'Lý do bỏ báo cáo' }), { target: { value: 'Nhầm' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ' }));
  expect(within(first).queryByRole('textbox')).not.toBeInTheDocument();
  expect(within(first).getByRole('button', { name: 'Duyệt' })).toBeInTheDocument();
  expect(within(first).getByRole('button', { name: 'Duyệt, bỏ báo cáo' })).toBeInTheDocument();
  expect(within(first).getByRole('button', { name: 'Từ chối' })).toBeInTheDocument();
  expect(postCalls(fetchMock)).toHaveLength(0);
});

test('"Từ chối" on a report with an accusation rejects both with the same reason', async () => {
  let posted: unknown = null;
  stubFetch({
    [PENDING_ROUTE]: () => json(200, [report({ id: 1, accusation: accusation() })]),
    [REVIEW_1]: (init) => {
      posted = JSON.parse(String(init?.body));
      return noContent();
    },
  });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  fireEvent.click(within(first).getByRole('button', { name: 'Từ chối' }));
  fireEvent.change(within(first).getByRole('textbox', { name: 'Lý do từ chối' }), { target: { value: 'Khai gian' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận từ chối' }));
  await waitFor(() => expect(posted).toEqual({ approve: false, reason: 'Khai gian', accusation: 'reject' }));
});

test('a hidden duplicate accusation shows no box, no note and only the two usual buttons, sending no accusation decision', async () => {
  let posted: unknown = null;
  stubFetch({
    [PENDING_ROUTE]: () => json(200, [report({ id: 1, accusation: null, accusationDuplicate: true })]),
    [REVIEW_1]: (init) => {
      posted = JSON.parse(String(init?.body));
      return noContent();
    },
  });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  expect(first).not.toHaveTextContent('Báo cáo');
  expect(first).not.toHaveTextContent('trùng');
  expect(within(first).getAllByRole('button').map((button) => button.textContent)).toEqual(['Duyệt', 'Từ chối']);
  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt' }));
  await waitFor(() => expect(posted).toEqual({ approve: true }));
});

test('recently approved: a penalty row reads "Bị báo cáo: …" with the "Bị trừ điểm" chip; a report with a settled accusation shows its outcome', async () => {
  const penaltyRow = approvedReport({
    id: 31,
    member: { id: 10, displayName: 'Vịt Mười' },
    role: reportRole(21, 'Dân phòng', '🔫', 'Số phát bắn trúng kẻ xấu', 1, { points: 5, penaltyMetricLabel: 'Số phát bắn sai', penaltyMaxPerGame: 1, penaltyPoints: 3 }),
    source: 'accusation',
    value: 0,
    penaltyValue: 1,
    points: -3,
    note: 'Bị báo cáo: bắn Ngỗng Mười Một (phe Ngỗng)',
    penaltyOf: accusation({ status: 'approved' }),
  });
  stubFetch({
    [APPROVED_ROUTE]: () =>
      json(200, [
        penaltyRow,
        approvedReport({ id: 32, bonusPoints: 1, points: 5, accusation: accusation({ status: 'approved' }) }),
        approvedReport({ id: 33, accusation: accusation({ status: 'rejected', rejectReason: 'Không phải Dân phòng' }) }),
      ]),
  });
  renderTab();

  const [penalty, approvedAcc, rejectedAcc] = (await approvedItems()) as [HTMLElement, HTMLElement, HTMLElement];
  expect(penalty).toHaveTextContent('Vịt Mười');
  expect(penalty).toHaveTextContent('🔫 Dân phòng');
  expect(within(penalty).getByText('Bị trừ điểm')).toHaveClass('chip');
  expect(penalty).toHaveTextContent('Bị báo cáo: bắn Ngỗng Mười Một (Ngỗng) − 3 điểm');
  expect(penalty).not.toHaveTextContent('phát bắn');
  expect(within(penalty).getAllByText(/Bị báo cáo/)).toHaveLength(1);
  // Mục trừ điểm vẫn huỷ duyệt riêng được.
  expect(within(penalty).getByRole('button', { name: 'Huỷ duyệt' })).toBeInTheDocument();

  expect(approvedAcc).toHaveTextContent(ACCUSATION_LINE);
  expect(approvedAcc).toHaveTextContent('Báo cáo đúng · người báo cáo +1 điểm');
  expect(approvedAcc).not.toHaveTextContent('bạn +1');
  expect(rejectedAcc).toHaveTextContent('Báo cáo bị bác: Không phải Dân phòng');
  expect(within(approvedAcc).queryByText('Bị trừ điểm')).not.toBeInTheDocument();
});

test('a duplicate waiting for an earlier accusation: note with the earlier reporter, "Duyệt" disabled, "Từ chối" still works', async () => {
  let posted: unknown = null;
  stubFetch({
    [PENDING_ROUTE]: () => json(200, [report({ id: 1, accusation: null, accusationDuplicate: true, accusationWaitingFor: { reporterName: 'Ngỗng Ba' } })]),
    [REVIEW_1]: (init) => {
      posted = JSON.parse(String(init?.body));
      return noContent();
    },
  });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  expect(first).toHaveTextContent('Báo cáo trùng — chờ quyết báo cáo sớm hơn của Ngỗng Ba');
  const approve = within(first).getByRole('button', { name: 'Duyệt' });
  expect(approve).toBeDisabled();
  expect(approve).toHaveAccessibleDescription('Báo cáo trùng — chờ quyết báo cáo sớm hơn của Ngỗng Ba');

  fireEvent.click(within(first).getByRole('button', { name: 'Từ chối' }));
  fireEvent.change(within(first).getByRole('textbox', { name: 'Lý do từ chối' }), { target: { value: 'Khai gian' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận từ chối' }));
  await waitFor(() => expect(posted).toEqual({ approve: false, reason: 'Khai gian' }));
});

test('a review that decided an accusation refreshes the queue (the next duplicate may surface)', async () => {
  let listCalls = 0;
  stubFetch({
    [PENDING_ROUTE]: () => {
      listCalls += 1;
      return json(200, listCalls === 1 ? [report({ id: 1, accusation: accusation() })] : []);
    },
    [REVIEW_1]: () => noContent(),
  });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt' }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: PENDING_REPORTS_KEY }));
  await waitFor(() => expect(listCalls).toBe(2));
});

test('a review without an accusation decision does not refetch the queue', async () => {
  stubFetch({ [PENDING_ROUTE]: () => json(200, queue), 'POST /api/admin/reports/2/review': () => noContent() });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const second = (await screen.findAllByRole('listitem'))[1] as HTMLElement;
  fireEvent.click(within(second).getByRole('button', { name: 'Duyệt' }));
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: PENDING_REPORTS_KEY });
});

test('VALIDATION on review shows the message and refetches the queue', async () => {
  let listCalls = 0;
  stubFetch({
    [PENDING_ROUTE]: () => {
      listCalls += 1;
      return json(200, listCalls === 1 ? queue : [report({ id: 1, accusation: accusation() })]);
    },
    [REVIEW_1]: () => json(400, { error: { code: 'VALIDATION', message: 'Cần chọn duyệt hay bỏ báo cáo kèm lần khai' } }),
  });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Cần chọn duyệt hay bỏ báo cáo kèm lần khai');
  await waitFor(() => expect(listCalls).toBe(2));
  expect(await screen.findByText(ACCUSATION_LINE)).toBeInTheDocument();
});

test('a reason error of one form does not show under the other form', async () => {
  const fetchMock = stubFetch({ [PENDING_ROUTE]: () => json(200, [report({ id: 1, accusation: accusation() })]) });
  renderTab();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;

  // Lỗi lý do của "Duyệt, bỏ báo cáo" không sang form Từ chối.
  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt, bỏ báo cáo' }));
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận duyệt, bỏ báo cáo' }));
  expect(await within(first).findByRole('alert')).toHaveTextContent('Cần ghi lý do bỏ báo cáo');
  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ' }));
  expect(within(first).queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(within(first).getByRole('button', { name: 'Từ chối' }));
  expect(within(first).queryByRole('alert')).not.toBeInTheDocument();

  // Ngược lại: lỗi lý do từ chối không sang form bỏ báo cáo, kể cả khi mở lại.
  fireEvent.click(within(first).getByRole('button', { name: 'Xác nhận từ chối' }));
  expect(await within(first).findByRole('alert')).toHaveTextContent('Cần ghi lý do từ chối');
  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ' }));
  fireEvent.click(within(first).getByRole('button', { name: 'Duyệt, bỏ báo cáo' }));
  expect(within(first).queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(within(first).getByRole('button', { name: 'Huỷ' }));
  fireEvent.click(within(first).getByRole('button', { name: 'Từ chối' }));
  expect(within(first).queryByRole('alert')).not.toBeInTheDocument();
  expect(postCalls(fetchMock)).toHaveLength(0);
});
