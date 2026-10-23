import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { EndOptionDto, ModeDto, OpenVoteRoundDto, SessionDto } from '../../src/shared/api-types';
import { vnTodayIso } from '../../src/web/lib/format';
import { SessionsTab } from '../../src/web/pages/admin/SessionsTab';

const today = vnTodayIso();

const modes: ModeDto[] = [
  { id: 1, key: 'classic', nameVi: 'Cổ điển (Classic)' },
  { id: 3, key: 'goose_hunt', nameVi: 'Săn ngỗng (Goose Hunt)' },
];

const base: Omit<SessionDto, 'id' | 'startsAt'> = {
  modeName: 'Cổ điển (Classic)',
  capacity: 16,
  roomCode: null,
  note: null,
  status: 'scheduled',
  attendees: [
    { memberId: 1, displayName: 'Ngỗng Một', avatarUrl: null },
    { memberId: 2, displayName: 'Vịt Hai', avatarUrl: null },
  ],
  myStatus: null,
};

const sessions: SessionDto[] = [
  { ...base, id: 5, startsAt: `${today}T14:00:00.000Z`, roomCode: 'ABCD' },
  { ...base, id: 6, startsAt: `${today}T12:00:00.000Z`, status: 'ended', attendees: [] },
];

const endOptions: EndOptionDto[] = [
  { id: 1, name: 'Giết nhiều nhất', scope: 'always', preselected: true },
  { id: 4, name: 'Ngỗng chạy giỏi nhất', scope: 'mode', preselected: true },
  { id: 5, name: 'Pha đẻ trứng lộ liễu nhất (Cò gáy)', scope: 'optional', preselected: false },
];

