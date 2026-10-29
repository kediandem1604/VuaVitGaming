import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { AccusationDto, BountyClaimDto, HighlightConfigDto, MeDto, MemberOptionDto, ReportDto, RoleDto, SessionDto } from '../../src/shared/api-types';
import { vnTodayIso } from '../../src/web/lib/format';
import { PENDING_REPORTS_KEY } from '../../src/web/lib/queryKeys';
import { ReportPage } from '../../src/web/pages/ReportPage';

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
  // Role có chỉ số phạt và điểm mỗi lần ≠ 1 (như Cảnh sát trưởng trong seed).
  role({ id: 20, key: 'sheriff', faction: 'goose', nameVi: 'Cảnh sát trưởng', nameEn: 'Sheriff', icon: '⭐', metricLabel: 'Số phát bắn trúng kẻ xấu', maxPerGame: 10, points: 3, penaltyMetricLabel: 'Số phát bắn sai', penaltyMaxPerGame: 10, penaltyPoints: 1 }),
];

const EXTRA_LABEL = 'Số lần ám sát trong cuộc họp';
const PENALTY_LABEL = 'Số phát bắn sai';
const PENALTY_HINT = 'Tối đa 10 mỗi trận · −1 điểm mỗi lần';
const PENALTY_OUT_OF_RANGE = 'Chỉ số phạt phải từ 0 đến 10';

/** Cảnh sát trưởng (seed): ×3 (tối đa 10), phạt "Số phát bắn sai" tối đa 10, −1 mỗi phát; không có chỉ số phụ. */
const SHERIFF_REPORT_ROLE: ReportDto['role'] = {
  id: 20,
  nameVi: 'Cảnh sát trưởng',
  icon: '⭐',
  metricLabel: 'Số phát bắn trúng kẻ xấu',
  maxPerGame: 10,
  points: 3,
  extraMetricLabel: null,
  extraMaxPerGame: null,
  extraPoints: null,
  penaltyMetricLabel: PENALTY_LABEL,
  penaltyMaxPerGame: 10,
  penaltyPoints: 1,
};
const EXTRA_HINT = 'Tối đa 2 mỗi trận · +3 điểm mỗi lần';
const EXTRA_OUT_OF_RANGE = 'Chỉ số phụ phải từ 0 đến 2';

