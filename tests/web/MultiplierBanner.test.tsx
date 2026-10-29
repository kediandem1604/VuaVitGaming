import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MeDto, MultiplierDayDto } from '../../src/shared/api-types';
import { Layout } from '../../src/web/components/Layout';
import { MultiplierBanner, multiplierBannerText } from '../../src/web/components/MultiplierBanner';
import { MULTIPLIER_UPCOMING_KEY } from '../../src/web/lib/queryKeys';

/**
 * Banner ngày nhân điểm (spec ngày nhân điểm §5): hôm nay / ngày mai / xa hơn, lời nhắn sau " — ",
 * ẩn theo đúng ngày trên máy này, không có ngày thì không vẽ, và qua nửa đêm lúc trang đang mở thì
 * "Ngày mai" thành "Hôm nay" (Review Focus #4).
 */

const UPCOMING_ROUTE = '/api/multiplier-days/upcoming';
const HIDDEN_KEY = 'ggd-multiplier-hidden';

const day = (over: Partial<MultiplierDayDto> & Pick<MultiplierDayDto, 'day'>): MultiplierDayDto => ({ id: 1, multiplier: 2, message: null, ...over });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubUpcoming(list: () => MultiplierDayDto[]) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === UPCOMING_ROUTE) return Promise.resolve(json(200, list()));
    throw new Error(`Không có tuyến giả cho ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderBanner = (queryClient = makeClient()) => {
  render(
    <QueryClientProvider client={queryClient}>
      <MultiplierBanner />
    </QueryClientProvider>,
  );
  return queryClient;
};

/** Đặt đồng hồ (chỉ `Date` và `setInterval` giả, để TanStack Query và `findBy` vẫn chạy bằng hẹn giờ thật). */
const setClock = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(iso));
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

test('multiplierBannerText: today, tomorrow, a later day and the message after " — "', () => {
  expect(multiplierBannerText(day({ day: '2026-10-30', multiplier: 2 }), '2026-10-30')).toBe('🔥 Hôm nay điểm cộng ×2!');
  expect(multiplierBannerText(day({ day: '2026-10-31', multiplier: 3 }), '2026-10-30')).toBe('🔥 Ngày mai (31/10) điểm cộng ×3!');
  // Ngày mai qua ranh giới tháng vẫn là "Ngày mai".
  expect(multiplierBannerText(day({ day: '2026-11-01', multiplier: 2 }), '2026-10-31')).toBe('🔥 Ngày mai (01/11) điểm cộng ×2!');
  expect(multiplierBannerText(day({ day: '2026-11-05', multiplier: 5 }), '2026-10-30')).toBe('🔥 Thứ Năm, 05/11: điểm cộng ×5!');
  expect(multiplierBannerText(day({ day: '2026-10-30', multiplier: 4, message: 'Quẩy hết mình' }), '2026-10-30')).toBe('🔥 Hôm nay điểm cộng ×4! — Quẩy hết mình');
});

test('shows the nearest day with its message and a hide button', async () => {
  setClock('2026-10-30T05:00:00Z'); // 12:00 VN ngày 30/10
  stubUpcoming(() => [day({ id: 1, day: '2026-10-31', multiplier: 3, message: 'Cuối tuần vui vẻ' }), day({ id: 2, day: '2026-11-05', multiplier: 2 })]);
  renderBanner();

  const banner = await screen.findByRole('region', { name: 'Thông báo ngày nhân điểm' });
  expect(banner).toHaveTextContent('🔥 Ngày mai (31/10) điểm cộng ×3! — Cuối tuần vui vẻ');
  expect(banner).not.toHaveTextContent('05/11');
  expect(screen.getByRole('button', { name: 'Ẩn thông báo' })).toBeInTheDocument();
});

test('nothing is drawn when there is no upcoming day (or the list fails to load)', async () => {
  const fetchMock = stubUpcoming(() => []);
  renderBanner();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByRole('region', { name: 'Thông báo ngày nhân điểm' })).not.toBeInTheDocument();
  cleanup();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(500, { error: { code: 'INTERNAL', message: 'Lỗi' } })));
  renderBanner();
  await act(async () => {});
  expect(screen.queryByRole('region', { name: 'Thông báo ngày nhân điểm' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('days from the report window (yesterday and before) are skipped: the banner shows today or later only', async () => {
  setClock('2026-10-30T05:00:00Z');
  stubUpcoming(() => [day({ id: 1, day: '2026-10-28', multiplier: 5 }), day({ id: 2, day: '2026-10-29', multiplier: 4 }), day({ id: 3, day: '2026-10-31', multiplier: 2 })]);
  renderBanner();
  const banner = await screen.findByRole('region', { name: 'Thông báo ngày nhân điểm' });
  expect(banner).toHaveTextContent('🔥 Ngày mai (31/10) điểm cộng ×2!');
  cleanup();

  // Chỉ có ngày hôm qua → không vẽ gì.
  stubUpcoming(() => [day({ day: '2026-10-29', multiplier: 3 })]);
  renderBanner();
  await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByRole('region', { name: 'Thông báo ngày nhân điểm' })).not.toBeInTheDocument();
});

test('a day already gone (stale list) is not announced', async () => {
  setClock('2026-10-31T05:00:00Z');
  stubUpcoming(() => [day({ day: '2026-10-30' })]);
  const fetchMock = vi.mocked(fetch);
  renderBanner();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByRole('region', { name: 'Thông báo ngày nhân điểm' })).not.toBeInTheDocument();
});

test('✕ hides the banner of that day only, remembered on this device', async () => {
  setClock('2026-10-30T05:00:00Z');
  let list = [day({ id: 1, day: '2026-10-30', multiplier: 2 })];
  stubUpcoming(() => list);
  renderBanner();

  fireEvent.click(await screen.findByRole('button', { name: 'Ẩn thông báo' }));
  expect(screen.queryByRole('region', { name: 'Thông báo ngày nhân điểm' })).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')).toEqual(['2026-10-30']);
  cleanup();

  // Tải lại trang: ngày đó vẫn ẩn.
  renderBanner();
  await act(async () => {});
  expect(screen.queryByRole('region', { name: 'Thông báo ngày nhân điểm' })).not.toBeInTheDocument();
  cleanup();

  // Có thêm một ngày khác: banner của ngày đó vẫn hiện.
  list = [day({ id: 1, day: '2026-10-30', multiplier: 2 }), day({ id: 2, day: '2026-11-02', multiplier: 4 })];
  renderBanner();
  expect(await screen.findByRole('region', { name: 'Thông báo ngày nhân điểm' })).toHaveTextContent('🔥 Thứ Hai, 02/11: điểm cộng ×4!');
});

test('storage that throws never breaks the banner: it still shows and ✕ still hides it for this visit', async () => {
  setClock('2026-10-30T05:00:00Z');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  stubUpcoming(() => [day({ day: '2026-10-30', multiplier: 2 })]);
  renderBanner();

  expect(await screen.findByRole('region', { name: 'Thông báo ngày nhân điểm' })).toHaveTextContent('🔥 Hôm nay điểm cộng ×2!');
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn thông báo' }));
  expect(screen.queryByRole('region', { name: 'Thông báo ngày nhân điểm' })).not.toBeInTheDocument();
});

test('past midnight with the page open, "Ngày mai" becomes "Hôm nay" (Review Focus #4)', async () => {
  setClock('2026-10-30T16:58:00Z'); // 23:58 VN ngày 30/10
  stubUpcoming(() => [day({ day: '2026-10-31', multiplier: 3 })]);
  renderBanner();

  const banner = await screen.findByRole('region', { name: 'Thông báo ngày nhân điểm' });
  expect(banner).toHaveTextContent('🔥 Ngày mai (31/10) điểm cộng ×3!');

  // Hai phút sau đã là 00:00 ngày 31/10 ở Việt Nam.
  act(() => {
    vi.advanceTimersByTime(2 * 60_000);
  });
  expect(screen.getByRole('region', { name: 'Thông báo ngày nhân điểm' })).toHaveTextContent('🔥 Hôm nay điểm cộng ×3!');
});

test('the list is reloaded when the window regains focus (a day added meanwhile appears)', async () => {
  setClock('2026-10-30T05:00:00Z');
  let list: MultiplierDayDto[] = [];
  const fetchMock = stubUpcoming(() => list);
  const queryClient = renderBanner();
  // Chờ lượt tải đầu xong hẳn (đang tải thì lượt focus chỉ nhập vào lượt đó).
  await vi.waitFor(() => expect(queryClient.getQueryState(MULTIPLIER_UPCOMING_KEY)?.status).toBe('success'));
  expect(screen.queryByRole('region', { name: 'Thông báo ngày nhân điểm' })).not.toBeInTheDocument();

  list = [day({ day: '2026-10-31', multiplier: 2 })];
  // Cửa sổ mất focus rồi được focus lại (như chuyển tab qua lại).
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('region', { name: 'Thông báo ngày nhân điểm' })).toHaveTextContent('🔥 Ngày mai (31/10) điểm cộng ×2!');
});

test('the layout shows the banner below the header, before the page content', async () => {
  setClock('2026-10-30T05:00:00Z');
  stubUpcoming(() => [day({ day: '2026-10-30', multiplier: 2 })]);
  const me: MeDto = { id: 1, memberCode: 'GGD-0001', displayName: 'Ngỗng Một', avatarUrl: null, email: null, notifyEmail: true, notifyDm: true, accessLevel: 'member' };
  render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <Layout me={me}>
          <p>nội dung</p>
        </Layout>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const banner = await screen.findByRole('region', { name: 'Thông báo ngày nhân điểm' });
  const header = screen.getByRole('banner');
  const main = screen.getByRole('main');
  expect(header.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(header).not.toContainElement(banner);
});
