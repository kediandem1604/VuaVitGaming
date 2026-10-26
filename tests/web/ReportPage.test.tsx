import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { HighlightConfigDto, ReportDto, RoleDto, SessionDto } from '../../src/shared/api-types';
import { vnTodayIso } from '../../src/web/lib/format';
import { ReportPage } from '../../src/web/pages/ReportPage';
import { PENDING_REPORTS_KEY } from '../../src/web/pages/admin/ReviewsTab';

const role = (over: Pick<RoleDto, 'id' | 'key' | 'faction' | 'nameVi' | 'nameEn' | 'icon' | 'metricLabel' | 'maxPerGame'> & Partial<RoleDto>): RoleDto => ({
  description: '',
  extraMetricLabel: null,
  extraMaxPerGame: null,
  extraPoints: null,
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
];

const EXTRA_LABEL = 'Số lần ám sát trong cuộc họp';
const EXTRA_HINT = 'Tối đa 2 mỗi trận · +3 điểm mỗi lần';
const EXTRA_OUT_OF_RANGE = 'Chỉ số phụ phải từ 0 đến 2';

/** Phần role kèm trong lần khai của Ám sát (như `ReportDto.role` server trả). */
const ASSASSIN_REPORT_ROLE: ReportDto['role'] = {
  id: 50,
  nameVi: 'Ám sát',
  icon: '🗡️',
  metricLabel: 'Số mạng đã giết',
  maxPerGame: 15,
  extraMetricLabel: EXTRA_LABEL,
  extraMaxPerGame: 2,
  extraPoints: 3,
};

const today = vnTodayIso();

const session: SessionDto = {
  id: 7,
  startsAt: `${today}T14:00:00.000Z`,
  modeName: 'Cổ điển (Classic)',
  capacity: 16,
  roomCode: null,
  note: null,
  status: 'scheduled',
  attendees: [],
  myStatus: null,
};

const report = (over: Partial<ReportDto> & Pick<ReportDto, 'id' | 'status'>): ReportDto => ({
  member: { id: 9, displayName: 'Tôi' },
  role: { id: 61, nameVi: 'Kiếm sĩ', icon: '⚔️', metricLabel: 'Số mạng chém', maxPerGame: 15, extraMetricLabel: null, extraMaxPerGame: null, extraPoints: null },
  value: 4,
  extraValue: 0,
  points: over.value ?? 4,
  playedOn: today,
  sessionId: null,
  note: null,
  rejectReason: null,
  createdAt: '2026-10-22T13:00:00.000Z',
  highlightUrl: null,
  ...over,
});

const mine: ReportDto[] = [
  report({ id: 3, status: 'pending', value: 4, note: 'Trận cuối' }),
  report({ id: 2, status: 'approved', value: 6 }),
  report({ id: 1, status: 'rejected', value: 30, rejectReason: 'Quá giới hạn của role' }),
];

const MIB = 1_048_576;
/** Tính năng highlight đang bật với giới hạn 10 MiB (server Discord chưa boost). */
const highlightConfig = (over: Partial<HighlightConfigDto> = {}): HighlightConfigDto => ({ enabled: true, maxBytes: 10 * MIB, ...over });
const HIGHLIGHT_URL = 'https://discord.com/channels/1/2/3';
const HIGHLIGHT_LABEL = 'Highlight (không bắt buộc)';
const INVALID_HIGHLIGHT = 'Highlight phải là video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF';
/** File giả với tên, `type` (trống = trình duyệt không cho biết) và kích cỡ tuỳ ý. */
const clip = (name = 'clip.mp4', type = 'video/mp4', size = 8) => new File([new Uint8Array(size)], name, { type });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (init: RequestInit | undefined, url: string) => Response | Promise<Response>;

/** fetch giả định tuyến theo `METHOD path` (bỏ query string). */
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

const baseRoutes: Record<string, Handler> = {
  'GET /api/roles': () => json(200, roles),
  'GET /api/reports/mine': () => json(200, mine),
  'GET /api/reports/highlight-config': () => json(200, highlightConfig()),
  'GET /api/sessions': () => json(200, [session]),
};

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
};

/** Các lời gọi fetch theo phương thức (`POST` tạo lần khai, `PUT` tải highlight). */
const calls = (fetchMock: ReturnType<typeof vi.fn>, method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);

/** Ô chọn file ẩn sau nút "Thêm highlight" / "Đổi highlight" của một lần khai. */
const pickerOf = (item: HTMLElement) => item.querySelector('input[type="file"]') as HTMLInputElement;

