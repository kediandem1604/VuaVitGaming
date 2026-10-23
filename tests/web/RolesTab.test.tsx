import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { RoleDto } from '../../src/shared/api-types';
import { RolesTab } from '../../src/web/pages/admin/RolesTab';

const role = (over: Pick<RoleDto, 'id' | 'key' | 'faction' | 'nameVi' | 'nameEn' | 'icon' | 'metricLabel'> & Partial<RoleDto>): RoleDto => ({
  description: '',
  maxPerGame: 10,
  mapNote: null,
  modeKey: null,
  hasImage: false,
  active: true,
  sortOrder: over.id,
  ...over,
});

const roles: RoleDto[] = [
  role({ id: 1, key: 'goose', faction: 'goose', nameVi: 'Ngỗng', nameEn: 'Goose', icon: '🪿', metricLabel: 'Số lần vote trúng Vịt' }),
  role({ id: 61, key: 'swordsman', faction: 'duck', nameVi: 'Kiếm sĩ', nameEn: 'Swordsman', icon: '⚔️', metricLabel: 'Số mạng chém', maxPerGame: 15, hasImage: true }),
  role({ id: 70, key: 'dodo', faction: 'neutral', nameVi: 'Chim đa đa', nameEn: 'Dodo', icon: '🦤', metricLabel: 'Số trận thắng (bị vote ra)', maxPerGame: 1 }),
  role({ id: 80, key: 'inquisitor', faction: 'goose', nameVi: 'Thanh tra', nameEn: 'Inquisitor', icon: '🪿', metricLabel: 'Điểm', modeKey: 'corruption', active: false }),
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
      <RolesTab />
    </QueryClientProvider>,
  );
  return queryClient;
};

const swordsmanCard = async () => screen.findByRole('region', { name: 'Kiếm sĩ (Swordsman)' });
const uploads = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('roles are grouped by faction with special-mode roles apart; inactive ones are marked', async () => {
  stubFetch({ 'GET /api/roles?all=1': () => json(200, roles) });
  renderTab();
  await swordsmanCard();

  const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(groups).toEqual(['Phe Ngỗng (1)', 'Phe Vịt (1)', 'Phe thứ 3 (1)', 'Chế độ đặc biệt (1)']);
  const inquisitor = screen.getByRole('region', { name: 'Thanh tra (Inquisitor)' });
  expect(inquisitor).toHaveTextContent('Đã tắt');
  expect(within(inquisitor).getByRole('checkbox', { name: 'Đang bật' })).not.toBeChecked();
  expect(within(await swordsmanCard()).getByRole('img', { name: 'Ảnh Kiếm sĩ' })).toHaveAttribute('src', expect.stringContaining('/api/roles/61/image'));
  expect(within(await swordsmanCard()).getByRole('button', { name: 'Xoá ảnh' })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Ngỗng (Goose)' })).queryByRole('button', { name: 'Xoá ảnh' })).not.toBeInTheDocument();
});

test('a wrong type or an image over 1 MB is refused before any upload', async () => {
  const fetchMock = stubFetch({ 'GET /api/roles?all=1': () => json(200, roles) });
  renderTab();
  const card = await swordsmanCard();
  const input = within(card).getByLabelText('Tải ảnh (PNG, JPG hoặc WebP, tối đa 1 MB)');

  const tooBig = new File([new Uint8Array(1_048_577)], 'to.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [tooBig] } });
  expect(await within(card).findByRole('alert')).toHaveTextContent('Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB');
  expect(uploads(fetchMock)).toHaveLength(0);

  const wrongType = new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' });
  fireEvent.change(input, { target: { files: [wrongType] } });
  expect(within(card).getByRole('alert')).toHaveTextContent('Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB');
  expect(uploads(fetchMock)).toHaveLength(0);
});

test('a valid image is PUT raw with its own content type, then role and hall caches are refreshed', async () => {
  const fetchMock = stubFetch({
    'GET /api/roles?all=1': () => json(200, roles),
    'PUT /api/admin/roles/1/image': () => noContent(),
  });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const card = await screen.findByRole('region', { name: 'Ngỗng (Goose)' });

  const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'goose.png', { type: 'image/png' });
  fireEvent.change(within(card).getByLabelText('Tải ảnh (PNG, JPG hoặc WebP, tối đa 1 MB)'), { target: { files: [png] } });

  await waitFor(() => expect(uploads(fetchMock)).toHaveLength(1));
  const [, init] = uploads(fetchMock)[0] as [string, RequestInit];
  expect(init.body).toBe(png);
  expect(init.credentials).toBe('include');
  expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['roles'] }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['hall'] });
  expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
});

test('saving edits patches only the changed fields', async () => {
  let patched: unknown = null;
  stubFetch({
    'GET /api/roles?all=1': () => json(200, roles),
    'PATCH /api/admin/roles/61': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...(roles[1] as RoleDto), metricLabel: 'Số người bị chém', maxPerGame: 16 });
    },
  });
  renderTab();
  const card = await swordsmanCard();
  fireEvent.change(within(card).getByRole('textbox', { name: 'Tên chỉ số' }), { target: { value: 'Số người bị chém' } });
  fireEvent.change(within(card).getByRole('spinbutton', { name: 'Tối đa mỗi trận' }), { target: { value: '16' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patched).toEqual({ metricLabel: 'Số người bị chém', maxPerGame: 16 }));
  expect(await within(card).findByText('Đã lưu')).toBeInTheDocument();
});
