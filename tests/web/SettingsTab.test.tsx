import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminModeDto, AdminMultiplierDayDto, SettingsDto } from '../../src/shared/api-types';
import { addDaysIso, formatDayLabel, vnTodayIso } from '../../src/web/lib/format';
import { MULTIPLIER_UPCOMING_KEY } from '../../src/web/lib/queryKeys';
import { SettingsTab } from '../../src/web/pages/admin/SettingsTab';

const settings: SettingsDto = { voteDurationHours: 12, autoEndHours: 4, reminderLeadMinutes: 15 };
const modes: AdminModeDto[] = [
  { id: 1, key: 'classic', nameVi: 'Cổ điển (Classic)', nameEn: 'Classic', active: true },
  { id: 10, key: 'hanging_out', nameVi: 'Đi chơi (Hanging Out)', nameEn: 'Hanging Out', active: false },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const MULTIPLIERS_ROUTE = 'GET /api/admin/multiplier-days';

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Tuyến giả; danh sách ngày nhân điểm mặc định rỗng để mỗi test chỉ tả phần mình cần. */
function stubFetch(routes: Record<string, Handler>) {
  const all: Record<string, Handler> = { [MULTIPLIERS_ROUTE]: () => json(200, []), ...routes };
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
      <SettingsTab />
    </QueryClientProvider>,
  );
  return queryClient;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('the three inputs are prefilled and saved together', async () => {
  let patched: unknown = null;
  stubFetch({
    'GET /api/admin/settings': () => json(200, settings),
    'GET /api/admin/modes': () => json(200, modes),
    'PATCH /api/admin/settings': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...settings, voteDurationHours: 6 });
    },
  });
  renderTab();

  const vote = await screen.findByLabelText('Thời gian mở vote (giờ)');
  expect(vote).toHaveValue(12);
  expect(vote).toHaveAttribute('min', '1');
  expect(vote).toHaveAttribute('max', '72');
  expect(screen.getByLabelText('Tự kết thúc buổi sau (giờ)')).toHaveValue(4);
  expect(screen.getByLabelText('Nhắc trước (phút)')).toHaveValue(15);

  fireEvent.change(vote, { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patched).toEqual({ voteDurationHours: 6, autoEndHours: 4, reminderLeadMinutes: 15 }));
  expect(await screen.findByText('Đã lưu')).toBeInTheDocument();
});

test('out-of-range values are refused locally; server messages are shown', async () => {
  const fetchMock = stubFetch({
    'GET /api/admin/settings': () => json(200, settings),
    'GET /api/admin/modes': () => json(200, modes),
    'PATCH /api/admin/settings': () => json(400, { error: { code: 'VALIDATION', message: 'Dữ liệu không hợp lệ' } }),
  });
  renderTab();

  const lead = await screen.findByLabelText('Nhắc trước (phút)');
  fireEvent.change(lead, { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nhắc trước (phút) phải từ 5 đến 120');
  expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);

  fireEvent.change(lead, { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Dữ liệu không hợp lệ');
});

test('"Chế độ chơi" lists every mode; renaming and switching send a PATCH and refresh the public list', async () => {
  const patches: { url: string; body: unknown }[] = [];
  const reply = (id: number) => (init: RequestInit | undefined) => {
    const body = JSON.parse(String(init?.body)) as Partial<AdminModeDto>;
    patches.push({ url: `/api/admin/modes/${id}`, body });
    return json(200, { ...(modes.find((m) => m.id === id) as AdminModeDto), ...body });
  };
  stubFetch({
    'GET /api/admin/settings': () => json(200, settings),
    'GET /api/admin/modes': () => json(200, modes),
    'PATCH /api/admin/modes/1': reply(1),
    'PATCH /api/admin/modes/10': reply(10),
  });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

  const section = await screen.findByRole('region', { name: 'Chế độ chơi' });
  const classic = await within(section).findByRole('group', { name: 'Classic' });
  const hanging = within(section).getByRole('group', { name: 'Hanging Out' });
  expect(within(classic).getByRole('textbox', { name: 'Tên tiếng Việt' })).toHaveValue('Cổ điển (Classic)');
  expect(within(classic).getByRole('switch', { name: 'Đang bật' })).toBeChecked();
  expect(within(hanging).getByRole('switch', { name: 'Đang bật' })).not.toBeChecked();

  fireEvent.change(within(classic).getByRole('textbox', { name: 'Tên tiếng Việt' }), { target: { value: ' Cổ điển ' } });
  fireEvent.click(within(classic).getByRole('button', { name: 'Lưu tên' }));
  await waitFor(() => expect(patches).toEqual([{ url: '/api/admin/modes/1', body: { nameVi: 'Cổ điển' } }]));
  expect(await within(classic).findByText('Đã lưu')).toBeInTheDocument();
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['modes'] }));

  fireEvent.click(within(hanging).getByRole('switch', { name: 'Đang bật' }));
  await waitFor(() => expect(patches[1]).toEqual({ url: '/api/admin/modes/10', body: { active: true } }));
});