/** Gõ vào ô tìm role rồi chọn một kết quả. */
async function pickRole(query: string, name: RegExp) {
  fireEvent.change(await screen.findByRole('combobox', { name: 'Role' }), { target: { value: query } });
  fireEvent.click(await screen.findByRole('option', { name }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('a diacritic-less query finds Kiếm sĩ and selecting it labels the value with its metric', async () => {
  stubFetch(baseRoutes);
  renderPage();

  const search = await screen.findByRole('combobox', { name: 'Role' });
  fireEvent.change(search, { target: { value: 'kiem si' } });
  const listbox = await screen.findByRole('listbox', { name: 'Kết quả tìm role' });
  const options = within(listbox).getAllByRole('option');
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveTextContent('⚔️ Kiếm sĩ — Số mạng chém');
  expect(screen.queryByRole('option', { name: /Ngỗng/ })).not.toBeInTheDocument();

  fireEvent.click(options[0] as HTMLElement);
  const value = screen.getByRole('spinbutton', { name: 'Số mạng chém' });
  expect(value).toHaveAttribute('min', '0');
  expect(value).toHaveAttribute('max', '15');
  expect(screen.getByText('Tối đa 15 mỗi trận')).toBeInTheDocument();
  // Danh sách gợi ý đóng lại sau khi chọn.
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

  // Tiếng Anh và key cũng khớp; không khớp thì báo.
  fireEvent.change(search, { target: { value: 'DODO' } });
  expect(await screen.findByRole('option', { name: /Chim đa đa/ })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'xyz' } });
  expect(await screen.findByText('Không có role nào khớp')).toBeInTheDocument();
});

test('suggestions show a mini character and the faction, and the chosen role becomes a card', async () => {
  stubFetch(baseRoutes);
  renderPage();

  // "o" khớp cả ba role (goose, swordsman, dodo) nên thấy đủ ba phe.
  fireEvent.change(await screen.findByRole('combobox', { name: 'Role' }), { target: { value: 'o' } });
  const listbox = await screen.findByRole('listbox', { name: 'Kết quả tìm role' });
  const options = within(listbox).getAllByRole('option');
  expect(options).toHaveLength(3);
  const expected: Array<[string, string]> = [
    ['Ngỗng', 'Phe Ngỗng'],
    ['Kiếm sĩ', 'Phe Vịt'],
    ['Chim đa đa', 'Phe thứ 3'],
  ];
  expected.forEach(([name, faction], index) => {
    const option = options[index] as HTMLElement;
    // Nhân vật thu nhỏ có vẽ trong gợi ý nhưng chỉ trang trí (aria-hidden): tên gợi ý đọc tên
    // role một lần, không kèm nhãn của hình hay emoji.
    expect(option.querySelector('svg [data-part="body"]')).not.toBeNull();
    expect(within(option).queryByRole('img')).toBeNull();
    // Trước đây: "Kiếm sĩ ⚔️ Kiếm sĩ — …" (nhãn của hình, emoji, rồi tên).
    expect(option).toHaveAccessibleName(new RegExp(`^${name}\\s*— `));
    expect(option).toHaveTextContent(faction);
  });
  // Không gợi ý nào mang bảng tên trống của nhân vật.
  expect(within(listbox).queryByText('Chưa ai hoá thân')).toBeNull();

  fireEvent.click(options[1] as HTMLElement);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  // Thẻ role đã chọn: nhân vật mặc bộ đồ của role (trang trí), dòng "Đã chọn" và phe.
  const chosen = screen.getByText(/Đã chọn/).closest('.panel-inset') as HTMLElement;
  expect(chosen.querySelector('svg [data-part="body"]')).not.toBeNull();
  expect(chosen.querySelector('[data-kit="sword"]')).not.toBeNull();
  expect(within(chosen).queryByRole('img')).toBeNull();
  expect(screen.getByText(/Đã chọn/)).toHaveTextContent('Đã chọn: ⚔️ Kiếm sĩ (Swordsman)');
  expect(screen.getByText('Phe Vịt')).toBeInTheDocument();
});

test('status chips are gold while pending, ok once approved and duck-soft when rejected', async () => {
  stubFetch(baseRoutes);
  renderPage();

  const items = await screen.findAllByRole('listitem');
  expect(within(items[0] as HTMLElement).getByText('Chờ duyệt')).toHaveClass('chip', 'bg-gold');
  expect(within(items[1] as HTMLElement).getByText('Đã duyệt')).toHaveClass('chip', 'bg-ok');
  expect(within(items[2] as HTMLElement).getByText('Bị từ chối')).toHaveClass('chip', 'bg-duck-soft');
});

test('the date input is bounded to the last three days and lists that day\'s sessions', async () => {
  const fetchMock = stubFetch(baseRoutes);
  renderPage();

  const date = await screen.findByLabelText('Ngày chơi');
  expect(date).toHaveValue(today);
  expect(date).toHaveAttribute('max', today);
  const [y = 0, m = 0, d = 0] = today.split('-').map(Number);
  const threeDaysAgo = new Date(Date.UTC(y, m - 1, d - 3)).toISOString().slice(0, 10);
  expect(date).toHaveAttribute('min', threeDaysAgo);

  const sessionSelect = await screen.findByRole('combobox', { name: 'Buổi chơi (không bắt buộc)' });
  expect(await within(sessionSelect).findByRole('option', { name: '21:00 Cổ điển (Classic)' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(`/api/sessions?date=${today}`, expect.anything());
});

test('submitting posts the report, shows the success message and resets value and note', async () => {
  let posted: unknown = null;
  stubFetch({
    ...baseRoutes,
    'POST /api/reports': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, report({ id: 4, status: 'pending', value: 5, note: 'Ghi chú' }));
    },
  });
  renderPage();
  await pickRole('kiem', /Kiếm sĩ/);

  const value = screen.getByRole('spinbutton', { name: 'Số mạng chém' });
  fireEvent.change(value, { target: { value: '5' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Buổi chơi (không bắt buộc)' }), { target: { value: '7' } });
  const note = screen.getByRole('textbox', { name: 'Ghi chú' });
  fireEvent.change(note, { target: { value: 'Ghi chú' } });
  expect(screen.getByText('7/300')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));

  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(posted).toEqual({ roleId: 61, value: 5, playedOn: today, sessionId: 7, note: 'Ghi chú' });
  expect(value).toHaveValue(null);
  expect(note).toHaveValue('');
  // Lần khai mới xuất hiện đầu danh sách.
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('5 mạng chém');
  expect(items[0]).toHaveTextContent('Chờ duyệt');
});

test('a server error is shown next to the form', async () => {
  stubFetch({
    ...baseRoutes,
    'POST /api/reports': () => json(400, { error: { code: 'PLAYED_ON_OUT_OF_WINDOW', message: 'Chỉ khai được trận trong 3 ngày gần nhất' } }),
  });
  renderPage();
  await pickRole('kiem', /Kiếm sĩ/);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Chỉ khai được trận trong 3 ngày gần nhất');
  expect(screen.queryByText('Đã gửi, chờ mod duyệt')).not.toBeInTheDocument();
});

test('submitting without a role or value is refused locally', async () => {
  const fetchMock = stubFetch(baseRoutes);
  renderPage();
  await screen.findByRole('combobox', { name: 'Role' });

  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Hãy chọn role');

  await pickRole('ngong', /Ngỗng/);
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Hãy nhập Số lần vote trúng Vịt');
  expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
});

test('my reports show status chips with the reject reason, and pending ones can be edited', async () => {
  let patched: unknown = null;
  stubFetch({
    ...baseRoutes,
    'PATCH /api/reports/3': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, report({ id: 3, status: 'pending', value: 7, note: 'Sửa lại' }));
    },
  });
  renderPage();

  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent('Chờ duyệt');
  expect(items[0]).toHaveTextContent('Trận cuối');
  expect(items[1]).toHaveTextContent('Đã duyệt');
  expect(items[2]).toHaveTextContent('Bị từ chối');
  expect(items[2]).toHaveTextContent('Quá giới hạn của role');
  // Chỉ lần khai còn chờ có nút Sửa.
  expect(within(items[0] as HTMLElement).getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
  expect(within(items[1] as HTMLElement).queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument();
  expect(within(items[2] as HTMLElement).queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument();

  fireEvent.click(within(items[0] as HTMLElement).getByRole('button', { name: 'Sửa' }));
  const editor = items[0] as HTMLElement;
  const editValue = within(editor).getByRole('spinbutton', { name: 'Số mạng chém' });
  // Form sửa cũng giới hạn theo role (DTO nay có `maxPerGame`); role không có chỉ số phụ thì không có ô thứ hai.
  expect(editValue).toHaveAttribute('min', '0');
  expect(editValue).toHaveAttribute('max', '15');
  expect(within(editor).getByText('Tối đa 15 mỗi trận')).toBeInTheDocument();
  expect(within(editor).getAllByRole('spinbutton')).toHaveLength(1);
  fireEvent.change(editValue, { target: { value: '7' } });
  fireEvent.change(within(editor).getByRole('textbox', { name: 'Ghi chú' }), { target: { value: 'Sửa lại' } });
  fireEvent.click(within(editor).getByRole('button', { name: 'Lưu' }));

  await waitFor(() => expect(patched).toEqual({ value: 7, playedOn: today, note: 'Sửa lại' }));
  expect(await within(editor).findByText('7 mạng chém')).toBeInTheDocument();
  expect(editor).toHaveTextContent('Sửa lại');
  expect(within(editor).queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Chỉ số phụ
// ---------------------------------------------------------------------------

test('an extra-metric role adds a second input (label, hint, default 0) that is sent as extraValue and capped before sending', async () => {
  let posted: unknown = null;
  stubFetch({
    ...baseRoutes,
    'POST /api/reports': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, report({ id: 4, status: 'pending', role: ASSASSIN_REPORT_ROLE, value: 4, extraValue: 2, points: 10 }));
    },
  });
  renderPage();
  const search = await screen.findByRole('combobox', { name: 'Role' });
  // Chưa chọn role: chỉ một ô số.
  expect(screen.getAllByRole('spinbutton')).toHaveLength(1);

  await pickRole('am sat', /Ám sát/);
  const value = screen.getByRole('spinbutton', { name: 'Số mạng đã giết' });
  expect(value).toHaveAttribute('max', '15');
  expect(screen.getByText('Tối đa 15 mỗi trận')).toBeInTheDocument();
  const extra = screen.getByRole('spinbutton', { name: EXTRA_LABEL });
  expect(extra).toHaveValue(0);
  expect(extra).toHaveAttribute('min', '0');
  expect(extra).toHaveAttribute('max', '2');
  expect(screen.getByText(EXTRA_HINT)).toBeInTheDocument();

  // Vượt tối đa: chặn tại chỗ, không gửi gì.
  fireEvent.change(value, { target: { value: '4' } });
  fireEvent.change(extra, { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(EXTRA_OUT_OF_RANGE);
  expect(posted).toBeNull();

  fireEvent.change(extra, { target: { value: '2' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(posted).toEqual({ roleId: 50, value: 4, extraValue: 2, playedOn: today });
  // Lần khai mới đọc "x + y"; form về mặc định (ô chính trống, ô phụ 0).
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('4 mạng đã giết + 2 lần ám sát trong cuộc họp');
  expect(value).toHaveValue(null);
  expect(extra).toHaveValue(0);

  // Đổi sang role không có chỉ số phụ: ô thứ hai biến mất.
  fireEvent.change(search, { target: { value: 'kiem' } });
  fireEvent.click(await screen.findByRole('option', { name: /Kiếm sĩ/ }));
  expect(screen.queryByRole('spinbutton', { name: EXTRA_LABEL })).not.toBeInTheDocument();
  expect(screen.queryByText(EXTRA_HINT)).not.toBeInTheDocument();
  expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
});

test('a blank extra input counts as 0; a role without an extra metric never sends extraValue', async () => {
  const bodies: unknown[] = [];
  stubFetch({
    ...baseRoutes,
    'POST /api/reports': (init) => {
      const body = JSON.parse(String(init?.body)) as { roleId: number };
      bodies.push(body);
      return json(201, body.roleId === 50 ? report({ id: 4, status: 'pending', role: ASSASSIN_REPORT_ROLE, value: 4, points: 4 }) : report({ id: 5, status: 'pending', value: 5 }));
    },
  });
  renderPage();
  await pickRole('am sat', /Ám sát/);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số mạng đã giết' }), { target: { value: '4' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: EXTRA_LABEL }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(bodies[0]).toEqual({ roleId: 50, value: 4, extraValue: 0, playedOn: today });

  fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'kiem' } });
  fireEvent.click(await screen.findByRole('option', { name: /Kiếm sĩ/ }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual({ roleId: 61, value: 5, playedOn: today });
});

test('my reports read "x + y" for an extra-metric role, and its edit form has both inputs capped by the role', async () => {
  let patched: unknown = null;
  const assassinReport = report({ id: 8, status: 'pending', role: ASSASSIN_REPORT_ROLE, value: 4, extraValue: 2, points: 10 });
  stubFetch({
    ...baseRoutes,
    'GET /api/reports/mine': () => json(200, [assassinReport, ...mine]),
    'PATCH /api/reports/8': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...assassinReport, value: 5, extraValue: 1, points: 8 });
    },
  });
  renderPage();

  const items = await screen.findAllByRole('listitem');
  const item = items[0] as HTMLElement;
  expect(item).toHaveTextContent('🗡️ Ám sát');
  expect(item).toHaveTextContent('4 mạng đã giết + 2 lần ám sát trong cuộc họp');
  // Role không có chỉ số phụ đọc như cũ.
  expect(items[1]).toHaveTextContent('4 mạng chém');
  expect(items[1]).not.toHaveTextContent('+');

  fireEvent.click(within(item).getByRole('button', { name: 'Sửa' }));
  const value = within(item).getByRole('spinbutton', { name: 'Số mạng đã giết' });
  expect(value).toHaveValue(4);
  expect(value).toHaveAttribute('max', '15');
  const extra = within(item).getByRole('spinbutton', { name: EXTRA_LABEL });
  expect(extra).toHaveValue(2);
  expect(extra).toHaveAttribute('min', '0');
  expect(extra).toHaveAttribute('max', '2');
  expect(within(item).getByText(EXTRA_HINT)).toBeInTheDocument();

  // Vượt tối đa: chặn tại chỗ.
  fireEvent.change(extra, { target: { value: '3' } });
  fireEvent.click(within(item).getByRole('button', { name: 'Lưu' }));
  expect(await within(item).findByRole('alert')).toHaveTextContent(EXTRA_OUT_OF_RANGE);
  expect(patched).toBeNull();

  fireEvent.change(value, { target: { value: '5' } });
  fireEvent.change(extra, { target: { value: '1' } });
  expect(within(item).queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(within(item).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patched).toEqual({ value: 5, extraValue: 1, playedOn: today, note: null }));
  expect(await within(item).findByText('5 mạng đã giết + 1 lần ám sát trong cuộc họp')).toBeInTheDocument();
  expect(within(item).queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

test('the highlight field is hidden when the feature is off', async () => {
  stubFetch({ ...baseRoutes, 'GET /api/reports/highlight-config': () => json(200, highlightConfig({ enabled: false, maxBytes: 0 })) });
  const queryClient = renderPage();
  const items = await screen.findAllByRole('listitem');
  await screen.findByRole('combobox', { name: 'Role' });
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));

  expect(screen.queryByLabelText(HIGHLIGHT_LABEL)).not.toBeInTheDocument();
  // Lần khai chờ duyệt vẫn sửa được nhưng không có nút thêm highlight.
  expect(within(items[0] as HTMLElement).getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /highlight/i })).not.toBeInTheDocument();
});

test('the highlight field is hidden when the config cannot be loaded, and the rest of the form still works', async () => {
  let posted: unknown = null;
  const fetchMock = stubFetch({
    ...baseRoutes,
    // Bot Discord đang rớt: không hỏi được giới hạn → coi như không có tính năng.
    'GET /api/reports/highlight-config': () => json(503, { error: { code: 'DISCORD_UNAVAILABLE', message: 'Bot Discord chưa sẵn sàng' } }),
    'POST /api/reports': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, report({ id: 4, status: 'pending', value: 5 }));
    },
  });
  const queryClient = renderPage();
  await screen.findAllByRole('listitem');
  await screen.findByRole('combobox', { name: 'Role' });
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));

  expect(screen.queryByLabelText(HIGHLIGHT_LABEL)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /highlight/i })).not.toBeInTheDocument();
  // Lỗi cấu hình không hiện ra đâu cả.
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Bot Discord chưa sẵn sàng')).not.toBeInTheDocument();

  await pickRole('kiem', /Kiếm sĩ/);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(posted).toEqual({ roleId: 61, value: 5, playedOn: today });
  expect(calls(fetchMock, 'PUT')).toHaveLength(0);
});

