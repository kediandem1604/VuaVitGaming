import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MeDto, ReportDto, RoleDto, RoundDto, RoundReportDto, SessionRoundsDto } from '../../src/shared/api-types';
import { ImageDecodeError, prepareRoundImage } from '../../src/web/lib/imageResize';
import { APPROVED_REPORTS_KEY, PENDING_REPORTS_KEY } from '../../src/web/lib/queryKeys';
import { SessionPage } from '../../src/web/pages/SessionPage';

// Thu nhỏ ảnh dùng canvas thật — có test riêng (imageResize.test.ts); ở đây giả: ảnh chính = file gốc,
// ảnh nhỏ = một blob WebP cố định.
vi.mock('../../src/web/lib/imageResize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/web/lib/imageResize')>()),
  prepareRoundImage: vi.fn(),
}));
const THUMB = new Blob(['thumb'], { type: 'image/webp' });
const prepareMock = vi.mocked(prepareRoundImage);
beforeEach(() => {
  prepareMock.mockImplementation(async (file: File) => ({ main: file, thumb: THUMB }));
});

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
  round: { id: 101, number: 1, sessionId: 7, sessionStartsAt: '2026-11-02T13:00:00.000Z', winnerFaction: null, won: false, imageUrl: '/api/rounds/101/image?v=1', thumbUrl: '/api/rounds/101/image?size=thumb&v=1' },
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
  thumbUrl: `/api/rounds/${over.id}/image?size=thumb&v=1`,
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
  expect(first.querySelector('img')).toHaveAttribute('src', '/api/rounds/101/image?size=thumb&v=1');
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
    'PUT /api/admin/rounds/103/thumbnail': () => {
      const withThumb = { ...data.rounds[0]!, thumbUrl: '/api/rounds/103/image?size=thumb&v=2' };
      data = { ...data, rounds: [withThumb] };
      return json(200, withThumb);
    },
  });
  const queryClient = renderPage();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

  const add = await screen.findByRole('button', { name: '+ Thêm ván' });
  fireEvent.click(add);
  expect(screen.getByRole('alert')).toHaveTextContent('Hãy chọn ảnh kết quả ván');

  const input = screen.getByLabelText('Ảnh kết quả');
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
  fireEvent.click(add);
  expect(screen.getByRole('alert')).toHaveTextContent('Chỉ nhận ảnh PNG, JPG hoặc WebP');
  // Ảnh to được thu nhỏ trước; chỉ khi bản thu nhỏ vẫn quá 5 MB mới báo lỗi.
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })] } });
  fireEvent.click(add);
  expect(await screen.findByRole('alert')).toHaveTextContent('Ảnh tối đa 5 MB');
  // Trình duyệt không đọc được ảnh.
  prepareMock.mockRejectedValueOnce(new ImageDecodeError());
  fireEvent.change(input, { target: { files: [new File(['broken'], 'hong.png', { type: 'image/png' })] } });
  fireEvent.click(add);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được ảnh');
  expect(calls(fetchMock, 'POST')).toHaveLength(0);

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
  // Rồi ảnh nhỏ, qua route riêng; lưới dùng ảnh nhỏ.
  await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
  const [thumbPut] = calls(fetchMock, 'PUT');
  expect(thumbPut?.[0]).toBe('/api/admin/rounds/103/thumbnail');
  expect((thumbPut?.[1] as RequestInit).body).toBe(THUMB);
  expect(((thumbPut?.[1] as RequestInit).headers as Record<string, string>)['content-type']).toBe('image/webp');
  const added = await card(1);
  await waitFor(() => expect(added.querySelector('img')).toHaveAttribute('src', '/api/rounds/103/image?size=thumb&v=2'));
  // "Ván đấu ({n})" ở Quản trị → Buổi chơi đổi theo.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions'] });
});

