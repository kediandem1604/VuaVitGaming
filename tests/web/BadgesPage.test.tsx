import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { BadgeDto, BadgeMemberDto } from '../../src/shared/api-types';
import { BADGES } from '../../src/shared/badges';
import { BadgesPage } from '../../src/web/pages/BadgesPage';

const PAGE_SIZE = 50;

const member = (id: number, displayName: string): BadgeMemberDto => ({ id, displayName, avatarUrl: null });

const badge = (id: number, awardedAt: string, over: Partial<BadgeDto> = {}): BadgeDto => ({
  id,
  badgeKey: 'smvp',
  kind: 'monthly',
  periodId: '2026-10',
  title: 'SMVP tháng 10/2026',
  icon: '👑',
  detail: '7 lần MVP',
  awardedAt,
  member: member(1, 'Ngỗng Một'),
  ...over,
});

/**
 * Trang đầu (mới nhất trước) trải qua hai tháng VN. Mốc 17:05Z ngày 3/11 là 00:05 ngày 4/11 ở
 * Việt Nam (giờ trao danh hiệu tháng); mốc 17:30Z ngày 30/9 là 00:30 ngày 1/10 ở Việt Nam —
 * nhóm theo UTC sẽ xếp nhầm vào tháng 9.
 */
const firstPage: BadgeDto[] = [
  badge(12, '2026-11-10T03:00:00.000Z', {
    badgeKey: 'games_50',
    kind: 'milestone',
    periodId: '',
    title: 'Lão làng',
    icon: '🏅',
    detail: 'Đã đi 50 trận',
    member: member(3, 'Ngỗng Ba'),
  }),
  badge(11, '2026-11-03T17:05:00.000Z'),
  badge(10, '2026-11-03T17:05:00.000Z', {
    badgeKey: 'fun_king',
    title: 'Vua tấu hài tháng 10/2026',
    icon: '🤡',
    detail: '3 lần thắng hạng mục vui',
    member: member(2, 'Vịt Hai'),
  }),
  badge(9, '2026-09-30T17:30:00.000Z', {
    badgeKey: 'games_10',
    kind: 'milestone',
    periodId: '',
    title: 'Quen mặt',
    icon: '🎮',
    detail: 'Đã đi 10 trận',
    member: member(2, 'Vịt Hai'),
  }),
];

/** Đúng 50 dòng (id 100 → 51), đều trao tháng 11/2026: còn trang sau. */
const fullPage: BadgeDto[] = Array.from({ length: PAGE_SIZE }, (_, index) =>
  badge(100 - index, '2026-11-03T17:05:00.000Z', { member: member(100 - index, `Thành viên ${100 - index}`) }),
);