test('submitting with a file creates the report, then uploads the highlight', async () => {
  const order: string[] = [];
  let finishUpload!: (res: Response) => void;
  const upload = new Promise<Response>((resolve) => {
    finishUpload = resolve;
  });
  let uploadInit: RequestInit | undefined;
  const fetchMock = stubFetch({
    ...baseRoutes,
    'POST /api/reports': () => {
      order.push('POST');
      // Lần gửi thứ hai (không file) tạo lần khai id 5.
      return json(201, report({ id: order.length === 1 ? 4 : 5, status: 'pending', value: 5 }));
    },
    'PUT /api/reports/4/highlight': (init) => {
      order.push('PUT');
      uploadInit = init;
      return upload;
    },
  });
  const queryClient = renderPage();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  await pickRole('kiem', /Kiếm sĩ/);
  const value = screen.getByRole('spinbutton', { name: 'Số mạng chém' });
  fireEvent.change(value, { target: { value: '5' } });

  const input = screen.getByLabelText(HIGHLIGHT_LABEL);
  // `accept` kèm cả đuôi file để bộ chọn trên iPhone đưa ra video.
  expect(input).toHaveAttribute('accept', 'video/mp4,video/webm,video/quicktime,image/png,image/jpeg,image/gif,.mp4,.mov,.webm,.png,.jpg,.jpeg,.gif');
  expect(screen.getByText('Video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF — tối đa 10 MB')).toBeInTheDocument();
  const file = clip();
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));

  // Tạo lần khai trước, rồi mới tải file; trong lúc tải nút gửi bị khoá.
  expect(await screen.findByRole('button', { name: 'Đang tải highlight…' })).toBeDisabled();
  expect(order).toEqual(['POST', 'PUT']);
  expect(uploadInit?.body).toBe(file);
  expect(new Headers(uploadInit?.headers).get('content-type')).toBe('video/mp4');

  finishUpload(json(200, report({ id: 4, status: 'pending', value: 5, highlightUrl: HIGHLIGHT_URL })));
  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Gửi khai điểm' })).toBeEnabled();
  // Mod khai cho chính mình: hàng chờ Duyệt điểm phải thấy link mới.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: PENDING_REPORTS_KEY });
  // Lần khai mới ở đầu danh sách, đã có link xem highlight.
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('5 mạng chém');
  const link = within(items[0] as HTMLElement).getByRole('link', { name: 'Xem highlight' });
  expect(link).toHaveAttribute('href', HIGHLIGHT_URL);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  // File đã được bỏ khỏi form cùng các ô khác: gửi lần nữa chỉ tạo lần khai, không tải gì.
  expect(value).toHaveValue(null);
  fireEvent.change(value, { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(2));
  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(calls(fetchMock, 'PUT')).toHaveLength(1);
});

