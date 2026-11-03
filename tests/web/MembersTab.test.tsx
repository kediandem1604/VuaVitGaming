import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminMemberDto, MeDto, NotificationFailureDto } from '../../src/shared/api-types';
import { FailuresTab } from '../../src/web/pages/admin/FailuresTab';
import { STAGGER_TOTAL_MS } from '../../src/web/lib/motion';
import { MembersTab } from '../../src/web/pages/admin/MembersTab';

const members: AdminMemberDto[] = [
  {
    id: 1,
    memberCode: 'GGD-0001',
    displayName: 'Admin Một',
    accessLevel: 'admin',
    status: 'active',
    email: 'admin@example.com',
    joinedAt: '2026-10-20T03:00:00.000Z',
    // Ngày vào server theo Discord, sớm hơn ngày app thấy: 17:30Z ngày 30/09 là 01/10 giờ VN.
    serverJoinedAt: '2026-09-30T17:30:00.000Z',
    daysInServer: 21,
    games: 14,
    gamesAdjustment: 12,
  },
  {
    id: 2,
    memberCode: 'GGD-0002',
    displayName: 'Kẹ',
    accessLevel: 'member',
    status: 'left',
    email: null,
    joinedAt: '2026-10-01T03:00:00.000Z',
    serverJoinedAt: '2026-10-01T03:00:00.000Z',
    daysInServer: 4,
    games: 0,
    gamesAdjustment: -3,
  },
];

/** Người đang xem (Outlet context như trong App): admin mặc định, hoặc mod. */
const viewer = (accessLevel: MeDto['accessLevel']): MeDto => ({
  id: 1,
  memberCode: 'GGD-0001',
  displayName: 'Admin Một',
  avatarUrl: null,
  email: 'admin@example.com',
  notifyEmail: true,
  notifyDm: true,
  accessLevel,
});

