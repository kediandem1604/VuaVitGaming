import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReportDto, ReviewedReportDto } from '../../src/shared/api-types';
import { APPROVED_REPORTS_KEY, LEADERBOARD_TOTALS_KEY, MY_REPORTS_KEY, TITLES_QUERY_KEY } from '../../src/web/lib/queryKeys';
import { ReviewsTab } from '../../src/web/pages/admin/ReviewsTab';

/** Phần role của một lần khai; `extra` = ba trường chỉ số phụ (mặc định không có). */
const reportRole = (
  id: number,
  nameVi: string,
  icon: string,
  metricLabel: string,
  maxPerGame = 15,
  extra: Pick<ReportDto['role'], 'extraMetricLabel' | 'extraMaxPerGame' | 'extraPoints'> = { extraMetricLabel: null, extraMaxPerGame: null, extraPoints: null },
): ReportDto['role'] => ({ id, nameVi, icon, metricLabel, maxPerGame, ...extra });

const ASSASSIN = reportRole(50, 'Ám sát', '🗡️', 'Số mạng đã giết', 15, { extraMetricLabel: 'Số lần ám sát trong cuộc họp', extraMaxPerGame: 2, extraPoints: 3 });

const report = (over: Partial<ReportDto> & Pick<ReportDto, 'id'>): ReportDto => ({
  member: { id: 9, displayName: 'Ngỗng Chín' },
  role: reportRole(61, 'Kiếm sĩ', '⚔️', 'Số mạng chém'),
  value: 4,
  extraValue: 0,
  points: over.value ?? 4,
  playedOn: '2026-10-22',
  sessionId: 7,
  note: 'Trận cuối',
  status: 'pending',
  rejectReason: null,
  createdAt: '2026-10-22T13:00:00.000Z',
  highlightUrl: null,
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
    [APPROVED_ROUTE]: () => json(200, approved),
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