test('a too-large file is refused before upload with "Highlight tối đa 10 MB"', async () => {
  const fetchMock = stubFetch({
    ...baseRoutes,
    'POST /api/reports': () => json(201, report({ id: 4, status: 'pending', value: 5 })),
    'PUT /api/reports/4/highlight': () => json(200, report({ id: 4, status: 'pending', value: 5, highlightUrl: HIGHLIGHT_URL })),
  });
  renderPage();
  await pickRole('kiem', /Kiếm sĩ/);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '5' } });
  const input = screen.getByLabelText(HIGHLIGHT_LABEL);

  fireEvent.change(input, { target: { files: [clip('to.mp4', 'video/mp4', 10 * MIB + 1)] } });
  const refusal = await screen.findByRole('alert');
  expect(refusal).toHaveTextContent('Highlight tối đa 10 MB');
  // Gửi khi file đang chọn không hợp lệ: không gửi gì cả, kể cả tạo lần khai; lời báo được dựng
  // lại (nút DOM mới) để trình đọc màn hình đọc lại thay vì lặng lẽ bỏ qua cú bấm.
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  const reannounced = screen.getByRole('alert');
  expect(reannounced).toHaveTextContent('Highlight tối đa 10 MB');
  expect(reannounced).not.toBe(refusal);
  expect(calls(fetchMock, 'POST')).toHaveLength(0);

  // Đúng bằng giới hạn thì nhận.
  fireEvent.change(input, { target: { files: [clip('vua.mp4', 'video/mp4', 10 * MIB)] } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
  expect(calls(fetchMock, 'POST')).toHaveLength(1);
});

