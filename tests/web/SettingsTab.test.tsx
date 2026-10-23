import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminModeDto, SettingsDto } from '../../src/shared/api-types';
import { SettingsTab } from '../../src/web/pages/admin/SettingsTab';

const settings: SettingsDto = { voteDurationHours: 12, autoEndHours: 4, reminderLeadMinutes: 15 };
const modes: AdminModeDto[] = [
  { id: 1, key: 'classic', nameVi: 'Cổ điển (Classic)', nameEn: 'Classic', active: true },
  { id: 10, key: 'hanging_out', nameVi: 'Đi chơi (Hanging Out)', nameEn: 'Hanging Out', active: false },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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