test('a failed thumbnail upload keeps the new round (the server serves the full image instead)', async () => {
  let data: SessionRoundsDto = { session, rounds: [] };
  stubFetch({
    ...routesFor(() => data, member('mod')),
    'POST /api/admin/sessions/7/rounds': () => {
      const created = round({ id: 104, number: 1 });
      data = { ...data, rounds: [created] };
      return json(201, created);
    },
    'PUT /api/admin/rounds/104/thumbnail': () => json(400, { error: { code: 'INVALID_IMAGE', message: 'Ảnh nhỏ tối đa 300 KB' } }),
  });
  renderPage();
  fireEvent.change(await screen.findByLabelText('Ảnh kết quả'), { target: { files: [new File(['png'], 'van.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: '+ Thêm ván' }));
  expect(await screen.findByRole('heading', { name: 'Ván 1' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: '+ Thêm ván' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('the winner select is locked while its change is saving', async () => {
  const data = twoRounds();
  let release: (r: Response) => void = () => undefined;
  stubFetch({
    ...routesFor(data, member('mod')),
    'PATCH /api/admin/rounds/101': () => new Promise<Response>((resolve) => (release = resolve)),
  });
  renderPage();
  const admin = await within(await card(1)).findByRole('group', { name: 'Quản lý ván 1' });
  const select = within(admin).getByRole('combobox', { name: 'Phe thắng' });
  fireEvent.click(select);
  fireEvent.click(screen.getByRole('option', { name: 'Vịt' }));
  await waitFor(() => expect(select).toBeDisabled());
  release(json(200, { ...data.rounds[0]!, winnerFaction: 'duck' }));
  await waitFor(() => expect(select).toBeEnabled());
});

test('replacing an image uploads the new thumbnail and refreshes the review lists', async () => {
  let data = twoRounds();
  const fetchMock = stubFetch({
    ...routesFor(() => data, member('mod')),
    'PUT /api/admin/rounds/101/image': () => json(200, { ...data.rounds[0]!, imageUrl: '/api/rounds/101/image?v=2', thumbUrl: '/api/rounds/101/image?size=thumb&v=2' }),
    'PUT /api/admin/rounds/101/thumbnail': () => {
      const updated = { ...data.rounds[0]!, imageUrl: '/api/rounds/101/image?v=3', thumbUrl: '/api/rounds/101/image?size=thumb&v=3' };
      data = { ...data, rounds: [updated, data.rounds[1]!] };
      return json(200, updated);
    },
  });
  const queryClient = renderPage();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const first = await card(1);
  const admin = await within(first).findByRole('group', { name: 'Quản lý ván 1' });

  // Ảnh hỏng → báo tại chỗ, không gửi gì.
  prepareMock.mockRejectedValueOnce(new ImageDecodeError());
  fireEvent.change(within(admin).getByLabelText('Đổi ảnh'), { target: { files: [new File(['x'], 'hong.webp', { type: 'image/webp' })] } });
  expect(await within(admin).findByRole('alert')).toHaveTextContent('Không đọc được ảnh');
  expect(calls(fetchMock, 'PUT')).toHaveLength(0);

  fireEvent.change(within(admin).getByLabelText('Đổi ảnh'), { target: { files: [new File(['w'], 'b.webp', { type: 'image/webp' })] } });
  await waitFor(() => expect(first.querySelector('img')).toHaveAttribute('src', '/api/rounds/101/image?size=thumb&v=3'));
  expect(calls(fetchMock, 'PUT').map(([url]) => url)).toEqual(['/api/admin/rounds/101/image', '/api/admin/rounds/101/thumbnail']);
  expect(within(admin).queryByRole('alert')).not.toBeInTheDocument();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: PENDING_REPORTS_KEY });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: APPROVED_REPORTS_KEY });
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
    'PUT /api/admin/rounds/101/image': () => put({ ...data.rounds[0]!, imageUrl: '/api/rounds/101/image?v=2', thumbUrl: '/api/rounds/101/image?size=thumb&v=2' }),
    'DELETE /api/admin/rounds/102': () => json(409, { error: { code: 'ROUND_HAS_REPORTS', message: 'Ván đã có lần khai — không xoá được' } }),
  });
  renderPage();

  const first = await card(1);
  const admin = await within(first).findByRole('group', { name: 'Quản lý ván 1' });
  fireEvent.click(within(admin).getByRole('combobox', { name: 'Phe thắng' }));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Chưa chọn', 'Ngỗng', 'Vịt', 'Phe thứ 3']);
  fireEvent.click(screen.getByRole('option', { name: 'Phe thứ 3' }));
  await waitFor(() => expect(within(first).getByText('Phe thứ 3 thắng')).toBeInTheDocument());
  // Chỉ một người khai role phe thứ 3 → tick sẵn người đó trong cùng lần PATCH.
  expect(JSON.parse(String((calls(fetchMock, 'PATCH')[0]?.[1] as RequestInit).body))).toEqual({ winnerFaction: 'neutral', winnerIds: [11] });

  // Chỉ người đã khai role phe thứ 3 ở ván này mới tick được.
  const winners = within(first).getByRole('group', { name: 'Người thắng (Phe thứ 3)' });
  expect(within(winners).getAllByRole('checkbox')).toHaveLength(1);
  await waitFor(() => expect(within(winners).getByRole('checkbox')).toBeChecked());
  expect(within(admin).queryByRole('status')).not.toBeInTheDocument();
  expect(within(first).queryByText('Chưa chọn người thắng')).not.toBeInTheDocument();

  // Bỏ tick → cảnh báo chưa ai được điểm (trong khung quản lý và chip cạnh phe thắng).
  fireEvent.click(within(winners).getByRole('checkbox', { name: 'Đa Đa Mười Một (🦤 Chim đa đa)' }));
  await waitFor(() => expect(within(winners).getByRole('checkbox')).not.toBeChecked());
  expect(JSON.parse(String((calls(fetchMock, 'PATCH')[1]?.[1] as RequestInit).body))).toEqual({ winnerIds: [] });
  expect(within(admin).getByRole('status')).toHaveTextContent('Chưa chọn người thắng — phe thứ 3 chưa ai được điểm. Tick người thắng bên dưới.');
  expect(within(first).getByText('Chưa chọn người thắng')).toBeInTheDocument();

  fireEvent.change(within(admin).getByLabelText('Đổi ảnh'), { target: { files: [new File(['w'], 'b.webp', { type: 'image/webp' })] } });
  await waitFor(() => expect(first.querySelector('img')).toHaveAttribute('src', '/api/rounds/101/image?size=thumb&v=2'));

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
  const queryClient = renderPage();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

  fireEvent.click(await within(await card(3)).findByRole('button', { name: 'Xoá ván' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Ván 3' })).not.toBeInTheDocument());
  expect(screen.getByText('Buổi này chưa có ảnh ván, chờ mod up')).toBeInTheDocument();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions'] });
});

test('with two neutral declarers the mod must tick the winners themselves', async () => {
  let data: SessionRoundsDto = {
    session,
    rounds: [round({ id: 101, number: 1, reports: [decl(1, 11, 'Đa Đa Mười Một', 2), decl(2, 12, 'Đa Đa Mười Hai', 2, { status: 'pending' }), decl(3, 10, 'Vịt Mười', 1)] })],
  };
  const fetchMock = stubFetch({
    ...routesFor(() => data, member('mod')),
    'PATCH /api/admin/rounds/101': (init) => {
      const body = JSON.parse(String(init?.body)) as { winnerFaction?: 'neutral'; winnerIds?: number[] };
      const current = data.rounds[0]!;
      const updated = { ...current, winnerFaction: body.winnerFaction ?? current.winnerFaction, winnerIds: body.winnerIds ?? current.winnerIds };
      data = { ...data, rounds: [updated] };
      return json(200, updated);
    },
  });
  renderPage();
  const first = await card(1);
  const admin = await within(first).findByRole('group', { name: 'Quản lý ván 1' });
  fireEvent.click(within(admin).getByRole('combobox', { name: 'Phe thắng' }));
  fireEvent.click(screen.getByRole('option', { name: 'Phe thứ 3' }));
  await waitFor(() => expect(within(first).getByText('Phe thứ 3 thắng')).toBeInTheDocument());
  expect(JSON.parse(String((calls(fetchMock, 'PATCH')[0]?.[1] as RequestInit).body))).toEqual({ winnerFaction: 'neutral' });

  const winners = within(first).getByRole('group', { name: 'Người thắng (Phe thứ 3)' });
  expect(within(winners).getAllByRole('checkbox')).toHaveLength(2);
  for (const box of within(winners).getAllByRole('checkbox')) expect(box).not.toBeChecked();
  expect(within(admin).getByRole('status')).toHaveTextContent('Chưa chọn người thắng — phe thứ 3 chưa ai được điểm. Tick người thắng bên dưới.');

  fireEvent.click(within(winners).getByRole('checkbox', { name: 'Đa Đa Mười Hai (🦤 Chim đa đa)' }));
  await waitFor(() => expect(within(winners).getByRole('checkbox', { name: 'Đa Đa Mười Hai (🦤 Chim đa đa)' })).toBeChecked());
  expect(JSON.parse(String((calls(fetchMock, 'PATCH')[1]?.[1] as RequestInit).body))).toEqual({ winnerIds: [12] });
  expect(within(admin).queryByRole('status')).not.toBeInTheDocument();
  expect(within(first).queryByText('Chưa chọn người thắng')).not.toBeInTheDocument();
});

test('a neutral win without neutral declarers says nobody declared one', async () => {
  const data: SessionRoundsDto = { session, rounds: [round({ id: 101, number: 1, winnerFaction: 'neutral', reports: [decl(1, 10, 'Vịt Mười', 1)] })] };
  stubFetch(routesFor(data, member('mod')));
  renderPage();
  const first = await card(1);
  const admin = await within(first).findByRole('group', { name: 'Quản lý ván 1' });
  expect(within(admin).getByRole('status')).toHaveTextContent('Chưa ai khai role phe thứ 3 ở ván này.');
  expect(within(admin).queryByRole('checkbox')).not.toBeInTheDocument();
  expect(within(first).getByText('Chưa chọn người thắng')).toBeInTheDocument();
});

test('members do not see the missing-winner chip', async () => {
  const data: SessionRoundsDto = { session, rounds: [round({ id: 101, number: 1, winnerFaction: 'neutral', reports: [decl(1, 11, 'Đa Đa Mười Một', 2)] })] };
  stubFetch(routesFor(data));
  renderPage();
  const first = await card(1);
  expect(within(first).getByText('Phe thứ 3 thắng')).toBeInTheDocument();
  expect(within(first).queryByText('Chưa chọn người thắng')).not.toBeInTheDocument();
  expect(within(first).queryByRole('status')).not.toBeInTheDocument();
});
