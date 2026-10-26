import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AwardCategoryDto, ModeDto } from '../../src/shared/api-types';
import { CategoriesTab } from '../../src/web/pages/admin/CategoriesTab';

const modes: ModeDto[] = [
  { id: 1, key: 'classic', nameVi: 'Cổ điển (Classic)' },
  { id: 3, key: 'goose_hunt', nameVi: 'Săn ngỗng (Goose Hunt)' },
];

const categories: AwardCategoryDto[] = [
  { id: 1, scope: 'always', mode: null, name: 'Giết nhiều nhất', description: null, active: true, sortOrder: 1, badgeGroup: 'mvp' },
  { id: 4, scope: 'mode', mode: modes[1] as ModeDto, name: 'Ngỗng chạy giỏi nhất', description: 'Chỉ Săn ngỗng', active: true, sortOrder: 4, badgeGroup: 'mvp' },
  { id: 5, scope: 'optional', mode: null, name: 'Pha đẻ trứng lộ liễu nhất (Cò gáy)', description: null, active: false, sortOrder: 5, badgeGroup: 'fun' },
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

const baseRoutes: Record<string, Handler> = {
  'GET /api/admin/categories?all=1': () => json(200, categories),
  'GET /api/modes': () => json(200, modes),
};

const renderTab = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CategoriesTab />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('categories list their scope label and hidden state', async () => {
  stubFetch(baseRoutes);
  renderTab();
  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent('Giết nhiều nhất');
  expect(items[0]).toHaveTextContent('Luôn có');
  expect(items[1]).toHaveTextContent('Theo chế độ: Săn ngỗng (Goose Hunt)');
  expect(items[1]).toHaveTextContent('Chỉ Săn ngỗng');
  expect(items[2]).toHaveTextContent('Tuỳ chọn');
  expect(within(items[2] as HTMLElement).getByRole('switch', { name: 'Đang bật' })).not.toBeChecked();
  expect(within(items[0] as HTMLElement).getByRole('switch', { name: 'Đang bật' })).toBeChecked();
});

test('moving a category off scope mode sends modeId: null in the same PATCH', async () => {
  let patched: unknown = null;
  stubFetch({
    ...baseRoutes,
    'PATCH /api/admin/categories/4': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...(categories[1] as AwardCategoryDto), scope: 'optional', mode: null });
    },
  });
  renderTab();
  const item = (await screen.findAllByRole('listitem'))[1] as HTMLElement;
  fireEvent.click(within(item).getByRole('button', { name: 'Sửa' }));

  const scope = within(item).getByRole('combobox', { name: 'Phạm vi' });
  expect(scope).toHaveValue('mode');
  expect(within(item).getByRole('combobox', { name: 'Chế độ chơi' })).toHaveValue('3');

  fireEvent.change(scope, { target: { value: 'optional' } });
  // Ô chế độ chỉ có với phạm vi "Theo chế độ".
  expect(within(item).queryByRole('combobox', { name: 'Chế độ chơi' })).not.toBeInTheDocument();
  fireEvent.click(within(item).getByRole('button', { name: 'Lưu' }));

  await waitFor(() =>
    expect(patched).toEqual({ scope: 'optional', modeId: null, name: 'Ngỗng chạy giỏi nhất', description: 'Chỉ Săn ngỗng', badgeGroup: 'mvp' }),
  );
});

test('a mode category needs a mode; creating one posts scope, modeId and name', async () => {
  let posted: unknown = null;
  const fetchMock = stubFetch({
    ...baseRoutes,
    'POST /api/admin/categories': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, { id: 9, scope: 'mode', mode: modes[0], name: 'Sống sót lâu nhất', description: null, active: true, sortOrder: 7, badgeGroup: 'none' });
    },
  });
  renderTab();
  await screen.findAllByRole('listitem');

  const form = screen.getByRole('form', { name: 'Thêm hạng mục' });
  fireEvent.change(within(form).getByRole('textbox', { name: 'Tên hạng mục' }), { target: { value: 'Sống sót lâu nhất' } });
  fireEvent.change(within(form).getByRole('combobox', { name: 'Phạm vi' }), { target: { value: 'mode' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm hạng mục' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Hãy chọn chế độ chơi');
  expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);

  fireEvent.change(within(form).getByRole('combobox', { name: 'Chế độ chơi' }), { target: { value: '1' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm hạng mục' }));
  await waitFor(() => expect(posted).toEqual({ scope: 'mode', modeId: 1, name: 'Sống sót lâu nhất', badgeGroup: 'none' }));
});

test('Tính cho danh hiệu offers Khen / Vui / Không tính and is sent on create and edit', async () => {
  let posted: unknown = null;
  let patched: unknown = null;
  stubFetch({
    ...baseRoutes,
    'POST /api/admin/categories': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, { id: 9, scope: 'always', mode: null, name: 'Pha hụt đáng tiếc nhất', description: null, active: true, sortOrder: 7, badgeGroup: 'fun' });
    },
    'PATCH /api/admin/categories/1': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...(categories[0] as AwardCategoryDto), badgeGroup: 'none' });
    },
  });
  renderTab();
  const items = await screen.findAllByRole('listitem');

  // Hàng ghi nhóm đang tính (không ghi gì khi "Không tính").
  expect(items[0]).toHaveTextContent('Danh hiệu: Khen');
  expect(items[1]).toHaveTextContent('Danh hiệu: Khen');
  expect(items[2]).toHaveTextContent('Danh hiệu: Vui');

  // Form thêm: mặc định "Không tính"; ba lựa chọn đúng giá trị API.
  const form = screen.getByRole('form', { name: 'Thêm hạng mục' });
  const group = within(form).getByRole('combobox', { name: 'Tính cho danh hiệu' });
  expect(group).toHaveValue('none');
  expect(within(group).getAllByRole('option').map((option) => [option.getAttribute('value'), option.textContent])).toEqual([
    ['mvp', 'Khen'],
    ['fun', 'Vui'],
    ['none', 'Không tính'],
  ]);
  fireEvent.change(within(form).getByRole('textbox', { name: 'Tên hạng mục' }), { target: { value: 'Pha hụt đáng tiếc nhất' } });
  fireEvent.change(group, { target: { value: 'fun' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm hạng mục' }));
  await waitFor(() => expect(posted).toEqual({ scope: 'always', name: 'Pha hụt đáng tiếc nhất', badgeGroup: 'fun' }));

  // Form sửa: hiện nhóm hiện tại của hạng mục; đổi rồi Lưu gửi `badgeGroup` cùng các trường khác.
  const item = screen.getAllByRole('listitem')[0] as HTMLElement;
  fireEvent.click(within(item).getByRole('button', { name: 'Sửa' }));
  const editGroup = within(item).getByRole('combobox', { name: 'Tính cho danh hiệu' });
  expect(editGroup).toHaveValue('mvp');
  fireEvent.change(editGroup, { target: { value: 'none' } });
  fireEvent.click(within(item).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patched).toEqual({ scope: 'always', modeId: null, name: 'Giết nhiều nhất', description: null, badgeGroup: 'none' }));
});

test('the active switch patches only active', async () => {
  let patched: unknown = null;
  stubFetch({
    ...baseRoutes,
    'PATCH /api/admin/categories/5': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...(categories[2] as AwardCategoryDto), active: true });
    },
  });
  renderTab();
  const item = (await screen.findAllByRole('listitem'))[2] as HTMLElement;
  fireEvent.click(within(item).getByRole('switch', { name: 'Đang bật' }));
  await waitFor(() => expect(patched).toEqual({ active: true }));
});
