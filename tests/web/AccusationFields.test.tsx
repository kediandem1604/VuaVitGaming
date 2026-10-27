import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { MeDto, MemberOptionDto, RoleDto } from '../../src/shared/api-types';
import { AccusationFields, EMPTY_ACCUSATION_DRAFT, parseAccusationDraft, type AccusationDraft } from '../../src/web/components/AccusationFields';

/**
 * Ô "Báo cáo người chơi" của form khai điểm (spec điểm role §6): tick thì hiện bốn ô chọn, danh
 * sách người loại chính mình / người bị báo cáo, chỉ role đang bật có chỉ số phạt, và bước kiểm
 * bốn trường trước khi gửi.
 */

const role = (over: Pick<RoleDto, 'id' | 'key' | 'faction' | 'nameVi' | 'nameEn'> & Partial<RoleDto>): RoleDto => ({
  description: '',
  icon: '❔',
  metricLabel: 'Số lần',
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

const PENALTY = { penaltyMetricLabel: 'Số phát bắn sai', penaltyMaxPerGame: 1, penaltyPoints: 3 };

const roles: RoleDto[] = [
  role({ id: 1, key: 'goose', faction: 'goose', nameVi: 'Ngỗng', nameEn: 'Goose', icon: '🪿' }),
  role({ id: 20, key: 'sheriff', faction: 'goose', nameVi: 'Cảnh sát trưởng', nameEn: 'Sheriff', icon: '⭐', ...PENALTY }),
  role({ id: 21, key: 'vigilante', faction: 'goose', nameVi: 'Dân phòng', nameEn: 'Vigilante', icon: '🔫', ...PENALTY }),
  role({ id: 50, key: 'assassin', faction: 'duck', nameVi: 'Ám sát', nameEn: 'Assassin', icon: '🗡️', ...PENALTY }),
  // Có chỉ số phạt nhưng đã tắt: không được chọn.
  role({ id: 51, key: 'old_duck', faction: 'duck', nameVi: 'Vịt cũ', nameEn: 'Old duck', ...PENALTY, active: false }),
  role({ id: 70, key: 'dodo', faction: 'neutral', nameVi: 'Chim đa đa', nameEn: 'Dodo', icon: '🦤', ...PENALTY }),
];

const members: MemberOptionDto[] = [
  { id: 9, displayName: 'Tôi', avatarUrl: null },
  { id: 10, displayName: 'Vịt Mười', avatarUrl: null },
  { id: 11, displayName: 'Ngỗng Mười Một', avatarUrl: null },
  { id: 12, displayName: 'Đa Đa', avatarUrl: null },
];

const me: MeDto = { id: 9, memberCode: 'GGD-0009', displayName: 'Tôi', avatarUrl: null, email: null, notifyEmail: true, notifyDm: true, accessLevel: 'member' };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Không có tuyến giả cho ${key}`);
    return Promise.resolve(handler());
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const baseRoutes = {
  'GET /api/me': () => json(200, me),
  'GET /api/members/options': () => json(200, members),
};

/** Form giả giữ state như `ReportForm`: ô tick và bản nháp bốn trường; in bản nháp ra để test đọc. */
function Harness({ initialChecked = false, initialDraft = EMPTY_ACCUSATION_DRAFT }: { initialChecked?: boolean; initialDraft?: AccusationDraft }) {
  const [checked, setChecked] = useState(initialChecked);
  const [draft, setDraft] = useState(initialDraft);
  return (
    <>
      <AccusationFields id="acc" roles={roles} checked={checked} onCheckedChange={setChecked} draft={draft} onDraftChange={setDraft} />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}

function renderFields(props: Parameters<typeof Harness>[0] = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

const draft = () => JSON.parse(screen.getByTestId('draft').textContent ?? '{}') as AccusationDraft;
const combobox = (name: string) => screen.getByRole('combobox', { name });
const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('unticked: only the checkbox, no pickers, and the member list is not fetched', () => {
  const fetchMock = stubFetch(baseRoutes);
  renderFields();

  expect(screen.getByRole('checkbox', { name: 'Báo cáo người chơi' })).not.toBeChecked();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByText(/Báo cáo đúng/)).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalledWith('/api/members/options', expect.anything());
});

test('ticking shows four pickers with the hint; members exclude me, roles are enabled penalty roles grouped by faction', async () => {
  stubFetch(baseRoutes);
  renderFields();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Báo cáo người chơi' }));

  const accused = await screen.findByRole('combobox', { name: 'Người bị báo cáo' });
  expect(combobox('Role của họ')).toBeInTheDocument();
  expect(combobox('Họ bắn trúng ai')).toBeInTheDocument();
  expect(combobox('Phe của người bị bắn')).toBeInTheDocument();
  expect(screen.getByText('Báo cáo đúng: bạn +1 điểm, người bị báo cáo bị trừ điểm phạt của role đó.')).toBeInTheDocument();
  // Chưa chọn gì: nút ghi chữ mờ.
  expect(accused).toHaveTextContent('Chọn người…');

  fireEvent.click(accused);
  expect(optionNames()).toEqual(['Vịt Mười', 'Ngỗng Mười Một', 'Đa Đa']);
  // Ô tìm không dấu.
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm người' }), { target: { value: 'da da' } });
  expect(optionNames()).toEqual(['Đa Đa']);
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Tìm người' }), { key: 'Escape' });

  fireEvent.click(combobox('Role của họ'));
  const groupName = (group: HTMLElement) => document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent;
  expect(screen.getAllByRole('group').map(groupName)).toEqual(['Ngỗng', 'Vịt', 'Phe thứ 3']);
  // Không có Ngỗng thường (không chỉ số phạt), không có Vịt cũ (đã tắt).
  expect(optionNames()).toEqual(['⭐ Cảnh sát trưởng', '🔫 Dân phòng', '🗡️ Ám sát', '🦤 Chim đa đa']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm role' }), { target: { value: 'vigilante' } });
  expect(optionNames()).toEqual(['🔫 Dân phòng']);
  fireEvent.click(screen.getByRole('option', { name: '🔫 Dân phòng' }));
  expect(draft().accusedRoleId).toBe(21);

  fireEvent.click(combobox('Phe của người bị bắn'));
  expect(optionNames()).toEqual(['Ngỗng', 'Vịt', 'Phe thứ 3']);
  fireEvent.click(screen.getByRole('option', { name: 'Ngỗng' }));
  expect(draft().victimFaction).toBe('goose');
});

test('the victim list excludes the accused, and a victim equal to a newly picked accused is cleared', async () => {
  stubFetch(baseRoutes);
  renderFields({ initialChecked: true });

  const accused = await screen.findByRole('combobox', { name: 'Người bị báo cáo' });
  fireEvent.click(combobox('Họ bắn trúng ai'));
  // Chưa chọn người bị báo cáo: ai cũng có thể là người bị bắn, kể cả tôi.
  expect(optionNames()).toEqual(['Tôi', 'Vịt Mười', 'Ngỗng Mười Một', 'Đa Đa']);
  fireEvent.click(screen.getByRole('option', { name: 'Vịt Mười' }));
  expect(draft().victimId).toBe(10);

  fireEvent.click(accused);
  fireEvent.click(screen.getByRole('option', { name: 'Vịt Mười' }));
  expect(draft().accusedId).toBe(10);
  // Người bị bắn trùng người bị báo cáo vừa chọn → xoá.
  expect(draft().victimId).toBe(0);
  fireEvent.click(combobox('Họ bắn trúng ai'));
  expect(optionNames()).toEqual(['Tôi', 'Ngỗng Mười Một', 'Đa Đa']);
  fireEvent.click(screen.getByRole('option', { name: 'Đa Đa' }));
  expect(draft().victimId).toBe(12);
  expect(combobox('Họ bắn trúng ai')).toHaveTextContent('Đa Đa');
});

test('unticking keeps the pickers hidden and leaves the draft untouched for a later re-tick', async () => {
  stubFetch(baseRoutes);
  renderFields({ initialChecked: true, initialDraft: { accusedId: 10, accusedRoleId: 21, victimId: 11, victimFaction: 'goose' } });
  expect(await screen.findByRole('combobox', { name: 'Người bị báo cáo' })).toHaveTextContent('Vịt Mười');
  expect(combobox('Role của họ')).toHaveTextContent('🔫 Dân phòng');
  expect(combobox('Họ bắn trúng ai')).toHaveTextContent('Ngỗng Mười Một');
  expect(combobox('Phe của người bị bắn')).toHaveTextContent('Ngỗng');

  fireEvent.click(screen.getByRole('checkbox', { name: 'Báo cáo người chơi' }));
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(draft()).toEqual({ accusedId: 10, accusedRoleId: 21, victimId: 11, victimFaction: 'goose' });
});

test('a failing member list shows the error with a retry button instead of the pickers', async () => {
  stubFetch({ ...baseRoutes, 'GET /api/members/options': () => json(500, { error: { code: 'INTERNAL', message: 'Lỗi máy chủ' } }) });
  renderFields({ initialChecked: true });
  expect(await screen.findByRole('alert')).toHaveTextContent('Lỗi máy chủ');
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  // Ô tick vẫn đó để bỏ báo cáo và khai không kèm.
  expect(screen.getByRole('checkbox', { name: 'Báo cáo người chơi' })).toBeChecked();
});

test('parseAccusationDraft refuses an incomplete draft with the server wording and returns the input when complete', () => {
  expect(parseAccusationDraft(EMPTY_ACCUSATION_DRAFT)).toEqual({ input: null, error: 'Báo cáo cần đủ người bị báo cáo, role, người bị bắn và phe' });
  expect(parseAccusationDraft({ accusedId: 10, accusedRoleId: 21, victimId: 11, victimFaction: '' })).toEqual({ input: null, error: 'Báo cáo cần đủ người bị báo cáo, role, người bị bắn và phe' });
  expect(parseAccusationDraft({ accusedId: 10, accusedRoleId: 21, victimId: 0, victimFaction: 'duck' }).input).toBeNull();
  expect(parseAccusationDraft({ accusedId: 10, accusedRoleId: 21, victimId: 11, victimFaction: 'goose' })).toEqual({
    input: { accusedId: 10, accusedRoleId: 21, victimId: 11, victimFaction: 'goose' },
    error: null,
  });
});