test('"Bỏ file" drops a refused file so the report can be sent without a highlight', async () => {
  let posted: unknown = null;
  const fetchMock = stubFetch({
    ...baseRoutes,
    'POST /api/reports': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, report({ id: 4, status: 'pending', value: 5 }));
    },
  });
  renderPage();
  await pickRole('kiem', /Kiếm sĩ/);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '5' } });
  const input = screen.getByLabelText(HIGHLIGHT_LABEL);
  // Chưa chọn file: không có gì để bỏ.
  expect(screen.queryByRole('button', { name: 'Bỏ file' })).not.toBeInTheDocument();

  // File hợp lệ cũng bỏ được (đổi ý không kèm highlight).
  fireEvent.change(input, { target: { files: [clip()] } });
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ file' }));
  expect(screen.queryByRole('button', { name: 'Bỏ file' })).not.toBeInTheDocument();
  // Nút vừa bấm đã biến mất: focus về ô file, không rơi về <body>.
  expect(input).toHaveFocus();

  // Safari/Firefox giữ file cũ khi huỷ bộ chọn, nên file bị từ chối cần nút Bỏ file để thoát.
  fireEvent.change(input, { target: { files: [clip('to.mp4', 'video/mp4', 10 * MIB + 1)] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Highlight tối đa 10 MB');
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ file' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Bỏ file' })).not.toBeInTheDocument();
  expect(input).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(posted).toEqual({ roleId: 61, value: 5, playedOn: today });
  expect(calls(fetchMock, 'PUT')).toHaveLength(0);
});

