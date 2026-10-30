import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { HalloweenDecor, ThemeToggle } from '../../src/web/components/HalloweenDecor';
import { RankAvatar } from '../../src/web/components/RankAvatar';
import { contrastRatio } from '../../src/web/lib/palette';
import { applyTheme, THEME_KEY } from '../../src/web/lib/theme';

/**
 * Chủ đề Halloween chung: admin bật/tắt trên server, mọi máy theo `GET /api/theme`, đặt
 * `data-theme` của `<html>` và nhớ trong `localStorage` (cho lần vẽ đầu). Lớp trang trí chỉ có
 * khi bật, bộ màu Halloween giữ đủ tương phản như Sảnh đêm. Khung avatar Top 1-2-3.
 */

const CSS = readFileSync(resolve(__dirname, '../../src/web/styles.css'), 'utf8');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const withClient = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  applyTheme('night');
  localStorage.clear();
});

test('every page follows the theme the server says', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ theme: 'halloween' })));
  render(withClient(<HalloweenDecor />));
  expect(document.querySelector('.hw-decor')).toBeNull();

  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('halloween'));
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/theme');
  expect(localStorage.getItem(THEME_KEY)).toBe('halloween');
  expect(document.querySelector('.hw-decor')).toHaveAttribute('aria-hidden', 'true');
});

test('a network error keeps the theme the page already has', async () => {
  applyTheme('halloween');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  render(withClient(<HalloweenDecor />));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(document.documentElement.dataset.theme).toBe('halloween');
  expect(document.querySelector('.hw-decor')).not.toBeNull();
});

test('the admin toggle switches the theme for everyone through the server', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT' ? json(JSON.parse(String(init.body))) : json({ theme: 'night' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    withClient(
      <>
        <ThemeToggle />
        <HalloweenDecor />
      </>,
    ),
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/theme', expect.anything()));
  const toggle = screen.getByRole('button', { name: 'Chủ đề Halloween' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');

  let resolvePut: () => void = () => undefined;
  const putDone = new Promise<void>((r) => (resolvePut = r));
  fetchMock.mockImplementationOnce(async (_url, init) => {
    await putDone;
    return json(JSON.parse(String(init?.body)));
  });
  fireEvent.click(toggle);
  // Đổi ngay trên máy admin, không chờ server trả lời.
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('halloween'));
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(toggle).toBeDisabled();
  resolvePut();
  await waitFor(() => expect(toggle).toBeEnabled());
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(put?.[0]).toBe('/api/admin/theme');
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({ theme: 'halloween' });
  expect(localStorage.getItem(THEME_KEY)).toBe('halloween');

  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(document.querySelector('.hw-decor')).toBeNull();
});

test('a failed change goes back to the previous theme', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? json({ error: { code: 'FORBIDDEN', message: 'Bạn không có quyền làm việc này' } }, 403)
      : json({ theme: 'night' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(withClient(<ThemeToggle />));
  const toggle = screen.getByRole('button', { name: 'Chủ đề Halloween' });

  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('index.html applies the saved theme before the first paint with the same storage key', () => {
  const html = readFileSync(resolve(__dirname, '../../src/web/index.html'), 'utf8');
  expect(html).toContain(`localStorage.getItem('${THEME_KEY}') === 'halloween'`);
});

test('the Halloween palette keeps the contrast the night palette guarantees', () => {
  const block = CSS.slice(CSS.indexOf(":root[data-theme='halloween'] {"));
  const token = (name: string) => {
    const match = block.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`));
    expect(match, `chủ đề Halloween thiếu --color-${name}`).not.toBeNull();
    return match![1]!;
  };
  expect(contrastRatio('#FFFFFF', token('night-800'))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(token('night-300'), token('night-800'))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(token('night-300'), token('night-900'))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(token('night-200'), token('night-800'))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(token('gold'), token('night-800'))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(token('gold-ink'), token('gold'))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio('#FFFFFF', token('night-700'))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(token('night-600'), token('night-800'))).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(token('night-600'), token('night-900'))).toBeGreaterThanOrEqual(3);
});

test.each([1, 2, 3])('rank %i gets a decorative frame around the avatar', (rank) => {
  render(<RankAvatar rank={rank} name="Kẹ" url={null} />);
  const frame = document.querySelector('.rank-frame')!;
  expect(frame).toHaveAttribute('data-rank', String(rank));
  expect(frame.querySelector('.rank-crown') !== null).toBe(rank === 1);
  expect(frame.querySelector('.rank-pip')).toHaveTextContent(String(rank));
});

test('each board frames its top 3 its own way, with its own crown on rank 1', () => {
  const frameOf = (board: 'goose' | 'duck' | 'neutral' | 'all') => {
    render(<RankAvatar rank={1} name="Kẹ" url={null} board={board} />);
    const frame = document.querySelector('.rank-frame')!;
    expect(frame).toHaveAttribute('data-board', board);
    const art = `${frame.querySelector('.rank-deco')!.innerHTML}|${frame.querySelector('.rank-crown')!.innerHTML}`;
    cleanup();
    return art;
  };
  const arts = (['goose', 'duck', 'neutral', 'all'] as const).map(frameOf);
  expect(new Set(arts).size).toBe(4);
  // Mặc định là bảng "Cả 3 phe".
  render(<RankAvatar rank={2} name="Kẹ" url={null} />);
  expect(document.querySelector('.rank-frame')).toHaveAttribute('data-board', 'all');
});

test('rank 4 and below is a plain avatar', () => {
  render(<RankAvatar rank={4} name="Kẹ" url={null} />);
  expect(document.querySelector('.rank-frame')).toBeNull();
  expect(document.body).toHaveTextContent('K');
});
