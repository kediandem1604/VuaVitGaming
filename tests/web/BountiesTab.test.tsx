import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { BountyDto, RoleDto, SessionDto } from '../../src/shared/api-types';
import { vnTodayIso } from '../../src/web/lib/format';
import { ADMIN_BOUNTIES_KEY, SESSION_BOUNTIES_KEY } from '../../src/web/lib/queryKeys';
import { BountiesTab } from '../../src/web/pages/admin/BountiesTab';

const role = (id: number, nameVi: string, icon: string, faction: RoleDto['faction']): RoleDto =>
  ({ id, key: `r${id}`, faction, nameVi, nameEn: nameVi, description: '', icon, active: true, modeKey: null }) as unknown as RoleDto;

const roles: RoleDto[] = [role(30, 'Bồ nông', '🦩', 'neutral'), role(12, 'Binh lính', '🪖', 'goose')];

const PELICAN = { id: 30, nameVi: 'Bồ nông', icon: '🦩', faction: 'neutral' as const };
// 19:00 giờ VN hôm nay.
const today = vnTodayIso();
const tonight = `${today}T12:00:00.000Z`;
const session: SessionDto = { id: 7, startsAt: tonight, modeName: 'Cổ điển', capacity: 16, roomCode: null, note: null, status: 'scheduled', attendees: [], myStatus: null };

const bounty = (over: Partial<BountyDto> & Pick<BountyDto, 'id' | 'title'>): BountyDto => ({
  description: null,
  points: 3,
  role: null,
  session: null,
  active: true,
  approvedClaims: 0,
  totalClaims: 0,
  ...over,
});

const list: BountyDto[] = [
  bounty({ id: 1, title: 'Đã tắt', active: false }),
  bounty({ id: 2, title: 'Bồ Nông nuốt hết vịt', points: 5, role: PELICAN, session: { id: 7, startsAt: tonight, modeName: 'Cổ điển' }, approvedClaims: 2, totalClaims: 3 }),
  bounty({ id: 3, title: 'Tham gia đủ', description: 'Từ game đầu tới game cuối' }),
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Tuyến giả; buổi chơi: hôm nay có một buổi, các ngày sau trống. */
function stubFetch(routes: Record<string, Handler>) {
  const all: Record<string, Handler> = {
    'GET /api/admin/bounties': () => json(200, list),
    'GET /api/roles': () => json(200, roles),
    ...routes,
  };
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    if (key.startsWith('GET /api/sessions?date=')) return Promise.resolve(json(200, key.endsWith(today) ? [session] : []));
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
      <BountiesTab />
    </QueryClientProvider>,
  );
  return queryClient;
};

const listSection = () => screen.findByRole('region', { name: 'Mục treo thưởng' });
const rows = async () => within(await listSection()).findAllByRole('listitem');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('the list shows active bounties first, with role, points, scope, approved claims and actions', async () => {
  stubFetch({});
  renderTab();
  const items = await rows();
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent('Bồ Nông nuốt hết vịt');
  expect(items[0]).toHaveTextContent('🦩 Bồ nông');
  expect(items[0]).toHaveTextContent('+5');
  expect(items[0]).toHaveTextContent(`Buổi 19:00 ${today.split('-').reverse().join('/')} — Cổ điển`);
  expect(items[0]).toHaveTextContent('2 lần nhận đã duyệt');
  expect(within(items[0] as HTMLElement).getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
  expect(within(items[0] as HTMLElement).getByRole('button', { name: 'Tắt' })).toBeInTheDocument();
  // Đã có lần nhận → không xoá được, chỉ tắt.
  expect(within(items[0] as HTMLElement).queryByRole('button', { name: 'Xoá' })).not.toBeInTheDocument();

  expect(items[1]).toHaveTextContent('Tham gia đủ');
  expect(items[1]).toHaveTextContent('Mọi role');
  expect(items[1]).toHaveTextContent('Mọi buổi');
  expect(items[1]).toHaveTextContent('Từ game đầu tới game cuối');
  expect(within(items[1] as HTMLElement).getByRole('button', { name: 'Xoá' })).toBeInTheDocument();

  // Đã tắt nằm cuối, có nút Bật.
  expect(items[2]).toHaveTextContent('Đã tắt');
  expect(within(items[2] as HTMLElement).getByRole('button', { name: 'Bật' })).toBeInTheDocument();
});

test('a bounty with only pending or rejected claims has no "Xoá" (delete would be refused)', async () => {
  stubFetch({ 'GET /api/admin/bounties': () => json(200, [bounty({ id: 5, title: 'Chờ duyệt', approvedClaims: 0, totalClaims: 1 })]) });
  renderTab();
  const [item] = await rows();
  expect(item).toHaveTextContent('0 lần nhận đã duyệt');
  expect(within(item as HTMLElement).getByRole('button', { name: 'Tắt' })).toBeInTheDocument();
  expect(within(item as HTMLElement).queryByRole('button', { name: 'Xoá' })).not.toBeInTheDocument();
});

test('creating posts the trimmed fields with the picked role and session, then refreshes', async () => {
  let posted: unknown = null;
  stubFetch({
    'POST /api/admin/bounties': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, bounty({ id: 9, title: 'Binh lính giết 3 vịt' }));
    },
  });
  const queryClient = renderTab();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const form = await screen.findByRole('form', { name: 'Thêm treo thưởng' });
  await rows(); // role và buổi đã tải

  fireEvent.change(within(form).getByLabelText('Tên'), { target: { value: '  Binh lính giết 3 vịt  ' } });
  fireEvent.change(within(form).getByLabelText('Mô tả'), { target: { value: 'Hoặc phe thứ 3' } });
  fireEvent.change(within(form).getByLabelText('Điểm'), { target: { value: '4' } });

  const rolePicker = within(form).getByRole('combobox', { name: 'Role' });
  expect(rolePicker).toHaveTextContent('Không gắn role');
  fireEvent.click(rolePicker);
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Không gắn role', '🪖 Binh lính', '🦩 Bồ nông']);
  fireEvent.click(screen.getByRole('option', { name: '🪖 Binh lính' }));

  const scope = within(form).getByRole('combobox', { name: 'Áp dụng cho' });
  expect(scope).toHaveTextContent('Mọi buổi');
  fireEvent.click(scope);
  fireEvent.click(await screen.findByRole('option', { name: `19:00 ${today.split('-').reverse().join('/')} — Cổ điển` }));

  fireEvent.click(within(form).getByRole('button', { name: 'Thêm treo thưởng' }));

  await waitFor(() => expect(posted).toEqual({ title: 'Binh lính giết 3 vịt', description: 'Hoặc phe thứ 3', points: 4, roleId: 12, sessionId: 7 }));
  // Form dựng lại trống (khoá theo mục vừa tạo) kèm lời báo đã thêm.
  expect(await screen.findByRole('status')).toHaveTextContent('Đã thêm “Binh lính giết 3 vịt”');
  expect(within(screen.getByRole('form', { name: 'Thêm treo thưởng' })).getByLabelText('Tên')).toHaveValue('');
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ADMIN_BOUNTIES_KEY });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: SESSION_BOUNTIES_KEY });
});