const failures: NotificationFailureDto[] = [
  {
    sessionId: 7,
    sessionLabel: 'Cổ điển (Classic) 21:00 22/10',
    memberId: 2,
    displayName: 'Kẹ',
    kind: 'pre15',
    channel: 'email',
    sentAt: '2026-10-22T13:45:00.000Z',
    error: 'Hộp thư không tồn tại',
  },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(handler: (url: string) => Response) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

const renderWithClient = (node: ReactNode, queryClient = makeClient()) => {
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  return queryClient;
};

/** Tab Thành viên trong Outlet context của người xem (admin mặc định). */
const renderMembers = (me: MeDto = viewer('admin'), queryClient = makeClient()) =>
  renderWithClient(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={me} />}>
          <Route path="/" element={<MembersTab />} />
        </Route>
      </Routes>
    </MemoryRouter>,
    queryClient,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('members list code, name, level, left status, email when present, days in server and games', async () => {
  stubFetch(() => json(200, members));
  renderMembers();

  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('GGD-0001');
  expect(items[0]).toHaveTextContent('Admin Một');
  expect(items[0]).toHaveTextContent('Admin');
  expect(items[0]).toHaveTextContent('admin@example.com');
  // Ngày vào server hiệu lực (theo Discord), không phải ngày app thấy: 17:30Z ngày 30/09 là 01/10 giờ VN.
  expect(items[0]).toHaveTextContent('Trong server 21 ngày · từ 01/10/2026');
  expect(items[0]).not.toHaveTextContent('20/10/2026');
  expect(items[0]).toHaveTextContent('14 buổi');
  expect(items[0]).toHaveTextContent('(đã chỉnh +12)');
  // Không còn chip "Đang hoạt động" trên dòng (bộ lọc trạng thái vẫn có lựa chọn đó); người đã rời vẫn có chip "Đã rời".
  expect(items[0]).not.toHaveTextContent('Đang hoạt động');
  expect(within(screen.getByRole('list')).queryByText('Đang hoạt động')).toBeNull();
  expect(items[1]).toHaveTextContent('Thành viên');
  expect(items[1]).toHaveTextContent('Đã rời');
  expect(items[1]).not.toHaveTextContent('@');
  expect(items[1]).toHaveTextContent('Trong server 4 ngày · từ 01/10/2026');
  expect(items[1]).toHaveTextContent('0 buổi');
  expect(items[1]).toHaveTextContent('(đã chỉnh −3)'); // dấu trừ U+2212
  expect(screen.getByText('2 thành viên')).toBeInTheDocument();
});

test('the games note is absent when nothing was adjusted', async () => {
  stubFetch(() => json(200, [{ ...members[1]!, gamesAdjustment: 0, games: 7 }]));
  renderMembers();
  const [item] = await screen.findAllByRole('listitem');
  expect(item).toHaveTextContent('7 buổi');
  expect(item).not.toHaveTextContent('đã chỉnh');
});

test('only admins see the Sửa số buổi button', async () => {
  stubFetch(() => json(200, members));
  renderMembers(viewer('admin'));
  await screen.findAllByRole('listitem');
  expect(screen.getAllByRole('button', { name: 'Sửa số buổi' })).toHaveLength(2);
  cleanup();

  stubFetch(() => json(200, members));
  renderMembers(viewer('mod'));
  await screen.findAllByRole('listitem');
  expect(screen.queryByRole('button', { name: 'Sửa số buổi' })).toBeNull();
});

/** Mở form của dòng thứ `index` và trả về ô số cùng nút Lưu. */
async function openGamesForm(index: number) {
  const items = await screen.findAllByRole('listitem');
  const item = items[index] as HTMLElement;
  fireEvent.click(within(item).getByRole('button', { name: 'Sửa số buổi' }));
  const input = within(item).getByRole('spinbutton', { name: 'Tổng số buổi' });
  const save = within(item).getByRole('button', { name: 'Lưu' });
  return { item, input, save };
}

test('local validation rejects empty, fractional and out-of-range totals without a request', async () => {
  const fetchMock = stubFetch(() => json(200, members));
  renderMembers();
  const { item, input, save } = await openGamesForm(0);
  // Giá trị đầu = tổng hiện tại, giới hạn 0..10000 bước 1.
  expect(input).toHaveValue(14);
  expect(input).toHaveAttribute('min', '0');
  expect(input).toHaveAttribute('max', '10000');
  expect(input).toHaveAttribute('step', '1');
  const calls = fetchMock.mock.calls.length;

  for (const value of ['', '1.5', '-1', '10001']) {
    fireEvent.change(input, { target: { value } });
    fireEvent.click(save);
    expect(within(item).getByRole('alert'), value).toHaveTextContent('Số buổi phải là số nguyên từ 0 đến 10000');
  }
  expect(fetchMock.mock.calls.length).toBe(calls);
});

test('saving sends the total, updates the row in place and refreshes the public member cache', async () => {
  const saved: AdminMemberDto = { ...members[0]!, games: 20, gamesAdjustment: 18 };
  const fetchMock = stubFetch((url) => (url === '/api/admin/members/1/games' ? json(200, saved) : json(200, members)));
  const queryClient = renderMembers();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const { item, input, save } = await openGamesForm(0);

  fireEvent.change(input, { target: { value: '20' } });
  fireEvent.click(save);
  await waitFor(() => expect(within(item).queryByRole('spinbutton')).toBeNull());

  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/admin/members/1/games');
  expect(call).toBeDefined();
  const init = call![1] as RequestInit;
  expect(init.method).toBe('PUT');
  expect(JSON.parse(String(init.body))).toEqual({ games: 20 });

  expect(item).toHaveTextContent('20 buổi');
  expect(item).toHaveTextContent('(đã chỉnh +18)');
  // Không tải lại danh sách — dòng được sửa trong cache; trang thành viên công khai được làm mới.
  expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/admin/members')).toHaveLength(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['member'] });
});

test('saving updates the same member in every cached members list, not only the visible filter', async () => {
  const saved: AdminMemberDto = { ...members[0]!, games: 20, gamesAdjustment: 18 };
  stubFetch((url) => (url === '/api/admin/members/1/games' ? json(200, saved) : json(200, members)));
  const queryClient = makeClient();
  // Danh sách của bộ lọc khác đã xem trước đó (và một danh sách không có người này).
  queryClient.setQueryData(['admin', 'members', '', 'active'], [members[0]]);
  queryClient.setQueryData(['admin', 'members', 'kẹ', ''], [members[1]]);
  renderMembers(viewer('admin'), queryClient);
  const { item, input, save } = await openGamesForm(0);

  fireEvent.change(input, { target: { value: '20' } });
  fireEvent.click(save);
  await waitFor(() => expect(within(item).queryByRole('spinbutton')).toBeNull());

  expect(queryClient.getQueryData<AdminMemberDto[]>(['admin', 'members', '', ''])?.[0]).toMatchObject({ id: 1, games: 20 });
  expect(queryClient.getQueryData<AdminMemberDto[]>(['admin', 'members', '', 'active'])).toEqual([saved]);
  expect(queryClient.getQueryData<AdminMemberDto[]>(['admin', 'members', 'kẹ', ''])).toEqual([members[1]]);
});

test('a server error shows the message and keeps the form open', async () => {
  stubFetch((url) =>
    url === '/api/admin/members/1/games' ? json(400, { error: { code: 'VALIDATION', message: 'Số buổi phải là số nguyên từ 0 đến 10000' } }) : json(200, members),
  );
  renderMembers();
  const { item, input, save } = await openGamesForm(0);
  fireEvent.change(input, { target: { value: '30' } });
  fireEvent.click(save);
  expect(await within(item).findByRole('alert')).toHaveTextContent('Số buổi phải là số nguyên từ 0 đến 10000');
  expect(within(item).getByRole('spinbutton', { name: 'Tổng số buổi' })).toBeInTheDocument();
  expect(item).toHaveTextContent('14 buổi');

  // Gõ tiếp: lời nhắn lỗi của lần lưu trước biến mất.
  fireEvent.change(input, { target: { value: '31' } });
  await waitFor(() => expect(within(item).queryByRole('alert')).toBeNull());
  expect(input).toHaveValue(31);
});

test('Thôi closes the form without saving', async () => {
  const fetchMock = stubFetch(() => json(200, members));
  renderMembers();
  const { item, input } = await openGamesForm(1);
  fireEvent.change(input, { target: { value: '9' } });
  fireEvent.click(within(item).getByRole('button', { name: 'Thôi' }));
  expect(within(item).queryByRole('spinbutton')).toBeNull();
  expect(within(item).getByRole('button', { name: 'Sửa số buổi' })).toBeInTheDocument();
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/games'))).toBe(false);
  expect(item).toHaveTextContent('0 buổi');
});

test('search is debounced and sent with the status filter', async () => {
  const fetchMock = stubFetch(() => json(200, members));
  renderMembers();
  await screen.findAllByRole('listitem');
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/members', expect.anything());

  const search = screen.getByRole('searchbox', { name: 'Tìm thành viên' });
  fireEvent.change(search, { target: { value: 'k' } });
  fireEvent.change(search, { target: { value: 'kẹ' } });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/members?q=k%E1%BA%B9', expect.anything()), { timeout: 2000 });
  // Chữ gõ dở ("k") không được gửi.
  expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/members?q=k', expect.anything());

  fireEvent.change(screen.getByRole('combobox', { name: 'Trạng thái' }), { target: { value: 'left' } });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/members?q=k%E1%BA%B9&status=left', expect.anything()));
});

test('failures list the session, member, kind, channel, time and error; empty copy otherwise', async () => {
  stubFetch(() => json(200, failures));
  renderWithClient(<FailuresTab />);
  const item = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  expect(item).toHaveTextContent('Cổ điển (Classic) 21:00 22/10');
  expect(item).toHaveTextContent('Kẹ');
  expect(item).toHaveTextContent('Nhắc trước giờ');
  expect(item).toHaveTextContent('Email');
  expect(item).toHaveTextContent('20:45 22/10/2026');
  expect(item).toHaveTextContent('Hộp thư không tồn tại');
  cleanup();

  stubFetch(() => json(200, []));
  renderWithClient(<FailuresTab />);
  expect(await screen.findByText('Chưa có lần gửi nhắc nào lỗi')).toBeInTheDocument();
});

test('a members list that arrives slower than the stagger still staggers in, then the class goes away', async () => {
  // Danh sách về sau cả lượt so le (~510ms): đồng hồ so le chỉ được chạy từ lúc có dòng.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => setTimeout(() => resolve(json(200, members)), STAGGER_TOTAL_MS + 100))),
  );
  renderMembers();
  const list = await screen.findByRole('list', {}, { timeout: STAGGER_TOTAL_MS * 3 });
  expect(list).toHaveClass('stagger-in');
  await waitFor(() => expect(screen.getByRole('list')).not.toHaveClass('stagger-in'), { timeout: STAGGER_TOTAL_MS * 3 });
});
