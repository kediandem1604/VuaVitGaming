import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { MeDto, ReportDto, RoleDto, RoundDto, RoundReportDto, SessionRoundsDto } from '../../src/shared/api-types';
import { SessionPage } from '../../src/web/pages/SessionPage';

/** 21:00 giờ VN ngày 2/11/2026 (mùa luật ván); buổi 20:00 cùng ngày đã bắt đầu. */
const NOW = new Date('2026-11-02T21:00:00+07:00');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(NOW);

const role = (over: Pick<RoleDto, 'id' | 'key' | 'faction' | 'nameVi' | 'nameEn' | 'icon' | 'metricLabel' | 'maxPerGame'> & Partial<RoleDto>): RoleDto => ({
  description: '',
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
  role({ id: 1, key: 'goose', faction: 'goose', nameVi: 'Ngỗng', nameEn: 'Goose', icon: '🪿', metricLabel: 'Số lần vote trúng Vịt', maxPerGame: 10 }),
  role({ id: 61, key: 'swordsman', faction: 'duck', nameVi: 'Kiếm sĩ', nameEn: 'Swordsman', icon: '⚔️', metricLabel: 'Số mạng chém', maxPerGame: 15 }),
  role({ id: 70, key: 'dodo', faction: 'neutral', nameVi: 'Chim đa đa', nameEn: 'Dodo', icon: '🦤', metricLabel: 'Số trận thắng (bị vote ra)', maxPerGame: 1 }),
];

const member = (accessLevel: MeDto['accessLevel']): MeDto => ({ id: 9, memberCode: 'GGD-0009', displayName: 'Tôi', avatarUrl: null, email: null, notifyEmail: true, notifyDm: true, accessLevel });

const myReport = (over: Partial<ReportDto> = {}): ReportDto => ({
  id: 40,
  member: { id: 9, displayName: 'Tôi' },
  role: { id: 61, nameVi: 'Kiếm sĩ', icon: '⚔️', metricLabel: 'Số mạng chém', maxPerGame: 15, points: 1, extraMetricLabel: null, extraMaxPerGame: null, extraPoints: null, penaltyMetricLabel: null, penaltyMaxPerGame: null, penaltyPoints: null },
  value: 3,
  extraValue: 0,
  penaltyValue: 0,
  bonusPoints: 0,
  source: 'self',
  multiplier: 1,
  points: 0,
  playedOn: '2026-11-02',
  sessionId: 7,
  note: null,
  status: 'pending',
  rejectReason: null,
  createdAt: '2026-11-02T13:30:00.000Z',
  highlightUrl: null,
  accusation: null,
  accusationDuplicate: false,
  accusationWaitingFor: null,
  penaltyOf: null,
  round: { id: 101, number: 1, sessionId: 7, winnerFaction: null, won: false },
  ...over,
});

const decl = (id: number, memberId: number, name: string, roleIndex: number, over: Partial<RoundReportDto> = {}): RoundReportDto => {
  const r = roles[roleIndex]!;
  return { id, member: { id: memberId, displayName: name, avatarUrl: null }, role: { id: r.id, nameVi: r.nameVi, icon: r.icon, faction: r.faction }, status: 'approved', won: false, mine: null, ...over };
};

const round = (over: Partial<RoundDto> & Pick<RoundDto, 'id' | 'number'>): RoundDto => ({
  sessionId: 7,
  winnerFaction: null,
  winnerIds: [],
  imageUrl: `/api/rounds/${over.id}/image?v=1`,
  imageUpdatedAt: '2026-11-02T13:20:00.000Z',
  reports: [],
  ...over,
});

const session: SessionRoundsDto['session'] = { id: 7, startsAt: '2026-11-02T13:00:00.000Z', modeName: 'Cổ điển (Classic)', status: 'ended' };

const twoRounds = (): SessionRoundsDto => ({
  session,
  rounds: [
    round({ id: 101, number: 1, reports: [decl(1, 10, 'Vịt Mười', 1), decl(2, 11, 'Đa Đa Mười Một', 2)] }),
    round({ id: 102, number: 2, winnerFaction: 'goose', reports: [decl(3, 10, 'Vịt Mười', 0)] }),
  ],
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Handler = (init: RequestInit | undefined, url: string) => Response | Promise<Response>;

function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('?')[0] ?? url;
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Không có tuyến giả cho ${key}`);
    return Promise.resolve(handler(init, url));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const routesFor = (data: SessionRoundsDto | (() => SessionRoundsDto), me: MeDto = member('member')): Record<string, Handler> => ({
  'GET /api/sessions/7/rounds': () => json(200, typeof data === 'function' ? data() : data),
  'GET /api/me': () => json(200, me),
  'GET /api/roles': () => json(200, roles),
});

const renderPage = (path = '/buoi/7') => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="buoi/:id" element={<SessionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
};

const card = async (n: number) => (await screen.findByRole('heading', { name: `Ván ${n}` })).closest('article') as HTMLElement;
/** Bấm một nút trong thẻ khi nó đã bật (nút mở form chờ danh sách role về). */
async function clickEnabled(scope: HTMLElement, name: string) {
  const button = within(scope).getByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
const calls = (fetchMock: ReturnType<typeof vi.fn>, method: string) => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('the page shows the session title, round images, winner chips and public declarations', async () => {
  stubFetch(routesFor(twoRounds()));
  renderPage();

  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Buổi 20:00 · Thứ Hai, 02/11');
  expect(screen.getByText('Cổ điển (Classic)')).toBeInTheDocument();

  const first = await card(1);
  expect(within(first).getByText('Chưa chọn phe thắng')).toBeInTheDocument();
  expect(first.querySelector('img')).toHaveAttribute('src', '/api/rounds/101/image?v=1');
  const list = within(first).getByRole('list', { name: 'Lần khai ván 1' });
  expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['VVịt Mười⚔️ Kiếm sĩ', 'ĐĐa Đa Mười Một🦤 Chim đa đa']);
  expect(within(await card(2)).getByText('🦢 Ngỗng thắng')).toBeInTheDocument();

  // Thành viên thường không thấy phần quản lý.
  expect(screen.queryByRole('button', { name: '+ Thêm ván' })).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Quản lý ván 1' })).not.toBeInTheDocument();
});

test('clicking a round image opens it zoomed in a dialog', async () => {
  stubFetch(routesFor(twoRounds()));
  renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'Phóng to ảnh ván 2' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ảnh ván 2' });
  expect(within(dialog).getByRole('img', { name: 'Ảnh ván 2' })).toHaveAttribute('src', '/api/rounds/102/image?v=1');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('a session without rounds says the mod has not uploaded yet', async () => {
  stubFetch(routesFor({ session, rounds: [] }));
  renderPage();
  expect(await screen.findByText('Buổi này chưa có ảnh ván, chờ mod up')).toBeInTheDocument();
});

test('"Khai role ván này" opens a form that posts the round report and shows it in the list', async () => {
  let data = twoRounds();
  const fetchMock = stubFetch({
    ...routesFor(() => data),
    'POST /api/rounds/101/reports': (init) => {
      const body = JSON.parse(String(init?.body)) as { roleId: number; value: number };
      const created = myReport({ value: body.value });
      data = { ...data, rounds: data.rounds.map((r) => (r.id === 101 ? { ...r, reports: [...r.reports, decl(40, 9, 'Tôi', 1, { status: 'pending', mine: created })] } : r)) };
      return json(201, created);
    },
  });
  renderPage();

  const first = await card(1);
  await clickEnabled(first, 'Khai role ván này');
  const form = within(first).getByRole('form', { name: 'Khai role ván 1' });

  // Chưa chọn role → chặn tại chỗ.
  fireEvent.click(within(form).getByRole('button', { name: 'Gửi' }));
  expect(within(form).getByRole('alert')).toHaveTextContent('Hãy chọn role');

  // Ô chọn role có tìm, nhóm theo phe.
  fireEvent.click(within(form).getByRole('combobox', { name: 'Role' }));
  const listbox = screen.getByRole('listbox', { name: 'Role' });
  expect(within(listbox).getAllByRole('group').map((g) => g.firstElementChild?.textContent)).toEqual(['Ngỗng', 'Vịt', 'Phe thứ 3']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm role' }), { target: { value: 'kiem' } });
  fireEvent.click(screen.getByRole('option', { name: '⚔️ Kiếm sĩ' }));

  fireEvent.change(within(form).getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '3' } });
  fireEvent.change(within(form).getByRole('textbox', { name: 'Ghi chú' }), { target: { value: ' Ván đầu ' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Gửi' }));

  await waitFor(() => expect(within(first).getByText('Bạn đã khai:')).toBeInTheDocument());
  const [post] = calls(fetchMock, 'POST');
  expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ roleId: 61, value: 3, note: 'Ván đầu' });
  expect(within(first).getByRole('list', { name: 'Lần khai ván 1' })).toHaveTextContent('Chờ duyệt');
  expect(within(first).queryByRole('button', { name: 'Khai role ván này' })).not.toBeInTheDocument();
});

test('a pending own report can be edited without sending round, day or session', async () => {
  const data = twoRounds();
  data.rounds[0]!.reports.push(decl(40, 9, 'Tôi', 1, { status: 'pending', mine: myReport() }));
  const fetchMock = stubFetch({ ...routesFor(data), 'PATCH /api/reports/40': () => json(200, myReport({ value: 5 })) });
  renderPage();

  const first = await card(1);
  expect(within(first).getByText('Bạn đã khai:')).toBeInTheDocument();
  await clickEnabled(first, 'Sửa');
  const form = within(first).getByRole('form', { name: 'Sửa lần khai ván 1' });
  const value = within(form).getByRole('spinbutton', { name: 'Số mạng chém' });
  expect(value).toHaveValue(3);
  fireEvent.change(value, { target: { value: '5' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));

  await waitFor(() => expect(calls(fetchMock, 'PATCH')).toHaveLength(1));
  expect(JSON.parse(String((calls(fetchMock, 'PATCH')[0]?.[1] as RequestInit).body))).toEqual({ roleId: 61, value: 5, extraValue: 0, penaltyValue: 0, note: null });
});

test('server errors of a round report are shown verbatim', async () => {
  stubFetch({
    ...routesFor(twoRounds()),
    'POST /api/rounds/101/reports': () => json(409, { error: { code: 'ROUND_REPORT_DUPLICATE', message: 'Bạn đã khai ván này rồi' } }),
  });
  renderPage();

  const first = await card(1);
  await clickEnabled(first, 'Khai role ván này');
  const form = within(first).getByRole('form', { name: 'Khai role ván 1' });
  fireEvent.click(within(form).getByRole('combobox', { name: 'Role' }));
  fireEvent.click(screen.getByRole('option', { name: '🪿 Ngỗng' }));
  fireEvent.change(within(form).getByRole('spinbutton', { name: 'Số lần vote trúng Vịt' }), { target: { value: '1' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Gửi' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Bạn đã khai ván này rồi');
});

test('an old or cancelled session takes no round reports', async () => {
  stubFetch(routesFor({ session: { ...session, startsAt: '2026-10-28T13:00:00.000Z' }, rounds: twoRounds().rounds }));
  renderPage();
  await card(1);
  expect(screen.queryByRole('button', { name: 'Khai role ván này' })).not.toBeInTheDocument();
});

test('a mod adds a round with the raw image and an optional winner', async () => {
  let data: SessionRoundsDto = { session, rounds: [] };
  const fetchMock = stubFetch({
    ...routesFor(() => data, member('mod')),
    'POST /api/admin/sessions/7/rounds': () => {
      const created = round({ id: 103, number: 1, winnerFaction: 'duck' });
      data = { ...data, rounds: [created] };
      return json(201, created);
    },
  });
  renderPage();

  const add = await screen.findByRole('button', { name: '+ Thêm ván' });
  fireEvent.click(add);
  expect(screen.getByRole('alert')).toHaveTextContent('Hãy chọn ảnh kết quả ván');

  const input = screen.getByLabelText('Ảnh kết quả');
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
  fireEvent.click(add);
  expect(screen.getByRole('alert')).toHaveTextContent('Chỉ nhận ảnh PNG, JPG hoặc WebP');
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })] } });
  fireEvent.click(add);
  expect(screen.getByRole('alert')).toHaveTextContent('Ảnh tối đa 5 MB');

  const image = new File(['png'], 'van.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [image] } });
  const section = add.closest('section') as HTMLElement;
  fireEvent.click(within(section).getByRole('combobox', { name: 'Phe thắng' }));
  fireEvent.click(screen.getByRole('option', { name: 'Vịt' }));
  fireEvent.click(add);

  expect(await screen.findByRole('heading', { name: 'Ván 1' })).toBeInTheDocument();
  const [post] = calls(fetchMock, 'POST');
  expect(post?.[0]).toBe('/api/admin/sessions/7/rounds?winnerFaction=duck');
  const init = post?.[1] as RequestInit;
  expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
  expect(init.body).toBe(image);
});

test('a mod sets the winner, ticks neutral winners, replaces the image and deletes a round', async () => {
  let data = twoRounds();
  const put = (r: RoundDto) => {
    data = { ...data, rounds: data.rounds.map((item) => (item.id === r.id ? r : item)) };
    return json(200, r);
  };
  const fetchMock = stubFetch({
    ...routesFor(() => data, member('admin')),
    'PATCH /api/admin/rounds/101': (init) => {
      const body = JSON.parse(String(init?.body)) as { winnerFaction?: 'neutral'; winnerIds?: number[] };
      const current = data.rounds[0]!;
      return put({ ...current, winnerFaction: body.winnerFaction ?? current.winnerFaction, winnerIds: body.winnerIds ?? current.winnerIds });
    },
    'PUT /api/admin/rounds/101/image': () => put({ ...data.rounds[0]!, imageUrl: '/api/rounds/101/image?v=2' }),
    'DELETE /api/admin/rounds/102': () => json(409, { error: { code: 'ROUND_HAS_REPORTS', message: 'Ván đã có lần khai — không xoá được' } }),
  });
  renderPage();

  const first = await card(1);
  const admin = await within(first).findByRole('group', { name: 'Quản lý ván 1' });
  fireEvent.click(within(admin).getByRole('combobox', { name: 'Phe thắng' }));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Chưa chọn', 'Ngỗng', 'Vịt', 'Phe thứ 3']);
  fireEvent.click(screen.getByRole('option', { name: 'Phe thứ 3' }));
  await waitFor(() => expect(within(first).getByText('Phe thứ 3 thắng')).toBeInTheDocument());
  expect(JSON.parse(String((calls(fetchMock, 'PATCH')[0]?.[1] as RequestInit).body))).toEqual({ winnerFaction: 'neutral' });

  // Chỉ người đã khai role phe thứ 3 ở ván này mới tick được.
  const winners = within(first).getByRole('group', { name: 'Người thắng (Phe thứ 3)' });
  expect(within(winners).getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.click(within(winners).getByRole('checkbox', { name: 'Đa Đa Mười Một (🦤 Chim đa đa)' }));
  await waitFor(() => expect(within(winners).getByRole('checkbox')).toBeChecked());
  expect(JSON.parse(String((calls(fetchMock, 'PATCH')[1]?.[1] as RequestInit).body))).toEqual({ winnerIds: [11] });

  fireEvent.change(within(admin).getByLabelText('Đổi ảnh'), { target: { files: [new File(['w'], 'b.webp', { type: 'image/webp' })] } });
  await waitFor(() => expect(first.querySelector('img')).toHaveAttribute('src', '/api/rounds/101/image?v=2'));

  // Xoá: hỏi lại; ván đã có lần khai → lỗi của server.
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  const second = await card(2);
  fireEvent.click(within(second).getByRole('button', { name: 'Xoá ván' }));
  expect(calls(fetchMock, 'DELETE')).toHaveLength(0);
  fireEvent.click(within(second).getByRole('button', { name: 'Xoá ván' }));
  expect(confirm).toHaveBeenLastCalledWith('Xoá ván 2? Không hoàn tác được.');
  expect(await within(second).findByRole('alert')).toHaveTextContent('Ván đã có lần khai — không xoá được');
});

test('deleting a round without reports removes it from the page', async () => {
  const data: SessionRoundsDto = { session, rounds: [round({ id: 105, number: 3 })] };
  stubFetch({ ...routesFor(data, member('mod')), 'DELETE /api/admin/rounds/105': () => new Response(null, { status: 204 }) });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderPage();

  fireEvent.click(await within(await card(3)).findByRole('button', { name: 'Xoá ván' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Ván 3' })).not.toBeInTheDocument());
  expect(screen.getByText('Buổi này chưa có ảnh ván, chờ mod up')).toBeInTheDocument();
});