test('an empty mode name is refused locally; server errors are shown on the mode', async () => {
  const fetchMock = stubFetch({
    'GET /api/admin/settings': () => json(200, settings),
    'GET /api/admin/modes': () => json(200, modes),
    'PATCH /api/admin/modes/1': () => json(400, { error: { code: 'VALIDATION', message: 'Tên tiếng Việt phải từ 1 đến 60 ký tự' } }),
  });
  renderTab();
  const classic = await screen.findByRole('group', { name: 'Classic' });
  const name = within(classic).getByRole('textbox', { name: 'Tên tiếng Việt' });

  fireEvent.change(name, { target: { value: '   ' } });
  fireEvent.click(within(classic).getByRole('button', { name: 'Lưu tên' }));
  expect(await within(classic).findByRole('alert')).toHaveTextContent('Tên tiếng Việt không được để trống');
  expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);

  fireEvent.change(name, { target: { value: 'x'.repeat(61) } });
  fireEvent.click(within(classic).getByRole('button', { name: 'Lưu tên' }));
  expect(await within(classic).findByRole('alert')).toHaveTextContent('Tên tiếng Việt phải từ 1 đến 60 ký tự');
});

// ---------------------------------------------------------------------------
// Ngày nhân điểm (spec ngày nhân điểm §4)
// ---------------------------------------------------------------------------

const today = vnTodayIso();
const tomorrow = addDaysIso(today, 1);
const yesterday = addDaysIso(today, -1);
const multiplierDays: AdminMultiplierDayDto[] = [
  { id: 1, day: tomorrow, multiplier: 3, message: 'Cuối tuần quẩy', past: false },
  { id: 2, day: addDaysIso(today, 5), multiplier: 2, message: null, past: false },
  { id: 3, day: yesterday, multiplier: 2, message: 'Hôm qua', past: true },
];

const baseRoutes: Record<string, Handler> = {
  'GET /api/admin/settings': () => json(200, settings),
  'GET /api/admin/modes': () => json(200, modes),
  [MULTIPLIERS_ROUTE]: () => json(200, multiplierDays),
};

const multiplierSection = () => screen.findByRole('region', { name: 'Ngày nhân điểm' });

