import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminOfflineEventDto } from '../../src/shared/api-types';
import { OFFLINE_UPCOMING_KEY } from '../../src/web/lib/queryKeys';
import { OfflineTab } from '../../src/web/pages/admin/OfflineTab';

const row = (over: Partial<AdminOfflineEventDto> & Pick<AdminOfflineEventDto, 'id' | 'title'>): AdminOfflineEventDto => ({
  // 18:30 Thứ Bảy 24/10 giờ VN.
  startsAt: '2026-10-24T11:30:00.000Z',
  place: 'Quận 1',
  description: null,
  voteDeadline: null,
  closed: false,
  past: false,
  goingCount: 0,
  notGoingCount: 0,
  ...over,
});

const list: AdminOfflineEventDto[] = [
  row({ id: 1, title: 'Cafe Ngỗng', description: 'Mang bài', voteDeadline: '2026-10-24T05:00:00.000Z', goingCount: 5, notGoingCount: 2 }),
  row({ id: 2, title: 'Picnic cũ', startsAt: '2026-10-01T03:00:00.000Z', past: true, closed: true }),
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * Tuyến giả. Danh sách có trạng thái: PATCH/DELETE giả (trả 2xx) sửa luôn danh sách, để lần tải lại
 * sau khi lưu (làm mới cache) thấy đúng dữ liệu mới như server thật.
 */
function stubFetch(routes: Record<string, Handler>) {
  let current = [...list];
  const all: Record<string, Handler> = { 'GET /api/admin/offline-events': () => json(200, current), ...routes };
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = all[key];
    if (!handler) throw new Error(`Không có tuyến giả cho ${key}`);
    const id = Number(/\/(\d+)$/.exec(url)?.[1]);
    return Promise.resolve(handler(init)).then(async (res) => {
      if (res.ok && init?.method === 'DELETE') current = current.filter((item) => item.id !== id);
      if (res.ok && init?.method === 'PATCH') {
        const updated = (await res.clone().json()) as AdminOfflineEventDto;
        current = current.map((item) => (item.id === id ? updated : item));
      }
      return res;
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderTab = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OfflineTab />
    </QueryClientProvider>,
  );
  return queryClient;
};

const rows = async () => within(await screen.findByRole('region', { name: 'Sự kiện offline' })).findAllByRole('listitem');
const bodyOf = (fetchMock: ReturnType<typeof stubFetch>, method: string) =>
  JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === method)?.[1]?.body));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('each row shows name, time, place, both counts and the actions', async () => {
  stubFetch({});
  renderTab();
  const [first, second] = await rows();
  expect(first).toHaveTextContent('Cafe Ngỗng');
  expect(first).toHaveTextContent('Thứ Bảy, 24/10 lúc 18:30');
  expect(first).toHaveTextContent('📍 Quận 1');
  expect(first).toHaveTextContent('5 đi được · 2 không đi được');
  expect(first).toHaveTextContent('Hạn vote: Thứ Bảy, 24/10 lúc 12:00');
  expect(within(first as HTMLElement).getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
  expect(within(first as HTMLElement).getByRole('button', { name: 'Đóng vote' })).toBeInTheDocument();
  expect(within(first as HTMLElement).getByRole('button', { name: 'Xoá' })).toBeInTheDocument();
  expect(second).toHaveTextContent('Đã qua');
  expect(second).toHaveTextContent('Đã đóng vote');
  expect(within(second as HTMLElement).getByRole('button', { name: 'Mở lại' })).toBeInTheDocument();
});

test('creating sends VN wall-clock times, refreshes the Today card and clears the form', async () => {
  const fetchMock = stubFetch({ 'POST /api/admin/offline-events': () => json(201, row({ id: 3, title: 'BBQ' })) });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const form = await screen.findByRole('form', { name: 'Thêm sự kiện offline' });
  fireEvent.change(within(form).getByLabelText('Tên'), { target: { value: '  BBQ ' } });
  fireEvent.change(within(form).getByLabelText('Thời gian'), { target: { value: '2026-11-01T10:00' } });
  fireEvent.change(within(form).getByLabelText('Địa điểm'), { target: { value: 'Nhà An' } });
  fireEvent.change(within(form).getByLabelText('Hạn vote'), { target: { value: '2026-10-31T22:00' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm sự kiện' }));

  expect(await screen.findByText('Đã thêm “BBQ”')).toBeInTheDocument();
  expect(bodyOf(fetchMock, 'POST')).toEqual({ title: 'BBQ', startsAt: '2026-11-01T10:00', place: 'Nhà An', description: null, voteDeadline: '2026-10-31T22:00' });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: OFFLINE_UPCOMING_KEY });
  expect(within(screen.getByRole('form', { name: 'Thêm sự kiện offline' })).getByLabelText('Tên')).toHaveValue('');
});

test('local checks use the spec texts; server errors show under the form', async () => {
  stubFetch({ 'POST /api/admin/offline-events': () => json(400, { error: { code: 'VALIDATION', message: 'Mô tả tối đa 500 ký tự' } }) });
  renderTab();
  const form = await screen.findByRole('form', { name: 'Thêm sự kiện offline' });
  const submit = within(form).getByRole('button', { name: 'Thêm sự kiện' });
  fireEvent.click(submit);
  expect(await within(form).findByRole('alert')).toHaveTextContent('Tên 1–80 ký tự');
  fireEvent.change(within(form).getByLabelText('Tên'), { target: { value: 'BBQ' } });
  fireEvent.click(submit);
  expect(within(form).getByRole('alert')).toHaveTextContent('Hãy chọn thời gian');
  fireEvent.change(within(form).getByLabelText('Thời gian'), { target: { value: '2026-11-01T10:00' } });
  fireEvent.click(submit);
  expect(within(form).getByRole('alert')).toHaveTextContent('Địa điểm 1–120 ký tự');
  fireEvent.change(within(form).getByLabelText('Địa điểm'), { target: { value: 'Nhà' } });
  fireEvent.change(within(form).getByLabelText('Hạn vote'), { target: { value: '2026-11-01T10:01' } });
  fireEvent.click(submit);
  expect(within(form).getByRole('alert')).toHaveTextContent('Hạn vote phải trước giờ sự kiện');
  fireEvent.change(within(form).getByLabelText('Hạn vote'), { target: { value: '' } });
  fireEvent.click(submit);
  expect(await within(form).findByRole('alert')).toHaveTextContent('Mô tả tối đa 500 ký tự');
});

test('editing pre-fills VN times and sends only the changes', async () => {
  const fetchMock = stubFetch({ 'PATCH /api/admin/offline-events/1': () => json(200, { ...list[0], place: 'Quận 3' }) });
  renderTab();
  const [first] = await rows();
  fireEvent.click(within(first as HTMLElement).getByRole('button', { name: 'Sửa' }));
  const form = await screen.findByRole('form', { name: 'Sửa Cafe Ngỗng' });
  expect(within(form).getByLabelText('Thời gian')).toHaveValue('2026-10-24T18:30');
  expect(within(form).getByLabelText('Hạn vote')).toHaveValue('2026-10-24T12:00');
  expect(within(form).getByLabelText('Mô tả')).toHaveValue('Mang bài');
  fireEvent.change(within(form).getByLabelText('Địa điểm'), { target: { value: 'Quận 3' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Sửa Cafe Ngỗng' })).not.toBeInTheDocument());
  expect(bodyOf(fetchMock, 'PATCH')).toEqual({ place: 'Quận 3' });
  expect((await rows())[0]).toHaveTextContent('📍 Quận 3');
});

test('"Đóng vote" closes and "Mở lại" reopens', async () => {
  const fetchMock = stubFetch({
    'PATCH /api/admin/offline-events/1': () => json(200, { ...list[0], closed: true }),
    'PATCH /api/admin/offline-events/2': () => json(200, { ...list[1], closed: false }),
  });
  renderTab();
  const [first, second] = await rows();
  fireEvent.click(within(first as HTMLElement).getByRole('button', { name: 'Đóng vote' }));
  expect(await within(first as HTMLElement).findByRole('button', { name: 'Mở lại' })).toBeInTheDocument();
  expect(bodyOf(fetchMock, 'PATCH')).toEqual({ closed: true });
  fireEvent.click(within(second as HTMLElement).getByRole('button', { name: 'Mở lại' }));
  expect(await within(second as HTMLElement).findByRole('button', { name: 'Đóng vote' })).toBeInTheDocument();
});

test('delete asks first, then removes the row', async () => {
  const fetchMock = stubFetch({ 'DELETE /api/admin/offline-events/1': () => noContent() });
  renderTab();
  const [first] = await rows();
  fireEvent.click(within(first as HTMLElement).getByRole('button', { name: 'Xoá' }));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  expect(within(first as HTMLElement).getByText('Xoá sự kiện này?')).toBeInTheDocument();
  fireEvent.click(within(first as HTMLElement).getByRole('button', { name: 'Xác nhận xoá' }));
  await waitFor(async () => expect(await rows()).toHaveLength(1));
});