/** Trang sau: một dòng cùng tháng 11 (nhập vào nhóm đang có) và một dòng tháng 10 (nhóm mới). */
const secondPage: BadgeDto[] = [
  badge(50, '2026-11-01T01:00:00.000Z', { member: member(50, 'Thành viên 50') }),
  badge(49, '2026-10-20T01:00:00.000Z', { badgeKey: 'games_10', kind: 'milestone', periodId: '', title: 'Quen mặt', icon: '🎮', detail: 'Đã đi 10 trận', member: member(49, 'Thành viên 49') }),
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** `pages`: trang đầu dưới khoá `''`, trang sau dưới khoá là id dòng cuối trang trước. */
function stubFetch(pages: Record<string, BadgeDto[]>) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `/api/badges?limit=${PAGE_SIZE}`) return Promise.resolve(json(200, pages[''] ?? []));
    const match = new RegExp(`^/api/badges\\?before=(\\d+)&limit=${PAGE_SIZE}$`).exec(url);
    const page = match?.[1] ? pages[match[1]] : undefined;
    if (page) return Promise.resolve(json(200, page));
    throw new Error(`Không có tuyến giả cho ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/huy-hieu']}>
        <BadgesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** Các nhóm tháng của tường vinh danh (section có tiêu đề "Trao trong tháng …"), theo thứ tự trên trang. */
const monthSections = () => screen.getAllByRole('region', { name: /^Trao trong tháng / });
const cardsIn = (section: HTMLElement) => within(section).getAllByRole('listitem');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('groups the wall by the Vietnam month of awardedAt, newest month first', async () => {
  const fetchMock = stubFetch({ '': firstPage });
  renderPage();

  expect(screen.getByRole('heading', { level: 1, name: 'Huy hiệu' })).toBeInTheDocument();
  await screen.findByRole('region', { name: 'Trao trong tháng 11/2026' });
  expect(fetchMock).toHaveBeenCalledWith('/api/badges?limit=50', expect.anything());

  const sections = monthSections();
  expect(sections.map((section) => within(section).getByRole('heading', { level: 2 }).textContent)).toEqual([
    'Trao trong tháng 11/2026',
    'Trao trong tháng 10/2026',
  ]);
  // Ba dòng đầu vào tháng 11; dòng 17:30Z ngày 30/9 là ngày 1/10 ở Việt Nam → tháng 10, không phải tháng 9.
  expect(cardsIn(sections[0] as HTMLElement)).toHaveLength(3);
  expect(cardsIn(sections[1] as HTMLElement)).toHaveLength(1);
  expect(cardsIn(sections[1] as HTMLElement)[0]).toHaveTextContent('Quen mặt');
  expect(screen.queryByRole('region', { name: /tháng 9\/2026/ })).toBeNull();

  // Trang đầu chỉ có 4 dòng (< 50): không còn trang sau, không có nút.
  expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
});

test('each card shows icon, title, detail and the member name linking to their page', async () => {
  stubFetch({ '': firstPage });
  renderPage();
  const november = await screen.findByRole('region', { name: 'Trao trong tháng 11/2026' });

  const [milestone, smvp, funKing] = cardsIn(november) as [HTMLElement, HTMLElement, HTMLElement];
  expect(milestone).toHaveTextContent('Lão làng');
  expect(milestone).toHaveTextContent('Đã đi 50 trận');
  expect(within(milestone).getByRole('link', { name: 'Ngỗng Ba' })).toHaveAttribute('href', '/thanh-vien/3');

  expect(smvp).toHaveTextContent('SMVP tháng 10/2026');
  expect(smvp).toHaveTextContent('7 lần MVP');
  // Emoji chỉ trang trí: nằm ngoài cây truy cập.
  expect(smvp.querySelector('[aria-hidden="true"]')).toHaveTextContent('👑');
  expect(within(smvp).getByRole('link', { name: 'Ngỗng Một' })).toHaveAttribute('href', '/thanh-vien/1');

  expect(funKing).toHaveTextContent('Vua tấu hài tháng 10/2026');
  expect(funKing).toHaveTextContent('3 lần thắng hạng mục vui');
  expect(within(funKing).getByRole('link', { name: 'Vịt Hai' })).toHaveAttribute('href', '/thanh-vien/2');
});

test('Xem thêm requests the next page after the last id, appends it, and hides once a short page arrives', async () => {
  const fetchMock = stubFetch({ '': fullPage, '51': secondPage });
  renderPage();
  await screen.findByRole('region', { name: 'Trao trong tháng 11/2026' });

  expect(monthSections()).toHaveLength(1);
  expect(cardsIn(monthSections()[0] as HTMLElement)).toHaveLength(PAGE_SIZE);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));

  await screen.findByRole('region', { name: 'Trao trong tháng 10/2026' });
  expect(fetchMock).toHaveBeenCalledWith('/api/badges?before=51&limit=50', expect.anything());
  const sections = monthSections();
  expect(sections).toHaveLength(2);
  // Dòng tháng 11 của trang sau nhập vào nhóm tháng 11 đang có (không mở nhóm thứ hai cùng tháng).
  expect(cardsIn(sections[0] as HTMLElement)).toHaveLength(PAGE_SIZE + 1);
  expect(cardsIn(sections[0] as HTMLElement).at(-1)).toHaveTextContent('Thành viên 50');
  expect(cardsIn(sections[1] as HTMLElement)).toHaveLength(1);
  expect(cardsIn(sections[1] as HTMLElement)[0]).toHaveTextContent('Thành viên 49');
  // Trang sau chỉ có 2 dòng (< 50): hết, nút biến mất.
  expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
});

test('an empty wall shows the empty copy while Cách nhận stays', async () => {
  stubFetch({ '': [] });
  renderPage();

  expect(await screen.findByText('Chưa có danh hiệu nào — đầu tháng sau sẽ có SMVP đầu tiên!')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /^Trao trong tháng / })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  expect(screen.getByRole('heading', { level: 2, name: 'Cách nhận' })).toBeInTheDocument();
});

test('Cách nhận lists the whole catalogue split into Mỗi tháng and Cột mốc', async () => {
  stubFetch({ '': [] });
  renderPage();
  await screen.findByRole('heading', { level: 2, name: 'Cách nhận' });

  const monthly = within(screen.getByRole('list', { name: 'Mỗi tháng' })).getAllByRole('listitem');
  const milestones = within(screen.getByRole('list', { name: 'Cột mốc' })).getAllByRole('listitem');
  expect(monthly).toHaveLength(7);
  expect(milestones).toHaveLength(9);
  expect(BADGES).toHaveLength(16);

  for (const def of BADGES) {
    const list = def.kind === 'monthly' ? monthly : milestones;
    const item = list.find((node) => within(node).queryByText(def.name) !== null);
    expect(item, def.key).toBeDefined();
    expect(item).toHaveTextContent(def.howTo);
    expect(item?.querySelector('[aria-hidden="true"]')).toHaveTextContent(def.icon);
  }
  // Thứ tự như danh mục: SMVP đứng đầu nhóm tháng, Quen mặt đứng đầu nhóm cột mốc.
  expect(monthly[0]).toHaveTextContent('SMVP');
  expect(milestones[0]).toHaveTextContent('Quen mặt');
});

test('a failed load shows the message and Thử lại recovers', async () => {
  let fail = true;
  const fetchMock = vi.fn(() => {
    if (fail) return Promise.resolve(json(500, { error: { code: 'INTERNAL', message: 'Có lỗi xảy ra, thử lại sau' } }));
    return Promise.resolve(json(200, firstPage));
  });
  vi.stubGlobal('fetch', fetchMock);
  renderPage();

  expect(await screen.findByRole('alert')).toHaveTextContent('Có lỗi xảy ra, thử lại sau');
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('region', { name: 'Trao trong tháng 11/2026' })).toBeInTheDocument();
});
