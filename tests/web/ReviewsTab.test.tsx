import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReportDto } from '../../src/shared/api-types';
import { ReviewsTab } from '../../src/web/pages/admin/ReviewsTab';

const report = (over: Partial<ReportDto> & Pick<ReportDto, 'id'>): ReportDto => ({
  member: { id: 9, displayName: 'Ngỗng Chín' },
  role: { id: 61, nameVi: 'Kiếm sĩ', icon: '⚔️', metricLabel: 'Số mạng chém' },
  value: 4,
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
  report({ id: 2, member: { id: 10, displayName: 'Vịt Mười' }, role: { id: 1, nameVi: 'Ngỗng', icon: '🪿', metricLabel: 'Số lần vote trúng Vịt' }, value: 2, sessionId: null, note: null }),
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = routes[key];
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
};

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