test('the form checks name and points before sending', async () => {
  const fetchMock = stubFetch({});
  renderTab();
  const form = await screen.findByRole('form', { name: 'Thêm treo thưởng' });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm treo thưởng' }));
  expect(within(form).getByRole('alert')).toHaveTextContent('Tên không được để trống');

  fireEvent.change(within(form).getByLabelText('Tên'), { target: { value: 'X' } });
  fireEvent.change(within(form).getByLabelText('Điểm'), { target: { value: '51' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Thêm treo thưởng' }));
  expect(within(form).getByRole('alert')).toHaveTextContent('Điểm phải từ 1 đến 50');
  expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
});

test('Tắt / Bật patches active', async () => {
  const bodies: unknown[] = [];
  stubFetch({
    'PATCH /api/admin/bounties/3': (init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json(200, { ...list[2], active: false });
    },
    'PATCH /api/admin/bounties/1': (init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json(200, { ...list[0], active: true });
    },
  });
  renderTab();
  const items = await rows();
  fireEvent.click(within(items[1] as HTMLElement).getByRole('button', { name: 'Tắt' }));
  await waitFor(() => expect(bodies).toEqual([{ active: false }]));
  fireEvent.click(within((await rows()).find((item) => item.textContent?.includes('Đã tắt')) as HTMLElement).getByRole('button', { name: 'Bật' }));
  await waitFor(() => expect(bodies).toEqual([{ active: false }, { active: true }]));
});

test('editing prefills the form and patches every field', async () => {
  let patched: unknown = null;
  stubFetch({
    'PATCH /api/admin/bounties/2': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...list[1], points: 6 });
    },
  });
  renderTab();
  const first = (await rows())[0] as HTMLElement;
  fireEvent.click(within(first).getByRole('button', { name: 'Sửa' }));
  const form = within(first).getByRole('form', { name: 'Sửa Bồ Nông nuốt hết vịt' });
  expect(within(form).getByLabelText('Tên')).toHaveValue('Bồ Nông nuốt hết vịt');
  expect(within(form).getByLabelText('Điểm')).toHaveValue(5);
  expect(within(form).getByRole('combobox', { name: 'Role' })).toHaveTextContent('🦩 Bồ nông');
  expect(within(form).getByRole('combobox', { name: 'Áp dụng cho' })).toHaveTextContent('19:00');

  fireEvent.change(within(form).getByLabelText('Điểm'), { target: { value: '6' } });
  fireEvent.click(within(form).getByRole('combobox', { name: 'Áp dụng cho' }));
  fireEvent.click(screen.getByRole('option', { name: 'Mọi buổi' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patched).toEqual({ title: 'Bồ Nông nuốt hết vịt', description: null, points: 6, roleId: 30, sessionId: null }));
});

test('deleting asks to confirm, then sends DELETE and removes the row; 409 shows the message', async () => {
  let deleted = false;
  stubFetch({
    'GET /api/admin/bounties': () => json(200, deleted ? list.filter((b) => b.id !== 3) : list),
    'DELETE /api/admin/bounties/3': () => {
      deleted = true;
      return noContent();
    },
    'DELETE /api/admin/bounties/1': () => json(409, { error: { code: 'BOUNTY_HAS_CLAIMS', message: 'Mục đã có lần nhận — chỉ tắt được, không xoá được' } }),
  });
  renderTab();
  const second = (await rows())[1] as HTMLElement;
  fireEvent.click(within(second).getByRole('button', { name: 'Xoá' }));
  fireEvent.click(within(second).getByRole('button', { name: 'Xác nhận xoá' }));
  await waitFor(async () => expect(await rows()).toHaveLength(2));

  const off = (await rows()).find((item) => item.textContent?.includes('Đã tắt')) as HTMLElement;
  fireEvent.click(within(off).getByRole('button', { name: 'Xoá' }));
  fireEvent.click(within(off).getByRole('button', { name: 'Xác nhận xoá' }));
  expect(await within(off).findByRole('alert')).toHaveTextContent('Mục đã có lần nhận — chỉ tắt được, không xoá được');
});

test('an empty list says so', async () => {
  stubFetch({ 'GET /api/admin/bounties': () => json(200, []) });
  renderTab();
  expect(await screen.findByText('Chưa có mục treo thưởng nào')).toBeInTheDocument();
});