/** Phần role kèm trong lần khai của Ám sát (như `ReportDto.role` server trả). */
const ASSASSIN_REPORT_ROLE: ReportDto['role'] = {
  id: 50,
  nameVi: 'Ám sát',
  icon: '🗡️',
  metricLabel: 'Số mạng đã giết',
  maxPerGame: 15,
  points: 1,
  extraMetricLabel: EXTRA_LABEL,
  extraMaxPerGame: 2,
  extraPoints: 3,
  penaltyMetricLabel: null,
  penaltyMaxPerGame: null,
  penaltyPoints: null,
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
  role: {
    id: 61,
    nameVi: 'Kiếm sĩ',
    icon: '⚔️',
    metricLabel: 'Số mạng chém',
    maxPerGame: 15,
    points: 1,
    extraMetricLabel: null,
    extraMaxPerGame: null,
    extraPoints: null,
    penaltyMetricLabel: null,
    penaltyMaxPerGame: null,
    penaltyPoints: null,
  },
  value: 4,
  extraValue: 0,
  penaltyValue: 0,
  bonusPoints: 0,
  source: 'self',
  points: over.value ?? 4,
  playedOn: today,
  sessionId: null,
  note: null,
  rejectReason: null,
  createdAt: '2026-10-22T13:00:00.000Z',
  highlightUrl: null,
  accusation: null,
  accusationDuplicate: false,
  penaltyOf: null,
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
    // "Treo thưởng của tôi": test không tả gì thì chưa nhận mục nào.
    const handler = routes[key] ?? (key === MY_BOUNTIES_ROUTE ? () => json(200, []) : undefined);
    if (!handler) throw new Error(`Không có tuyến giả cho ${key}`);
    return Promise.resolve(handler(init, url));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const MY_BOUNTIES_ROUTE = 'GET /api/bounty-claims/mine';

/** Người đang đăng nhập (id 9) và danh sách chọn người cho ô báo cáo (có cả tôi — web tự loại). */
const me: MeDto = { id: 9, memberCode: 'GGD-0009', displayName: 'Tôi', avatarUrl: null, email: null, notifyEmail: true, notifyDm: true, accessLevel: 'member' };
const memberOptions: MemberOptionDto[] = [
  { id: 9, displayName: 'Tôi', avatarUrl: null },
  { id: 10, displayName: 'Vịt Mười', avatarUrl: null },
  { id: 11, displayName: 'Ngỗng Mười Một', avatarUrl: null },
];

/** Báo cáo kèm lần khai: Vịt Mười chơi Cảnh sát trưởng bắn Ngỗng Mười Một phe Ngỗng. */
const accusation = (over: Partial<AccusationDto> = {}): AccusationDto => ({
  id: 1,
  status: 'pending',
  accused: { id: 10, displayName: 'Vịt Mười' },
  accusedRole: { id: 20, nameVi: 'Cảnh sát trưởng', icon: '⭐', penaltyPoints: 1 },
  victim: { id: 11, displayName: 'Ngỗng Mười Một' },
  victimFaction: 'goose',
  rejectReason: null,
  ...over,
});
const ACCUSATION_LINE = 'Báo cáo: Vịt Mười (Cảnh sát trưởng) bắn Ngỗng Mười Một — phe Ngỗng';
const ACCUSATION_CHECKBOX = 'Báo cáo người chơi';
const ACCUSATION_INCOMPLETE = 'Báo cáo cần đủ người bị báo cáo, role, người bị bắn và phe';

const baseRoutes: Record<string, Handler> = {
  'GET /api/roles': () => json(200, roles),
  'GET /api/reports/mine': () => json(200, mine),
  'GET /api/reports/highlight-config': () => json(200, highlightConfig()),
  'GET /api/sessions': () => json(200, [session]),
  'GET /api/me': () => json(200, me),
  'GET /api/members/options': () => json(200, memberOptions),
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

/** Mở một ô chọn `Select` (theo nhãn) rồi bấm một dòng. */
async function pickOption(scope: typeof screen | ReturnType<typeof within>, label: string, option: string) {
  fireEvent.click(await scope.findByRole('combobox', { name: label }));
  fireEvent.click(scope.getByRole('option', { name: option }));
}

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

  // "o" khớp bốn role (goose, swordsman, dodo, "Cảnh sát trưởng") nên thấy đủ ba phe.
  fireEvent.change(await screen.findByRole('combobox', { name: 'Role' }), { target: { value: 'o' } });
  const listbox = await screen.findByRole('listbox', { name: 'Kết quả tìm role' });
  const options = within(listbox).getAllByRole('option');
  expect(options).toHaveLength(4);
  const expected: Array<[string, string]> = [
    ['Ngỗng', 'Phe Ngỗng'],
    ['Kiếm sĩ', 'Phe Vịt'],
    ['Chim đa đa', 'Phe thứ 3'],
    ['Cảnh sát trưởng', 'Phe Ngỗng'],
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
  // Danh sách gợi ý còn trong DOM một nhịp mờ ra (ẩn với trình đọc màn hình) rồi mới gỡ (spec §5.2).
  await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
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

test('a revoked report shows the "Bị huỷ duyệt" chip with its reason and cannot be edited', async () => {
  stubFetch({
    ...baseRoutes,
    'GET /api/reports/mine': () => json(200, [report({ id: 4, status: 'revoked', value: 6, rejectReason: 'Clip không khớp' })]),
  });
  renderPage();

  const [item] = (await screen.findAllByRole('listitem')) as [HTMLElement];
  expect(within(item).getByText('Bị huỷ duyệt')).toHaveClass('chip', 'bg-duck-soft', 'text-night-950');
  // Lý do hiện như lần khai bị từ chối.
  expect(within(item).getByText('Lý do: Clip không khớp')).toBeInTheDocument();
  expect(within(item).queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument();
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
// Chỉ số phạt (spec điểm role §5)
// ---------------------------------------------------------------------------

test('a penalty role adds a third input (label, hint, default 0) sent as penaltyValue, and the main hint names the points per unit', async () => {
  let posted: unknown = null;
  stubFetch({
    ...baseRoutes,
    'POST /api/reports': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, report({ id: 4, status: 'pending', role: SHERIFF_REPORT_ROLE, value: 4, penaltyValue: 1, points: 11 }));
    },
  });
  renderPage();
  const search = await screen.findByRole('combobox', { name: 'Role' });

  await pickRole('canh sat', /Cảnh sát trưởng/);
  const value = screen.getByRole('spinbutton', { name: 'Số phát bắn trúng kẻ xấu' });
  expect(value).toHaveAttribute('max', '10');
  // points = 3 ≠ 1 → gợi ý nêu điểm mỗi lần.
  expect(screen.getByText('Tối đa 10 mỗi trận · +3 điểm mỗi lần')).toBeInTheDocument();
  // Không có chỉ số phụ → không có ô phụ; có chỉ số phạt → ô thứ ba.
  expect(screen.queryByRole('spinbutton', { name: EXTRA_LABEL })).not.toBeInTheDocument();
  const penalty = screen.getByRole('spinbutton', { name: PENALTY_LABEL });
  expect(penalty).toHaveValue(0);
  expect(penalty).toHaveAttribute('min', '0');
  expect(penalty).toHaveAttribute('max', '10');
  expect(screen.getByText(PENALTY_HINT)).toBeInTheDocument();
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2);

  // Vượt tối đa: chặn tại chỗ, không gửi gì.
  fireEvent.change(value, { target: { value: '4' } });
  fireEvent.change(penalty, { target: { value: '11' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(PENALTY_OUT_OF_RANGE);
  expect(posted).toBeNull();

  fireEvent.change(penalty, { target: { value: '1' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(posted).toEqual({ roleId: 20, value: 4, penaltyValue: 1, playedOn: today });
  // Lần khai mới đọc "x − z"; form về mặc định (ô chính trống, ô phạt 0).
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('4 phát bắn trúng kẻ xấu − 1 phát bắn sai');
  expect(value).toHaveValue(null);
  expect(penalty).toHaveValue(0);

  // Đổi sang role không có chỉ số phạt và points = 1: ô thứ ba và phần "+N điểm" biến mất.
  fireEvent.change(search, { target: { value: 'kiem' } });
  fireEvent.click(await screen.findByRole('option', { name: /Kiếm sĩ/ }));
  expect(screen.queryByRole('spinbutton', { name: PENALTY_LABEL })).not.toBeInTheDocument();
  expect(screen.queryByText(PENALTY_HINT)).not.toBeInTheDocument();
  expect(screen.getByText('Tối đa 15 mỗi trận')).toBeInTheDocument();
  expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
});

test('a blank penalty input counts as 0; a role without a penalty metric never sends penaltyValue', async () => {
  const bodies: unknown[] = [];
  stubFetch({
    ...baseRoutes,
    'POST /api/reports': (init) => {
      const body = JSON.parse(String(init?.body)) as { roleId: number };
      bodies.push(body);
      return json(201, body.roleId === 20 ? report({ id: 4, status: 'pending', role: SHERIFF_REPORT_ROLE, value: 4, points: 12 }) : report({ id: 5, status: 'pending', value: 5 }));
    },
  });
  renderPage();
  await pickRole('canh sat', /Cảnh sát trưởng/);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số phát bắn trúng kẻ xấu' }), { target: { value: '4' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: PENALTY_LABEL }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(bodies[0]).toEqual({ roleId: 20, value: 4, penaltyValue: 0, playedOn: today });

  fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'kiem' } });
  fireEvent.click(await screen.findByRole('option', { name: /Kiếm sĩ/ }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual({ roleId: 61, value: 5, playedOn: today });
});

test('my reports read "x − z" for a penalty role, and its edit form has the penalty input capped by the role', async () => {
  let patched: unknown = null;
  const sheriffReport = report({ id: 8, status: 'pending', role: SHERIFF_REPORT_ROLE, value: 4, penaltyValue: 2, points: 10 });
  stubFetch({
    ...baseRoutes,
    'GET /api/reports/mine': () => json(200, [sheriffReport, report({ id: 7, status: 'approved', role: SHERIFF_REPORT_ROLE, value: 3, penaltyValue: 0, points: 9 }), ...mine]),
    'PATCH /api/reports/8': (init) => {
      patched = JSON.parse(String(init?.body));
      return json(200, { ...sheriffReport, value: 5, penaltyValue: 1, points: 14 });
    },
  });
  renderPage();

  const items = await screen.findAllByRole('listitem');
  const item = items[0] as HTMLElement;
  expect(item).toHaveTextContent('⭐ Cảnh sát trưởng');
  expect(item).toHaveTextContent('4 phát bắn trúng kẻ xấu − 2 phát bắn sai');
  // penaltyValue 0 không nêu phần phạt.
  expect(items[1]).toHaveTextContent('3 phát bắn trúng kẻ xấu');
  expect(items[1]).not.toHaveTextContent('−');

  fireEvent.click(within(item).getByRole('button', { name: 'Sửa' }));
  const value = within(item).getByRole('spinbutton', { name: 'Số phát bắn trúng kẻ xấu' });
  expect(value).toHaveValue(4);
  expect(within(item).getByText('Tối đa 10 mỗi trận · +3 điểm mỗi lần')).toBeInTheDocument();
  expect(within(item).queryByRole('spinbutton', { name: EXTRA_LABEL })).not.toBeInTheDocument();
  const penalty = within(item).getByRole('spinbutton', { name: PENALTY_LABEL });
  expect(penalty).toHaveValue(2);
  expect(penalty).toHaveAttribute('min', '0');
  expect(penalty).toHaveAttribute('max', '10');
  expect(within(item).getByText(PENALTY_HINT)).toBeInTheDocument();

  // Vượt tối đa: chặn tại chỗ.
  fireEvent.change(penalty, { target: { value: '11' } });
  fireEvent.click(within(item).getByRole('button', { name: 'Lưu' }));
  expect(await within(item).findByRole('alert')).toHaveTextContent(PENALTY_OUT_OF_RANGE);
  expect(patched).toBeNull();

  fireEvent.change(value, { target: { value: '5' } });
  fireEvent.change(penalty, { target: { value: '1' } });
  expect(within(item).queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(within(item).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(patched).toEqual({ value: 5, penaltyValue: 1, playedOn: today, note: null }));
  expect(await within(item).findByText('5 phát bắn trúng kẻ xấu − 1 phát bắn sai')).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// Báo cáo người chơi (spec điểm role §6)
// ---------------------------------------------------------------------------

test('ticking "Báo cáo người chơi" adds four pickers; a complete accusation is posted with the report and the box resets', async () => {
  let posted: unknown = null;
  stubFetch({
    ...baseRoutes,
    'POST /api/reports': (init) => {
      posted = JSON.parse(String(init?.body));
      return json(201, report({ id: 4, status: 'pending', value: 5, accusation: accusation() }));
    },
  });
  renderPage();
  await pickRole('kiem', /Kiếm sĩ/);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '5' } });
  // Chưa tick: không có ô chọn nào của báo cáo (ô buổi chơi là <select> gốc).
  expect(screen.queryByRole('combobox', { name: 'Người bị báo cáo' })).not.toBeInTheDocument();

  const checkbox = screen.getByRole('checkbox', { name: ACCUSATION_CHECKBOX });
  fireEvent.click(checkbox);
  await pickOption(screen, 'Người bị báo cáo', 'Vịt Mười');
  await pickOption(screen, 'Role của họ', '⭐ Cảnh sát trưởng');
  await pickOption(screen, 'Họ bắn trúng ai', 'Ngỗng Mười Một');
  await pickOption(screen, 'Phe của người bị bắn', 'Ngỗng');
  expect(screen.getByText('Báo cáo đúng: bạn +1 điểm, người bị báo cáo bị trừ điểm phạt của role đó.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));

  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(posted).toEqual({ roleId: 61, value: 5, playedOn: today, accusation: { accusedId: 10, accusedRoleId: 20, victimId: 11, victimFaction: 'goose' } });
  // Form về mặc định: ô tick bỏ, ô chọn ẩn.
  expect(checkbox).not.toBeChecked();
  expect(screen.queryByRole('combobox', { name: 'Người bị báo cáo' })).not.toBeInTheDocument();
  // Lần khai mới ghi khung báo cáo và trạng thái của nó.
  const first = screen.getAllByRole('listitem')[0] as HTMLElement;
  expect(first).toHaveTextContent(ACCUSATION_LINE);
  expect(first).toHaveTextContent('Báo cáo đang chờ duyệt');
});

test('an incomplete accusation is refused locally; unticking sends the report without any accusation', async () => {
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
  fireEvent.click(screen.getByRole('checkbox', { name: ACCUSATION_CHECKBOX }));
  await pickOption(screen, 'Người bị báo cáo', 'Vịt Mười');
  await pickOption(screen, 'Role của họ', '⭐ Cảnh sát trưởng');

  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(ACCUSATION_INCOMPLETE);
  expect(calls(fetchMock, 'POST')).toHaveLength(0);

  // Bỏ tick: lời báo biến mất, gửi không kèm `accusation` dù hai ô đã chọn.
  fireEvent.click(screen.getByRole('checkbox', { name: ACCUSATION_CHECKBOX }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khai điểm' }));
  expect(await screen.findByText('Đã gửi, chờ mod duyệt')).toBeInTheDocument();
  expect(posted).toEqual({ roleId: 61, value: 5, playedOn: today });
});

test('my reports show the accusation box with its status, the duplicate note, and the "Bị trừ điểm" penalty row', async () => {
  const list: ReportDto[] = [
    report({ id: 14, status: 'pending', accusation: accusation(), accusationDuplicate: true }),
    report({ id: 13, status: 'approved', value: 5, bonusPoints: 1, points: 6, accusation: accusation({ status: 'approved' }) }),
    report({ id: 12, status: 'approved', accusation: accusation({ status: 'rejected', rejectReason: 'Không phải Cảnh sát trưởng' }) }),
    report({ id: 11, status: 'pending', accusation: accusation({ status: 'superseded', rejectReason: 'Đã có người báo cáo trước' }) }),
    // Mục trừ điểm của tôi: tôi (Dân phòng) bị báo cáo bắn Vịt Mười phe thứ 3.
    report({
      id: 10,
      status: 'approved',
      source: 'accusation',
      role: { ...SHERIFF_REPORT_ROLE, id: 21, nameVi: 'Dân phòng', icon: '🔫', penaltyPoints: 3 },
      value: 0,
      penaltyValue: 1,
      points: -3,
      note: 'Bị báo cáo: bắn Vịt Mười (phe thứ 3)',
      penaltyOf: accusation({
        id: 2,
        status: 'approved',
        accused: { id: 9, displayName: 'Tôi' },
        accusedRole: { id: 21, nameVi: 'Dân phòng', icon: '🔫', penaltyPoints: 3 },
        victim: { id: 10, displayName: 'Vịt Mười' },
        victimFaction: 'neutral',
      }),
    }),
  ];
  stubFetch({ ...baseRoutes, 'GET /api/reports/mine': () => json(200, list) });
  renderPage();

  const items = (await screen.findAllByRole('listitem')) as HTMLElement[];
  expect(items).toHaveLength(5);
  const [duplicate, approved, rejected, superseded, penalty] = items as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];

  expect(duplicate).toHaveTextContent(ACCUSATION_LINE);
  expect(duplicate).toHaveTextContent('Báo cáo đang chờ duyệt');
  expect(duplicate).toHaveTextContent('Báo cáo của bạn trùng với một báo cáo khác đang chờ');
  expect(approved).toHaveTextContent('Báo cáo đúng · bạn +1 điểm');
  expect(approved).not.toHaveTextContent('trùng');
  expect(rejected).toHaveTextContent('Báo cáo bị bác: Không phải Cảnh sát trưởng');
  expect(superseded).toHaveTextContent('Đã có người báo cáo trước');
  expect(superseded).not.toHaveTextContent('đang chờ duyệt');

  expect(within(penalty).getByText('Bị trừ điểm')).toHaveClass('chip');
  expect(penalty).toHaveTextContent('🔫 Dân phòng');
  expect(penalty).toHaveTextContent('Bị báo cáo: bắn Vịt Mười (Phe thứ 3) − 3 điểm');
  // Không đọc "0 phát bắn trúng kẻ xấu − 1 phát bắn sai", không lặp ghi chú của server, không sửa được.
  expect(penalty).not.toHaveTextContent('phát bắn');
  expect(within(penalty).getAllByText(/Bị báo cáo/)).toHaveLength(1);
  expect(within(penalty).queryByRole('button')).not.toBeInTheDocument();
  // Lần khai thường không có chip đó.
  expect(within(approved).queryByText('Bị trừ điểm')).not.toBeInTheDocument();
});

test('editing a pending report with an accusation prefills the box; unticking patches accusation: null, a new one patches its fields', async () => {
  const bodies: unknown[] = [];
  const withAccusation = report({ id: 3, status: 'pending', accusation: accusation() });
  stubFetch({
    ...baseRoutes,
    'GET /api/reports/mine': () => json(200, [withAccusation, report({ id: 2, status: 'pending', value: 6 })]),
    'PATCH /api/reports/3': (init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json(200, { ...withAccusation, accusation: null });
    },
    'PATCH /api/reports/2': (init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json(200, report({ id: 2, status: 'pending', value: 6, accusation: accusation({ victim: { id: 9, displayName: 'Tôi' }, victimFaction: 'duck' }) }));
    },
  });
  renderPage();
  const [first, second] = (await screen.findAllByRole('listitem')) as [HTMLElement, HTMLElement];

  fireEvent.click(within(first).getByRole('button', { name: 'Sửa' }));
  const checkbox = within(first).getByRole('checkbox', { name: ACCUSATION_CHECKBOX });
  expect(checkbox).toBeChecked();
  expect(await within(first).findByRole('combobox', { name: 'Người bị báo cáo' })).toHaveTextContent('Vịt Mười');
  expect(within(first).getByRole('combobox', { name: 'Role của họ' })).toHaveTextContent('⭐ Cảnh sát trưởng');
  expect(within(first).getByRole('combobox', { name: 'Họ bắn trúng ai' })).toHaveTextContent('Ngỗng Mười Một');
  expect(within(first).getByRole('combobox', { name: 'Phe của người bị bắn' })).toHaveTextContent('Ngỗng');
  fireEvent.click(checkbox);
  fireEvent.click(within(first).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(bodies).toEqual([{ value: 4, playedOn: today, note: null, accusation: null }]));
  expect(await within(first).findByText('4 mạng chém')).toBeInTheDocument();
  expect(first).not.toHaveTextContent('Báo cáo:');

  // Lần khai chưa có báo cáo: tick và chọn đủ bốn → gửi báo cáo mới (người bị bắn có thể là tôi).
  fireEvent.click(within(second).getByRole('button', { name: 'Sửa' }));
  expect(within(second).getByRole('checkbox', { name: ACCUSATION_CHECKBOX })).not.toBeChecked();
  fireEvent.click(within(second).getByRole('checkbox', { name: ACCUSATION_CHECKBOX }));
  await pickOption(within(second), 'Người bị báo cáo', 'Vịt Mười');
  await pickOption(within(second), 'Role của họ', '⭐ Cảnh sát trưởng');
  fireEvent.click(within(second).getByRole('button', { name: 'Lưu' }));
  expect(await within(second).findByRole('alert')).toHaveTextContent(ACCUSATION_INCOMPLETE);
  expect(bodies).toHaveLength(1);
  await pickOption(within(second), 'Họ bắn trúng ai', 'Tôi');
  await pickOption(within(second), 'Phe của người bị bắn', 'Vịt');
  fireEvent.click(within(second).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual({ value: 6, playedOn: today, note: null, accusation: { accusedId: 10, accusedRoleId: 20, victimId: 9, victimFaction: 'duck' } });
  expect(await within(second).findByText('Báo cáo: Vịt Mười (Cảnh sát trưởng) bắn Tôi — phe Vịt')).toBeInTheDocument();
});

test('editing a report whose accusation is unchanged omits accusation (keeps its place in the case); a changed field sends it', async () => {
  const bodies: unknown[] = [];
  const withAccusation = report({ id: 3, status: 'pending', accusation: accusation() });
  stubFetch({
    ...baseRoutes,
    'GET /api/reports/mine': () => json(200, [withAccusation]),
    'PATCH /api/reports/3': (init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json(200, withAccusation);
    },
  });
  renderPage();
  const first = (await screen.findAllByRole('listitem'))[0] as HTMLElement;

  // Chỉ sửa giá trị: báo cáo vẫn tick, không đổi → không gửi `accusation`.
  fireEvent.click(within(first).getByRole('button', { name: 'Sửa' }));
  expect(await within(first).findByRole('combobox', { name: 'Người bị báo cáo' })).toHaveTextContent('Vịt Mười');
  fireEvent.change(within(first).getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '5' } });
  fireEvent.click(within(first).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(bodies).toEqual([{ value: 5, playedOn: today, note: null }]));

  // Đổi phe người bị bắn → gửi báo cáo mới.
  fireEvent.click(await within(first).findByRole('button', { name: 'Sửa' }));
  await pickOption(within(first), 'Phe của người bị bắn', 'Vịt');
  fireEvent.click(within(first).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual({ value: 4, playedOn: today, note: null, accusation: { accusedId: 10, accusedRoleId: 20, victimId: 11, victimFaction: 'duck' } });
});

// ---------------------------------------------------------------------------
// Treo thưởng của tôi (spec treo thưởng §6)
// ---------------------------------------------------------------------------

const myClaim = (over: Partial<BountyClaimDto> & Pick<BountyClaimDto, 'id' | 'status'>): BountyClaimDto => ({
  bounty: { id: 1, title: 'Bồ Nông nuốt hết vịt', description: null },
  member: { id: 9, displayName: 'Tôi' },
  // 12:00Z = 19:00 giờ VN.
  session: { id: 7, startsAt: '2026-10-22T12:00:00.000Z', modeName: 'Cổ điển' },
  playedOn: '2026-10-22',
  role: { id: 30, nameVi: 'Bồ nông', icon: '🦩', faction: 'neutral' },
  points: 5,
  rejectReason: null,
  source: 'web',
  createdAt: '2026-10-22T15:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
  ...over,
});

test('"Treo thưởng của tôi" lists my latest claims with their status under "Lần khai của tôi"', async () => {
  const fetchMock = stubFetch({
    ...baseRoutes,
    [MY_BOUNTIES_ROUTE]: () =>
      json(200, [
        myClaim({ id: 1, status: 'pending' }),
        myClaim({ id: 2, status: 'approved', role: null, points: 3, bounty: { id: 2, title: 'Tham gia đủ', description: null } }),
        myClaim({ id: 3, status: 'rejected', rejectReason: 'Không có clip' }),
        myClaim({ id: 4, status: 'revoked', rejectReason: 'Nhầm buổi' }),
      ]),
  });
  renderPage();
  const section = await screen.findByRole('region', { name: 'Treo thưởng của tôi' });
  expect(within(section).getByRole('heading', { level: 3, name: 'Treo thưởng của tôi' })).toBeInTheDocument();
  const items = await within(section).findAllByRole('listitem');
  expect(items).toHaveLength(4);
  expect(items[0]).toHaveTextContent('🦩 Bồ Nông nuốt hết vịt');
  expect(items[0]).toHaveTextContent('+5');
  expect(items[0]).toHaveTextContent('Buổi 19:00 22/10/2026 — Cổ điển');
  expect(within(items[0] as HTMLElement).getByText('Chờ duyệt')).toHaveClass('chip', 'bg-gold');
  expect(items[1]).toHaveTextContent('🎯 Tham gia đủ');
  expect(within(items[1] as HTMLElement).getByText('Đã nhận +3')).toHaveClass('chip', 'bg-ok');
  expect(items[2]).toHaveTextContent('Bị từ chối: Không có clip');
  expect(items[3]).toHaveTextContent('Đã bị huỷ: Nhầm buổi');
  expect(fetchMock).toHaveBeenCalledWith('/api/bounty-claims/mine?limit=20', expect.anything());
});

test('"Treo thưởng của tôi" says so when I have no claims', async () => {
  stubFetch(baseRoutes);
  renderPage();
  const section = await screen.findByRole('region', { name: 'Treo thưởng của tôi' });
  expect(await within(section).findByText('Bạn chưa nhận treo thưởng nào')).toBeInTheDocument();
});