test('an unsupported or empty file is refused before upload; a typeless .MOV is accepted by its extension', async () => {
  const fetchMock = stubFetch(baseRoutes);
  renderPage();
  await pickRole('kiem', /Kiếm sĩ/);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '5' } });
  const input = screen.getByLabelText(HIGHLIGHT_LABEL);

  fireEvent.change(input, { target: { files: [clip('tai-lieu.pdf', 'application/pdf')] } });
  expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_HIGHLIGHT);
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(screen.getByRole('alert')).toHaveTextContent(INVALID_HIGHLIGHT);

  fireEvent.change(input, { target: { files: [clip('rong.mp4', 'video/mp4', 0)] } });
  expect(screen.getByRole('alert')).toHaveTextContent(INVALID_HIGHLIGHT);

  // Safari iPhone để trống `type` với .MOV: nhận theo đuôi file.
  fireEvent.change(input, { target: { files: [clip('IMG_0001.MOV', '')] } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(calls(fetchMock, 'POST')).toHaveLength(0);
});

test('upload failure keeps the report and says "Đã gửi khai điểm, nhưng highlight chưa tải lên được"', async () => {
  stubFetch({
    ...baseRoutes,
    'POST /api/reports': () => json(201, report({ id: 4, status: 'pending', value: 5 })),
    'PUT /api/reports/4/highlight': () =>
      json(503, { error: { code: 'DISCORD_UNAVAILABLE', message: 'Không đăng được highlight lên Discord, thử lại sau' } }),
  });
  const queryClient = renderPage();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  await pickRole('kiem', /Kiếm sĩ/);
  const value = screen.getByRole('spinbutton', { name: 'Số mạng chém' });
  fireEvent.change(value, { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(HIGHLIGHT_LABEL), { target: { files: [clip()] } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Đã gửi khai điểm, nhưng highlight chưa tải lên được: Không đăng được highlight lên Discord, thử lại sau',
  );
  expect(screen.queryByText('Đã gửi, chờ mod duyệt')).not.toBeInTheDocument();
  // Không có highlight nào lên được thì hàng chờ duyệt không cần tải lại.
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: PENDING_REPORTS_KEY });
  // Lần khai vẫn được tạo, vào đầu danh sách với nút thêm highlight sau; form đã được dọn như khi gửi xong.
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('5 mạng chém');
  expect(within(items[0] as HTMLElement).getByRole('button', { name: 'Thêm highlight' })).toBeInTheDocument();
  expect(within(items[0] as HTMLElement).queryByRole('link', { name: 'Xem highlight' })).not.toBeInTheDocument();
  expect(value).toHaveValue(null);
});

