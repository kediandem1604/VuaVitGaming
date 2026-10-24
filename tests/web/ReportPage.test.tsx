import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReportDto, RoleDto, SessionDto } from '../../src/shared/api-types';
import { vnTodayIso } from '../../src/web/lib/format';
import { ReportPage } from '../../src/web/pages/ReportPage';

const role = (over: Pick<RoleDto, 'id' | 'key' | 'faction' | 'nameVi' | 'nameEn' | 'icon' | 'metricLabel' | 'maxPerGame'> & Partial<RoleDto>): RoleDto => ({
  description: '',
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
  role: { id: 61, nameVi: 'Kiếm sĩ', icon: '⚔️', metricLabel: 'Số mạng chém' },
  value: 4,
  playedOn: today,
  sessionId: null,
  note: null,
  rejectReason: null,
  createdAt: '2026-10-22T13:00:00.000Z',
  ...over,
});

const mine: ReportDto[] = [
  report({ id: 3, status: 'pending', value: 4, note: 'Trận cuối' }),
  report({ id: 2, status: 'approved', value: 6 }),
  report({ id: 1, status: 'rejected', value: 30, rejectReason: 'Quá giới hạn của role' }),
];

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
};

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
  expect(items[0]).toHaveTextContent('5 Số mạng chém');
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
  fireEvent.change(within(editor).getByRole('spinbutton', { name: 'Số mạng chém' }), { target: { value: '7' } });
  fireEvent.change(within(editor).getByRole('textbox', { name: 'Ghi chú' }), { target: { value: 'Sửa lại' } });
  fireEvent.click(within(editor).getByRole('button', { name: 'Lưu' }));

  await waitFor(() => expect(patched).toEqual({ value: 7, playedOn: today, note: 'Sửa lại' }));
  expect(await within(editor).findByText('7 Số mạng chém')).toBeInTheDocument();
  expect(editor).toHaveTextContent('Sửa lại');
  expect(within(editor).queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument();
});
