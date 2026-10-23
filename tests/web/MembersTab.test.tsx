import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminMemberDto, NotificationFailureDto } from '../../src/shared/api-types';
import { FailuresTab } from '../../src/web/pages/admin/FailuresTab';
import { MembersTab } from '../../src/web/pages/admin/MembersTab';

const members: AdminMemberDto[] = [
  { id: 1, memberCode: 'GGD-0001', displayName: 'Admin Một', accessLevel: 'admin', status: 'active', email: 'admin@example.com', joinedAt: '2026-09-30T17:30:00.000Z' },
  { id: 2, memberCode: 'GGD-0002', displayName: 'Kẹ', accessLevel: 'member', status: 'left', email: null, joinedAt: '2026-10-01T03:00:00.000Z' },
];

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

const renderWithClient = (node: ReactNode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('members list code, name, level, status, email when present and the join date', async () => {
  stubFetch(() => json(200, members));
  renderWithClient(<MembersTab />);

  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('GGD-0001');
  expect(items[0]).toHaveTextContent('Admin Một');
  expect(items[0]).toHaveTextContent('Admin');
  expect(items[0]).toHaveTextContent('Đang hoạt động');
  expect(items[0]).toHaveTextContent('admin@example.com');
  // 17:30Z ngày 30/09 là 01/10 giờ VN.
  expect(items[0]).toHaveTextContent('01/10/2026');
  expect(items[1]).toHaveTextContent('Thành viên');
  expect(items[1]).toHaveTextContent('Đã rời');
  expect(items[1]).not.toHaveTextContent('@');
  expect(screen.getByText('2 thành viên')).toBeInTheDocument();
});

test('search is debounced and sent with the status filter', async () => {
  const fetchMock = stubFetch(() => json(200, members));
  renderWithClient(<MembersTab />);
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