const rounds: OpenVoteRoundDto[] = [{ id: 3, sessionId: 6, sessionLabel: 'Cổ điển (Classic) 19:00 22/10', closesAt: '2026-10-23T02:00:00.000Z' }];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** fetch giả định tuyến theo `METHOD path` (bỏ query string). */
function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('?')[0] ?? url;
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Không có tuyến giả cho ${key}`);
    return Promise.resolve(handler(init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const baseRoutes: Record<string, Handler> = {
  'GET /api/modes': () => json(200, modes),
  'GET /api/sessions': () => json(200, sessions),
  'GET /api/admin/vote-rounds': () => json(200, rounds),
  'GET /api/admin/sessions/5/end-options': () => json(200, endOptions),
};

const renderTab = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionsTab />
    </QueryClientProvider>,
  );
};

const postCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST').map(([url]) => String(url));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('creating a session posts date, time, mode, capacity and room code, then shows the day', async () => {
  let posted: unknown = null;
  const fetchMock = stubFetch({
    ...baseRoutes,
    'POST /api/admin/sessions': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, { ...base, id: 9, startsAt: `${today}T13:30:00.000Z`, roomCode: 'ABCD', attendees: [] });
    },
  });
  renderTab();

  const date = await screen.findByLabelText('Ngày');
  expect(date).toHaveValue(today);
  expect(screen.getByLabelText('Sức chứa')).toHaveValue(16);
  // Chế độ đầu tiên được chọn sẵn khi danh sách tới.
  await waitFor(() => expect(screen.getByLabelText('Chế độ chơi')).toHaveValue('1'));

  fireEvent.change(screen.getByLabelText('Giờ bắt đầu'), { target: { value: '20:30' } });
  fireEvent.change(screen.getByLabelText('Sức chứa'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('Mã phòng'), { target: { value: 'ABCD' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo buổi' }));

  await waitFor(() => expect(posted).toEqual({ date: today, time: '20:30', modeId: 1, capacity: 10, roomCode: 'ABCD' }));
  expect(await screen.findByText('Đã tạo buổi 20:30 Cổ điển (Classic)')).toBeInTheDocument();
  // Danh sách buổi được tải lại.
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/sessions?date=')).length).toBeGreaterThan(1));
});

test('only scheduled sessions offer Kết thúc and Huỷ buổi', async () => {
  stubFetch(baseRoutes);
  renderTab();

  const scheduled = await screen.findByRole('article', { name: '21:00 Cổ điển (Classic)' });
  expect(scheduled).toHaveTextContent('2/16');
  expect(scheduled).toHaveTextContent('Mã phòng: ABCD');
  expect(within(scheduled).getByRole('button', { name: 'Kết thúc' })).toBeInTheDocument();
  expect(within(scheduled).getByRole('button', { name: 'Huỷ buổi' })).toBeInTheDocument();

  const ended = screen.getByRole('article', { name: '19:00 Cổ điển (Classic)' });
  expect(ended).toHaveTextContent('Đã kết thúc');
  expect(within(ended).queryByRole('button')).not.toBeInTheDocument();
});

test('the end dialog pre-ticks always/mode categories and posts the ticked ids', async () => {
  let posted: unknown = null;
  stubFetch({
    ...baseRoutes,
    'POST /api/admin/sessions/5/end': (init) => {
      posted = JSON.parse(String(init?.body));
      return noContent();
    },
  });
  renderTab();

  const scheduled = await screen.findByRole('article', { name: '21:00 Cổ điển (Classic)' });
  fireEvent.click(within(scheduled).getByRole('button', { name: 'Kết thúc' }));

  const dialog = await screen.findByRole('dialog', { name: 'Kết thúc buổi 21:00 Cổ điển (Classic)' });
  const always = await within(dialog).findByRole('checkbox', { name: /Giết nhiều nhất/ });
  const mode = within(dialog).getByRole('checkbox', { name: /Ngỗng chạy giỏi nhất/ });
  const optional = within(dialog).getByRole('checkbox', { name: /Pha đẻ trứng lộ liễu nhất/ });
  expect(always).toBeChecked();
  expect(mode).toBeChecked();
  expect(optional).not.toBeChecked();

  fireEvent.click(optional);
  fireEvent.click(mode);
  fireEvent.click(mode); // bỏ rồi tick lại: vẫn gửi
  fireEvent.click(within(dialog).getByRole('button', { name: 'Kết thúc buổi' }));

  await waitFor(() => expect(posted).toEqual({ categoryIds: [1, 4, 5] }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('the end dialog takes focus on open, traps Tab, and hands focus back to Kết thúc on Escape', async () => {
  stubFetch(baseRoutes);
  renderTab();

  const scheduled = await screen.findByRole('article', { name: '21:00 Cổ điển (Classic)' });
  const trigger = within(scheduled).getByRole('button', { name: 'Kết thúc' });
  trigger.focus();
  fireEvent.click(trigger);

  const dialog = await screen.findByRole('dialog', { name: 'Kết thúc buổi 21:00 Cổ điển (Classic)' });
  // Tiêu điểm vào trong hộp ngay khi mở (nội dung còn đang tải → chính hộp nhận).
  expect(dialog.contains(document.activeElement)).toBe(true);

  // Khi hạng mục tới: Tab từ phần tử cuối quay về phần tử đầu, Shift+Tab ngược lại.
  const first = await within(dialog).findByRole('checkbox', { name: /Giết nhiều nhất/ });
  const last = within(dialog).getByRole('button', { name: 'Đóng' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();

  fireEvent.keyDown(last, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

test('closing the end dialog with Đóng also restores focus to the trigger', async () => {
  stubFetch(baseRoutes);
  renderTab();

  const scheduled = await screen.findByRole('article', { name: '21:00 Cổ điển (Classic)' });
  const trigger = within(scheduled).getByRole('button', { name: 'Kết thúc' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Kết thúc buổi 21:00 Cổ điển (Classic)' });
  // Như một cú bấm chuột thật: nút Đóng nhận tiêu điểm rồi mới bấm.
  const close = await within(dialog).findByRole('button', { name: 'Đóng' });
  close.focus();
  expect(close).toHaveFocus();
  fireEvent.click(close);

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

test('Huỷ buổi and Đóng vote sớm ask for confirmation before posting', async () => {
  const fetchMock = stubFetch({
    ...baseRoutes,
    'POST /api/admin/sessions/5/cancel': () => noContent(),
    'POST /api/admin/vote-rounds/3/close': () => noContent(),
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  renderTab();

  const scheduled = await screen.findByRole('article', { name: '21:00 Cổ điển (Classic)' });
  fireEvent.click(within(scheduled).getByRole('button', { name: 'Huỷ buổi' }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Huỷ buổi 21:00 Cổ điển (Classic)'));
  expect(postCalls(fetchMock)).toEqual([]);

  confirm.mockReturnValue(true);
  fireEvent.click(within(scheduled).getByRole('button', { name: 'Huỷ buổi' }));
  await waitFor(() => expect(postCalls(fetchMock)).toEqual(['/api/admin/sessions/5/cancel']));

  expect(screen.getByText('Cổ điển (Classic) 19:00 22/10')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng vote sớm' }));
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Cổ điển (Classic) 19:00 22/10'));
  await waitFor(() => expect(postCalls(fetchMock)).toEqual(['/api/admin/sessions/5/cancel', '/api/admin/vote-rounds/3/close']));
});

test('a failed cancel shows the API message by that session', async () => {
  stubFetch({
    ...baseRoutes,
    'POST /api/admin/sessions/5/cancel': () => json(409, { error: { code: 'SESSION_NOT_OPEN', message: 'Buổi chơi đã kết thúc hoặc bị huỷ' } }),
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderTab();

  const scheduled = await screen.findByRole('article', { name: '21:00 Cổ điển (Classic)' });
  fireEvent.click(within(scheduled).getByRole('button', { name: 'Huỷ buổi' }));
  expect(await within(scheduled).findByRole('alert')).toHaveTextContent('Buổi chơi đã kết thúc hoặc bị huỷ');
});
