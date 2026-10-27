import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ModeDto, RoleDto } from '../../src/shared/api-types';
import { RolesTab } from '../../src/web/pages/admin/RolesTab';

const role = (over: Pick<RoleDto, 'id' | 'key' | 'faction' | 'nameVi' | 'nameEn' | 'icon' | 'metricLabel'> & Partial<RoleDto>): RoleDto => ({
  description: '',
  maxPerGame: 10,
  points: 1,
  extraMetricLabel: null,
  extraMaxPerGame: null,
  extraPoints: null,
  penaltyMetricLabel: null,
  penaltyMaxPerGame: null,
  penaltyPoints: null,
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
  // Role có chỉ số phụ: giết ×1 (tối đa 15), ám sát trong họp ×3 (tối đa 2).
  role({
    id: 50,
    key: 'assassin',
    faction: 'duck',
    nameVi: 'Ám sát',
    nameEn: 'Assassin',
    icon: '🗡️',
    metricLabel: 'Số mạng đã giết',
    maxPerGame: 15,
    extraMetricLabel: 'Số lần ám sát trong cuộc họp',
    extraMaxPerGame: 2,
    extraPoints: 3,
  }),
  role({ id: 70, key: 'dodo', faction: 'neutral', nameVi: 'Chim đa đa', nameEn: 'Dodo', icon: '🦤', metricLabel: 'Số trận thắng (bị vote ra)', maxPerGame: 1 }),
  role({ id: 80, key: 'inquisitor', faction: 'goose', nameVi: 'Thanh tra', nameEn: 'Inquisitor', icon: '🪿', metricLabel: 'Điểm', modeKey: 'corruption', active: false }),
];

const modes: ModeDto[] = [
  { id: 1, key: 'classic', nameVi: 'Cổ điển (Classic)' },
  { id: 6, key: 'corruption', nameVi: 'Tha hoá (Corruption)' },
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
  stubFetch({ 'GET /api/roles?all=1': () => json(200, roles), 'GET /api/modes': () => json(200, modes) });
  renderTab();
  await swordsmanCard();

  const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(groups).toEqual(['Thêm role', 'Phe Ngỗng (1)', 'Phe Vịt (2)', 'Phe thứ 3 (1)', 'Chế độ đặc biệt (1)']);
  const inquisitor = screen.getByRole('region', { name: 'Thanh tra (Inquisitor)' });
  expect(inquisitor).toHaveTextContent('Đã tắt');
  expect(within(inquisitor).getByRole('checkbox', { name: 'Đang bật' })).not.toBeChecked();
  expect(within(await swordsmanCard()).getByRole('img', { name: 'Ảnh Kiếm sĩ' })).toHaveAttribute('src', expect.stringContaining('/api/roles/61/image'));
  expect(within(await swordsmanCard()).getByRole('button', { name: 'Xoá ảnh' })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Ngỗng (Goose)' })).queryByRole('button', { name: 'Xoá ảnh' })).not.toBeInTheDocument();
});

test('a wrong type or an image over 1 MB is refused before any upload', async () => {
  const fetchMock = stubFetch({ 'GET /api/roles?all=1': () => json(200, roles), 'GET /api/modes': () => json(200, modes) });
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
    'GET /api/modes': () => json(200, modes),
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
    'GET /api/modes': () => json(200, modes),
    'PATCH /api/admin/roles/61': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...(roles.find((r) => r.key === 'swordsman') as RoleDto), metricLabel: 'Số người bị chém', maxPerGame: 16 });
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

test('the faction is edited inline and sent in the PATCH; the card moves to its new group', async () => {
  let patched: unknown = null;
  stubFetch({
    'GET /api/roles?all=1': () => json(200, roles),
    'GET /api/modes': () => json(200, modes),
    'PATCH /api/admin/roles/70': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...(roles.find((r) => r.key === 'dodo') as RoleDto), faction: 'duck' });
    },
  });
  renderTab();
  const card = await screen.findByRole('region', { name: 'Chim đa đa (Dodo)' });
  const faction = within(card).getByRole('combobox', { name: 'Phe' });
  expect(faction).toHaveValue('neutral');
  expect(within(faction).getAllByRole('option').map((o) => o.textContent)).toEqual(['Phe Ngỗng', 'Phe Vịt', 'Phe thứ 3']);

  fireEvent.change(faction, { target: { value: 'duck' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patched).toEqual({ faction: 'duck' }));
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Phe Vịt (3)' })).toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 2, name: 'Phe thứ 3 (0)' })).toBeInTheDocument();
});