test('"Ngày nhân điểm" lists upcoming days with Sửa/Xoá and past days locked', async () => {
  stubFetch(baseRoutes);
  renderTab();
  const section = await multiplierSection();
  const rows = await within(section).findAllByRole('listitem');
  expect(rows).toHaveLength(3);

  expect(rows[0]).toHaveTextContent(formatDayLabel(tomorrow));
  expect(rows[0]).toHaveTextContent('×3');
  expect(rows[0]).toHaveTextContent('Cuối tuần quẩy');
  expect(within(rows[0] as HTMLElement).getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
  expect(within(rows[0] as HTMLElement).getByRole('button', { name: 'Xoá' })).toBeInTheDocument();

  expect(rows[2]).toHaveTextContent(formatDayLabel(yesterday));
  expect(rows[2]).toHaveTextContent('Đã qua');
  expect(within(rows[2] as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
});

test('an empty list says so', async () => {
  stubFetch({ ...baseRoutes, [MULTIPLIERS_ROUTE]: () => json(200, []) });
  renderTab();
  const section = await multiplierSection();
  expect(await within(section).findByText('Chưa có ngày nhân điểm nào')).toBeInTheDocument();
});

test('adding a day posts day, multiplier and message, then refreshes the banner and the scores', async () => {
  let posted: unknown = null;
  stubFetch({
    ...baseRoutes,
    'POST /api/admin/multiplier-days': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, { id: 9, day: today, multiplier: 4, message: 'Quẩy', past: false });
    },
  });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const section = await multiplierSection();
  const form = within(section).getByRole('form', { name: 'Thêm ngày nhân điểm' });

  const date = within(form).getByLabelText('Ngày');
  expect(date).toHaveAttribute('min', today);
  fireEvent.change(date, { target: { value: today } });
  fireEvent.click(within(form).getByRole('combobox', { name: 'Hệ số' }));
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['×2', '×3', '×4', '×5']);
  fireEvent.click(screen.getByRole('option', { name: '×4' }));
  fireEvent.change(within(form).getByLabelText('Lời nhắn'), { target: { value: '  Quẩy  ' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm' }));

  await waitFor(() => expect(posted).toEqual({ day: today, multiplier: 4, message: 'Quẩy' }));
  expect(await within(form).findByText('Đã thêm')).toBeInTheDocument();
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: MULTIPLIER_UPCOMING_KEY }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'multiplier-days'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['leaderboard'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['hall'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reports', 'mine'] });
});

test('an empty message is sent as null', async () => {
  let posted: unknown = null;
  stubFetch({
    ...baseRoutes,
    'POST /api/admin/multiplier-days': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, { id: 9, day: today, multiplier: 2, message: null, past: false });
    },
  });
  renderTab();
  const form = within(await multiplierSection()).getByRole('form', { name: 'Thêm ngày nhân điểm' });
  fireEvent.change(within(form).getByLabelText('Ngày'), { target: { value: today } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm' }));
  await waitFor(() => expect(posted).toEqual({ day: today, multiplier: 2, message: null }));
});

test('a past day or a long message is refused locally; server messages are shown verbatim', async () => {
  const fetchMock = stubFetch({
    ...baseRoutes,
    'POST /api/admin/multiplier-days': () => json(409, { error: { code: 'MULTIPLIER_DAY_TAKEN', message: 'Ngày này đã có hệ số nhân' } }),
  });
  renderTab();
  const form = within(await multiplierSection()).getByRole('form', { name: 'Thêm ngày nhân điểm' });
  const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

  fireEvent.change(within(form).getByLabelText('Ngày'), { target: { value: yesterday } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Chỉ đặt được cho hôm nay hoặc sau này');

  fireEvent.change(within(form).getByLabelText('Ngày'), { target: { value: tomorrow } });
  fireEvent.change(within(form).getByLabelText('Lời nhắn'), { target: { value: 'x'.repeat(101) } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Lời nhắn tối đa 100 ký tự');
  expect(posts()).toHaveLength(0);

  fireEvent.change(within(form).getByLabelText('Lời nhắn'), { target: { value: 'ok' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Ngày này đã có hệ số nhân');
});

test('Sửa sends a PATCH and refreshes; Xoá asks first, then sends DELETE and refreshes', async () => {
  let patched: unknown = null;
  let deleted = false;
  stubFetch({
    ...baseRoutes,
    'PATCH /api/admin/multiplier-days/1': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...multiplierDays[0], multiplier: 5, message: null });
    },
    'DELETE /api/admin/multiplier-days/2': () => {
      deleted = true;
      return new Response(null, { status: 204 });
    },
  });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const section = await multiplierSection();
  const [first, second] = (await within(section).findAllByRole('listitem')) as HTMLElement[];

  fireEvent.click(within(first as HTMLElement).getByRole('button', { name: 'Sửa' }));
  const edit = within(first as HTMLElement).getByRole('form', { name: `Sửa ${formatDayLabel(tomorrow)}` });
  expect(within(edit).getByLabelText('Ngày')).toHaveValue(tomorrow);
  expect(within(edit).getByLabelText('Lời nhắn')).toHaveValue('Cuối tuần quẩy');
  fireEvent.click(within(edit).getByRole('combobox', { name: 'Hệ số' }));
  fireEvent.click(screen.getByRole('option', { name: '×5' }));
  fireEvent.change(within(edit).getByLabelText('Lời nhắn'), { target: { value: '' } });
  fireEvent.click(within(edit).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patched).toEqual({ day: tomorrow, multiplier: 5, message: null }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: MULTIPLIER_UPCOMING_KEY }));

  invalidate.mockClear();
  fireEvent.click(within(second as HTMLElement).getByRole('button', { name: 'Xoá' }));
  expect(deleted).toBe(false);
  fireEvent.click(within(second as HTMLElement).getByRole('button', { name: 'Xác nhận xoá' }));
  await waitFor(() => expect(deleted).toBe(true));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: MULTIPLIER_UPCOMING_KEY }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['leaderboard'] });
});
