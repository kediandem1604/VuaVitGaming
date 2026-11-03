import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReportDto, RoleDto, RoundDto } from '../../src/shared/api-types';
import { RoundReportForm } from '../../src/web/pages/RoundReportForm';

// Form "Khai role ván này": mọi ô số (chính / phụ / phạt) bắt đầu bằng 0 và về 0 khi đổi role.

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

const vigilante = role({
  id: 21,
  key: 'vigilante',
  faction: 'goose',
  nameVi: 'Dân phòng',
  nameEn: 'Vigilante',
  icon: '🔫',
  metricLabel: 'Số phát bắn trúng kẻ xấu',
  maxPerGame: 1,
  penaltyMetricLabel: 'Số phát bắn nhầm',
  penaltyMaxPerGame: 1,
  penaltyPoints: 1,
});
const assassin = role({
  id: 62,
  key: 'assassin',
  faction: 'duck',
  nameVi: 'Ám sát',
  nameEn: 'Assassin',
  icon: '🗡️',
  metricLabel: 'Số mạng ám sát',
  maxPerGame: 5,
  extraMetricLabel: 'Số lần ám sát trong họp',
  extraMaxPerGame: 3,
  extraPoints: 2,
  penaltyMetricLabel: 'Số lần đoán sai',
  penaltyMaxPerGame: 3,
  penaltyPoints: 1,
});
const roles = [vigilante, assassin];

const round: RoundDto = {
  id: 101,
  sessionId: 7,
  number: 1,
  winnerFaction: null,
  winnerIds: [],
  imageUrl: '/api/rounds/101/image?v=1',
  thumbUrl: '/api/rounds/101/image?size=thumb&v=1',
  imageUpdatedAt: '2026-11-02T13:20:00.000Z',
  reports: [],
};

const existing = (): ReportDto => ({
  id: 40,
  member: { id: 9, displayName: 'Tôi' },
  role: { id: 62, nameVi: 'Ám sát', icon: '🗡️', metricLabel: 'Số mạng ám sát', maxPerGame: 5, points: 1, extraMetricLabel: 'Số lần ám sát trong họp', extraMaxPerGame: 3, extraPoints: 2, penaltyMetricLabel: 'Số lần đoán sai', penaltyMaxPerGame: 3, penaltyPoints: 1 },
  value: 4,
  extraValue: 2,
  penaltyValue: 1,
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
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch() {
  const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => Promise.resolve(json(init?.method === 'POST' ? 201 : 200, existing())));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const sentBody = (fetchMock: ReturnType<typeof stubFetch>, method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === method);
  return JSON.parse(String((call?.[1] as RequestInit).body)) as unknown;
};

const renderForm = (mine: ReportDto | null = null) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <RoundReportForm round={round} roles={roles} existing={mine} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { form: screen.getByRole('form'), onDone };
};

const pick = (form: HTMLElement, name: string) => {
  fireEvent.click(within(form).getByRole('combobox', { name: 'Role' }));
  fireEvent.click(screen.getByRole('option', { name }));
};

const spin = (form: HTMLElement, name: string) => within(form).getByRole('spinbutton', { name });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('every numeric field starts at 0, before and after picking a role', () => {
  stubFetch();
  const { form } = renderForm();
  // Chưa chọn role: ô chính (đang khoá) cũng hiện 0.
  expect(spin(form, 'Giá trị')).toHaveValue(0);

  pick(form, '🗡️ Ám sát');
  expect(spin(form, 'Số mạng ám sát')).toHaveValue(0);
  expect(spin(form, 'Số lần ám sát trong họp')).toHaveValue(0);
  expect(spin(form, 'Số lần đoán sai')).toHaveValue(0);
});

test('changing the role resets every numeric field to 0', () => {
  stubFetch();
  const { form } = renderForm();
  pick(form, '🗡️ Ám sát');
  fireEvent.change(spin(form, 'Số mạng ám sát'), { target: { value: '3' } });
  fireEvent.change(spin(form, 'Số lần ám sát trong họp'), { target: { value: '2' } });
  fireEvent.change(spin(form, 'Số lần đoán sai'), { target: { value: '1' } });

  pick(form, '🔫 Dân phòng');
  expect(spin(form, 'Số phát bắn trúng kẻ xấu')).toHaveValue(0);
  expect(spin(form, 'Số phát bắn nhầm')).toHaveValue(0);
});

test('submitting without touching the fields sends 0', async () => {
  const fetchMock = stubFetch();
  const { form, onDone } = renderForm();
  pick(form, '🔫 Dân phòng');
  fireEvent.click(within(form).getByRole('button', { name: 'Gửi' }));

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
  expect(sentBody(fetchMock, 'POST')).toEqual({ roleId: 21, value: 0, penaltyValue: 0 });
});

test('the edit form keeps the existing values, and switching role resets them to 0', () => {
  stubFetch();
  const { form } = renderForm(existing());
  expect(spin(form, 'Số mạng ám sát')).toHaveValue(4);
  expect(spin(form, 'Số lần ám sát trong họp')).toHaveValue(2);
  expect(spin(form, 'Số lần đoán sai')).toHaveValue(1);

  pick(form, '🔫 Dân phòng');
  expect(spin(form, 'Số phát bắn trúng kẻ xấu')).toHaveValue(0);
  expect(spin(form, 'Số phát bắn nhầm')).toHaveValue(0);
});