test('my reports show "Xem highlight" links and an add/replace button on pending ones', async () => {
  const list: ReportDto[] = [
    report({ id: 5, status: 'pending', value: 3, highlightUrl: HIGHLIGHT_URL }),
    report({ id: 3, status: 'pending', value: 4 }),
    report({ id: 2, status: 'approved', value: 6, highlightUrl: 'https://discord.com/channels/1/2/4' }),
    report({ id: 1, status: 'rejected', value: 30, rejectReason: 'Quá giới hạn của role' }),
  ];
  let uploadInit: RequestInit | undefined;
  stubFetch({
    ...baseRoutes,
    'GET /api/reports/mine': () => json(200, list),
    'PUT /api/reports/3/highlight': (init) => {
      uploadInit = init;
      return json(200, report({ id: 3, status: 'pending', value: 4, highlightUrl: 'https://discord.com/channels/1/2/5' }));
    },
  });
  const queryClient = renderPage();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const items = (await screen.findAllByRole('listitem')) as HTMLElement[];
  expect(items).toHaveLength(4);
  const [withHighlight, pending, approved, rejected] = items as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

  expect(within(withHighlight).getByRole('link', { name: 'Xem highlight' })).toHaveAttribute('href', HIGHLIGHT_URL);
  expect(within(withHighlight).getByRole('button', { name: 'Đổi highlight' })).toBeInTheDocument();
  expect(within(pending).queryByRole('link', { name: 'Xem highlight' })).not.toBeInTheDocument();
  expect(within(pending).getByRole('button', { name: 'Thêm highlight' })).toBeInTheDocument();
  expect(within(pending).getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
  const approvedLink = within(approved).getByRole('link', { name: 'Xem highlight' });
  expect(approvedLink).toHaveAttribute('href', 'https://discord.com/channels/1/2/4');
  expect(approvedLink).toHaveAttribute('target', '_blank');
  expect(approvedLink).toHaveAttribute('rel', 'noopener noreferrer');
  // Đã duyệt / bị từ chối: không thêm hay đổi được nữa.
  expect(within(approved).queryByRole('button', { name: /highlight/i })).not.toBeInTheDocument();
  expect(within(rejected).queryByRole('link', { name: 'Xem highlight' })).not.toBeInTheDocument();
  expect(within(rejected).queryByRole('button', { name: /highlight/i })).not.toBeInTheDocument();

  // "Thêm highlight" mở bộ chọn file ẩn; chọn file là tải lên ngay (loại đoán theo đuôi khi `type` trống).
  const picker = pickerOf(pending);
  expect(picker).toHaveAttribute('accept', expect.stringContaining('video/quicktime'));
  const openPicker = vi.spyOn(picker, 'click');
  fireEvent.click(within(pending).getByRole('button', { name: 'Thêm highlight' }));
  expect(openPicker).toHaveBeenCalledTimes(1);
  const file = clip('IMG_0001.MOV', '');
  fireEvent.change(picker, { target: { files: [file] } });

  expect(await within(pending).findByRole('link', { name: 'Xem highlight' })).toHaveAttribute('href', 'https://discord.com/channels/1/2/5');
  expect(uploadInit?.body).toBe(file);
  expect(new Headers(uploadInit?.headers).get('content-type')).toBe('video/quicktime');
  expect(within(pending).getByRole('button', { name: 'Đổi highlight' })).toBeInTheDocument();
  expect(within(pending).queryByRole('alert')).not.toBeInTheDocument();
  // Mod thêm highlight cho lần khai của chính mình: hàng chờ Duyệt điểm phải thấy link mới.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: PENDING_REPORTS_KEY });
});

test('a highlight refused from the list shows the message next to that report; a server error refetches the list', async () => {
  let listCalls = 0;
  const fetchMock = stubFetch({
    ...baseRoutes,
    'GET /api/reports/mine': () => {
      listCalls += 1;
      return json(200, mine);
    },
    'PUT /api/reports/3/highlight': () => json(409, { error: { code: 'NOT_PENDING', message: 'Lần khai không còn chờ duyệt' } }),
  });
  renderPage();
  const pending = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
  const picker = pickerOf(pending);

  fireEvent.change(picker, { target: { files: [clip('to.mp4', 'video/mp4', 10 * MIB + 1)] } });
  expect(await within(pending).findByRole('alert')).toHaveTextContent('Highlight tối đa 10 MB');
  fireEvent.change(picker, { target: { files: [clip('tai-lieu.pdf', 'application/pdf')] } });
  expect(within(pending).getByRole('alert')).toHaveTextContent(INVALID_HIGHLIGHT);
  expect(calls(fetchMock, 'PUT')).toHaveLength(0);

  // Server từ chối: hiện nguyên văn và tải lại danh sách (lần khai có thể vừa được duyệt).
  fireEvent.change(picker, { target: { files: [clip()] } });
  expect(await within(pending).findByRole('alert')).toHaveTextContent('Lần khai không còn chờ duyệt');
  await waitFor(() => expect(listCalls).toBe(2));
  expect(within(pending).getByRole('button', { name: 'Thêm highlight' })).toBeEnabled();
});
