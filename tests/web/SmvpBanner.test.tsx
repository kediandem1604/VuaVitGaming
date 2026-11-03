import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BadgeDto, MeDto } from '../../src/shared/api-types';
import { Layout } from '../../src/web/components/Layout';
import { SmvpBanner } from '../../src/web/components/SmvpBanner';

/**
 * Bảng chúc mừng SMVP (quyết định 2026-11-03): mọi trang, dưới thanh điều hướng; câu chúc kèm
 * avatar và link trang thành viên; nút "Đóng" ẩn đúng lần trao đó trên máy này (localStorage có
 * thể hỏng/bị chặn — vẫn ẩn được trong lượt xem); server trả null thì không vẽ gì.
 */

const ROUTE = '/api/badges/recent-smvp';
const DISMISSED_KEY = 'ggd-smvp-dismissed';

const smvp = (over: Partial<BadgeDto> = {}): BadgeDto => ({
  id: 42,
  badgeKey: 'smvp',
  kind: 'monthly',
  periodId: '2026-10',
  title: 'SMVP tháng 10/2026',
  icon: '👑',
  detail: '12 điểm cả 3 phe',
  awardedAt: '2026-10-31T17:05:00.000Z',
  member: { id: 7, displayName: 'An', avatarUrl: 'https://cdn.example/an.png' },
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stub(body: () => BadgeDto | null) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === ROUTE) return Promise.resolve(json(200, body()));
    return Promise.resolve(json(200, []));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderBanner = () =>
  render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <SmvpBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

test('shows the congratulation with the avatar and a link to the member page', async () => {
  stub(() => smvp());
  renderBanner();

  const panel = await screen.findByRole('region', { name: 'Chúc mừng SMVP' });
  expect(panel).toHaveTextContent('🏆 Chúc mừng An đạt danh hiệu SMVP tháng 10/2026!');
  const link = screen.getByRole('link', { name: 'An' });
  expect(link).toHaveAttribute('href', '/thanh-vien/7');
  expect(panel.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/an.png');
  expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
});

test('renders nothing when the server has no recent SMVP or the request fails', async () => {
  const fetchMock = stub(() => null);
  const { container } = renderBanner();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(container).toBeEmptyDOMElement();
  cleanup();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(500, { error: { code: 'INTERNAL', message: 'x' } })));
  const again = renderBanner();
  await new Promise((r) => setTimeout(r, 10));
  expect(again.container).toBeEmptyDOMElement();
});

test('"Đóng" hides that award on this device; a newer award shows again', async () => {
  let current = smvp();
  stub(() => current);
  renderBanner();
  fireEvent.click(await screen.findByRole('button', { name: 'Đóng' }));
  expect(screen.queryByRole('region', { name: 'Chúc mừng SMVP' })).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')).toEqual([42]);
  cleanup();

  // Mở lại trang: vẫn ẩn.
  renderBanner();
  await new Promise((r) => setTimeout(r, 10));
  expect(screen.queryByRole('region', { name: 'Chúc mừng SMVP' })).not.toBeInTheDocument();
  cleanup();

  // Tháng sau có SMVP mới (id khác) → hiện lại.
  current = smvp({ id: 43, periodId: '2026-11', title: 'SMVP tháng 11/2026', member: { id: 8, displayName: 'Bình', avatarUrl: null } });
  renderBanner();
  expect(await screen.findByRole('region', { name: 'Chúc mừng SMVP' })).toHaveTextContent('🏆 Chúc mừng Bình đạt danh hiệu SMVP tháng 11/2026!');
});

test('blocked or corrupt localStorage still lets the panel close for this view', async () => {
  localStorage.setItem(DISMISSED_KEY, '{not json');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  stub(() => smvp());
  renderBanner();
  fireEvent.click(await screen.findByRole('button', { name: 'Đóng' }));
  expect(screen.queryByRole('region', { name: 'Chúc mừng SMVP' })).not.toBeInTheDocument();
});

test('Layout places the panel below the header and above the main content', async () => {
  stub(() => smvp());
  const me: MeDto = { id: 1, displayName: 'Mod', avatarUrl: null, accessLevel: 'member' } as MeDto;
  render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <Layout me={me}>
          <p>nội dung</p>
        </Layout>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const panel = await screen.findByRole('region', { name: 'Chúc mừng SMVP' });
  const header = screen.getByRole('banner');
  const main = screen.getByRole('main');
  expect(header.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(panel.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(header).not.toContainElement(panel);
});
