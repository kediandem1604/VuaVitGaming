import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { SettingsDto } from '../../src/shared/api-types';
import { SettingsTab } from '../../src/web/pages/admin/SettingsTab';

const settings: SettingsDto = { voteDurationHours: 12, autoEndHours: 4, reminderLeadMinutes: 15 };

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
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('the three inputs are prefilled and saved together', async () => {
  let patched: unknown = null;
  stubFetch({
    'GET /api/admin/settings': () => json(200, settings),
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