test('"Thêm role" posts the new role, shows server errors such as a taken key, then resets', async () => {
  const posted: unknown[] = [];
  let reply = (): Response => json(400, { error: { code: 'VALIDATION', message: 'Key đã tồn tại' } });
  const fetchMock = stubFetch({
    'GET /api/roles?all=1': () => json(200, roles),
    'GET /api/modes': () => json(200, modes),
    'POST /api/admin/roles': (init) => {
      posted.push(JSON.parse(String(init?.body)));
      return reply();
    },
  });
  renderTab();
  const form = await screen.findByRole('form', { name: 'Thêm role' });
  const field = (name: string) => within(form).getByRole('textbox', { name });

  // Thiếu trường bắt buộc: báo tại chỗ, không gửi.
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm role' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Key không được để trống');

  fireEvent.change(field('Key'), { target: { value: 'goose' } });
  fireEvent.change(within(form).getByRole('combobox', { name: 'Phe' }), { target: { value: 'duck' } });
  fireEvent.change(field('Tên tiếng Việt'), { target: { value: ' Vịt thợ săn ' } });
  fireEvent.change(field('Tên tiếng Anh'), { target: { value: 'Hunter Duck' } });
  fireEvent.change(field('Tên chỉ số'), { target: { value: 'Số mạng săn' } });
  fireEvent.change(within(form).getByRole('spinbutton', { name: 'Tối đa mỗi trận' }), { target: { value: '7' } });
  fireEvent.change(field('Biểu tượng'), { target: { value: '🦆' } });
  fireEvent.change(field('Mô tả (không bắt buộc)'), { target: { value: 'Săn ngỗng ban đêm' } });
  const mode = within(form).getByRole('combobox', { name: 'Chế độ đặc biệt (không bắt buộc)' });
  expect(within(mode).getAllByRole('option').map((o) => o.textContent)).toEqual(['— Không —', 'Cổ điển (Classic)', 'Tha hoá (Corruption)']);
  fireEvent.change(mode, { target: { value: 'corruption' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm role' }));

  expect(await within(form).findByRole('alert')).toHaveTextContent('Key đã tồn tại');
  expect(posted).toEqual([
    {
      key: 'goose',
      faction: 'duck',
      nameVi: 'Vịt thợ săn',
      nameEn: 'Hunter Duck',
      metricLabel: 'Số mạng săn',
      maxPerGame: 7,
      icon: '🦆',
      description: 'Săn ngỗng ban đêm',
      modeKey: 'corruption',
    },
  ]);

  // Sửa key rồi gửi lại: tạo được, danh sách role được tải lại, form trống trở lại.
  reply = () => json(201, role({ id: 99, key: 'hunter_duck', faction: 'duck', nameVi: 'Vịt thợ săn', nameEn: 'Hunter Duck', icon: '🦆', metricLabel: 'Số mạng săn', modeKey: 'corruption' }));
  fireEvent.change(field('Key'), { target: { value: 'hunter_duck' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm role' }));
  expect(await screen.findByText('Đã thêm “Vịt thợ săn”')).toBeInTheDocument();
  expect(posted[1]).toMatchObject({ key: 'hunter_duck' });
  await waitFor(() => expect(within(screen.getByRole('form', { name: 'Thêm role' })).getByRole('textbox', { name: 'Key' })).toHaveValue(''));
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/roles?all=1').length).toBeGreaterThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// Chỉ số phụ
// ---------------------------------------------------------------------------

const EXTRA_TOGGLE = 'Có chỉ số phụ';
const EXTRA_LABEL = 'Số lần ám sát trong cuộc họp';
const EXTRA_IN_USE = 'Role đã có lần khai dùng chỉ số phụ, không tắt được';

/** Ba ô của chỉ số phụ, trong nhóm mang tên ô tick (để không lẫn với "Tối đa mỗi trận" của chỉ số chính). */
const extraFields = (scope: HTMLElement) => {
  const group = within(scope).getByRole('group', { name: EXTRA_TOGGLE });
  return {
    label: within(group).getByRole('textbox', { name: 'Tên chỉ số phụ' }),
    max: within(group).getByRole('spinbutton', { name: 'Tối đa mỗi trận' }),
    points: within(group).getByRole('spinbutton', { name: 'Điểm mỗi lần' }),
  };
};

test('"Thêm role": ticking "Có chỉ số phụ" reveals the three fields, which are checked locally and sent together', async () => {
  const posted: unknown[] = [];
  const fetchMock = stubFetch({
    'GET /api/roles?all=1': () => json(200, roles),
    'GET /api/modes': () => json(200, modes),
    'POST /api/admin/roles': (init) => {
      posted.push(JSON.parse(String(init?.body)));
      return json(201, role({ id: 99, key: 'sniper', faction: 'duck', nameVi: 'Xạ thủ', nameEn: 'Sniper', icon: '🎯', metricLabel: 'Số mạng bắn' }));
    },
  });
  renderTab();
  const form = await screen.findByRole('form', { name: 'Thêm role' });
  const field = (name: string) => within(form).getByRole('textbox', { name });

  // Chưa tick: không có ô phụ nào; "Tối đa mỗi trận" duy nhất là của chỉ số chính.
  const toggle = within(form).getByRole('checkbox', { name: EXTRA_TOGGLE });
  expect(toggle).not.toBeChecked();
  expect(within(form).queryByRole('textbox', { name: 'Tên chỉ số phụ' })).not.toBeInTheDocument();
  expect(within(form).getAllByRole('spinbutton', { name: 'Tối đa mỗi trận' })).toHaveLength(1);

  fireEvent.change(field('Key'), { target: { value: 'sniper' } });
  fireEvent.change(within(form).getByRole('combobox', { name: 'Phe' }), { target: { value: 'duck' } });
  fireEvent.change(field('Tên tiếng Việt'), { target: { value: 'Xạ thủ' } });
  fireEvent.change(field('Tên tiếng Anh'), { target: { value: 'Sniper' } });
  fireEvent.change(field('Tên chỉ số'), { target: { value: 'Số mạng bắn' } });
  fireEvent.change(within(form).getByRole('spinbutton', { name: 'Tối đa mỗi trận' }), { target: { value: '7' } });
  fireEvent.change(field('Biểu tượng'), { target: { value: '🎯' } });

  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
  const extra = extraFields(form);
  expect(extra.label).toHaveValue('');
  expect(extra.label).toHaveAttribute('maxlength', '60');
  expect(extra.max).toHaveAttribute('min', '1');
  expect(extra.max).toHaveAttribute('max', '100');
  expect(extra.points).toHaveAttribute('min', '1');
  expect(extra.points).toHaveAttribute('max', '100');

  // Thiếu tên chỉ số phụ: báo tại chỗ, không gửi.
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm role' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Tên chỉ số phụ không được để trống');
  expect(posted).toHaveLength(0);

  fireEvent.change(extra.label, { target: { value: ' Số lần bắn trúng từ xa ' } });
  fireEvent.change(extra.max, { target: { value: '0' } });
  fireEvent.change(extra.points, { target: { value: '2' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm role' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Tối đa mỗi trận của chỉ số phụ phải từ 1 đến 100');
  expect(posted).toHaveLength(0);

  fireEvent.change(extra.max, { target: { value: '3' } });
  fireEvent.change(extra.points, { target: { value: '101' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm role' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Điểm mỗi lần của chỉ số phụ phải từ 1 đến 100');
  expect(posted).toHaveLength(0);

  fireEvent.change(extra.points, { target: { value: '2' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm role' }));
  expect(await screen.findByText('Đã thêm “Xạ thủ”')).toBeInTheDocument();
  expect(posted).toEqual([
    {
      key: 'sniper',
      faction: 'duck',
      nameVi: 'Xạ thủ',
      nameEn: 'Sniper',
      metricLabel: 'Số mạng bắn',
      maxPerGame: 7,
      icon: '🎯',
      extraMetricLabel: 'Số lần bắn trúng từ xa',
      extraMaxPerGame: 3,
      extraPoints: 2,
    },
  ]);
  // Form trống trở lại, kể cả ô tick.
  await waitFor(() => expect(within(screen.getByRole('form', { name: 'Thêm role' })).getByRole('checkbox', { name: EXTRA_TOGGLE })).not.toBeChecked());
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/roles?all=1').length).toBeGreaterThanOrEqual(2);
});

test('the editor shows the extra metric of Ám sát, patches the three fields together, and shows the refusal when disabling', async () => {
  const patches: unknown[] = [];
  let reply = (): Response => json(200, { ...(roles.find((r) => r.key === 'assassin') as RoleDto), extraPoints: 4 });
  stubFetch({
    'GET /api/roles?all=1': () => json(200, roles),
    'GET /api/modes': () => json(200, modes),
    'PATCH /api/admin/roles/50': (init) => {
      patches.push(JSON.parse(String(init?.body)));
      return reply();
    },
  });
  renderTab();
  const card = await screen.findByRole('region', { name: 'Ám sát (Assassin)' });

  const toggle = within(card).getByRole('checkbox', { name: EXTRA_TOGGLE });
  expect(toggle).toBeChecked();
  const extra = extraFields(card);
  expect(extra.label).toHaveValue(EXTRA_LABEL);
  expect(extra.max).toHaveValue(2);
  expect(extra.points).toHaveValue(3);
  // Chỉ số chính vẫn có ô "Tối đa mỗi trận" riêng (15), ngoài nhóm chỉ số phụ.
  const maxes = within(card).getAllByRole('spinbutton', { name: 'Tối đa mỗi trận' });
  expect(maxes).toHaveLength(2);
  expect(maxes.find((input) => input !== extra.max)).toHaveValue(15);

  // Đổi điểm mỗi lần: gửi đủ cả ba trường phụ (server cần cả ba), không gửi trường chính nào.
  fireEvent.change(extra.points, { target: { value: '4' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patches).toEqual([{ extraMetricLabel: EXTRA_LABEL, extraMaxPerGame: 2, extraPoints: 4 }]));
  expect(await within(card).findByText('Đã lưu')).toBeInTheDocument();

  // Bỏ tick: gửi `null` cả ba; server từ chối vì đã có lần khai dùng chỉ số phụ → hiện nguyên văn.
  reply = () => json(400, { error: { code: 'VALIDATION', message: EXTRA_IN_USE } });
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(within(card).queryByRole('textbox', { name: 'Tên chỉ số phụ' })).not.toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Lưu' }));
  expect(await within(card).findByRole('alert')).toHaveTextContent(EXTRA_IN_USE);
  expect(patches[1]).toEqual({ extraMetricLabel: null, extraMaxPerGame: null, extraPoints: null });
});

test('a role without an extra metric starts unticked; ticking it requires the three fields before saving', async () => {
  let patched: unknown = null;
  stubFetch({
    'GET /api/roles?all=1': () => json(200, roles),
    'GET /api/modes': () => json(200, modes),
    'PATCH /api/admin/roles/61': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...(roles.find((r) => r.key === 'swordsman') as RoleDto), extraMetricLabel: 'Số lần chém trúng Vịt', extraMaxPerGame: 5, extraPoints: 2 });
    },
  });
  renderTab();
  const card = await swordsmanCard();

  const toggle = within(card).getByRole('checkbox', { name: EXTRA_TOGGLE });
  expect(toggle).not.toBeChecked();
  // Nhóm (fieldset có legend là ô tick) luôn có, nhưng ba ô chỉ hiện khi tick.
  expect(within(card).queryByRole('textbox', { name: 'Tên chỉ số phụ' })).toBeNull();
  expect(within(card).getAllByRole('spinbutton')).toHaveLength(1);

  fireEvent.click(toggle);
  const extra = extraFields(card);
  fireEvent.click(within(card).getByRole('button', { name: 'Lưu' }));
  expect(await within(card).findByRole('alert')).toHaveTextContent('Tên chỉ số phụ không được để trống');
  expect(patched).toBeNull();

  fireEvent.change(extra.label, { target: { value: 'Số lần chém trúng Vịt' } });
  fireEvent.change(extra.max, { target: { value: '5' } });
  fireEvent.change(extra.points, { target: { value: '2' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patched).toEqual({ extraMetricLabel: 'Số lần chém trúng Vịt', extraMaxPerGame: 5, extraPoints: 2 }));
  expect(await within(card).findByText('Đã lưu')).toBeInTheDocument();
});
