import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { ThemeDecor, ThemeToggle } from '../../src/web/components/ThemeDecor';
import { RankAvatar } from '../../src/web/components/RankAvatar';
import { contrastRatio } from '../../src/web/lib/palette';
import { applyTheme, THEME_KEY } from '../../src/web/lib/theme';

/**
 * Chủ đề chung (Sảnh đêm, Halloween, Giáng sinh): admin đổi trên server bằng một nút xoay vòng,
 * mọi máy theo `GET /api/theme`, đặt `data-theme` của `<html>` và nhớ trong `localStorage` (cho
 * lần vẽ đầu). Lớp trang trí của mỗi chủ đề chỉ có khi chủ đề đó bật, bộ màu nào cũng giữ đủ
 * tương phản như Sảnh đêm. Khung avatar Top 1-2-3.
 */

/** Tên nút đổi chủ đề (một nút, xoay vòng ba chủ đề). */
const TOGGLE = 'Chủ đề giao diện';

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

test.each([
  ['halloween', '.hw-decor', '.xm-decor'],
  ['christmas', '.xm-decor', '.hw-decor'],
] as const)('every page follows the server: %s shows only its own decor', async (theme, own, other) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ theme })));
  render(withClient(<ThemeDecor />));
  expect(document.querySelector(own)).toBeNull();

  await waitFor(() => expect(document.documentElement.dataset.theme).toBe(theme));
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/theme');
  expect(localStorage.getItem(THEME_KEY)).toBe(theme);
  expect(document.querySelector(own)).toHaveAttribute('aria-hidden', 'true');
  expect(document.querySelector(other)).toBeNull();
});

test('a network error keeps the theme the page already has', async () => {
  applyTheme('halloween');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  render(withClient(<ThemeDecor />));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(document.documentElement.dataset.theme).toBe('halloween');
  expect(document.querySelector('.hw-decor')).not.toBeNull();
});

test('the admin toggle cycles Sảnh đêm → Halloween → Giáng sinh → Sảnh đêm for everyone through the server', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT' ? json(JSON.parse(String(init.body))) : json({ theme: 'night' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    withClient(
      <>
        <ThemeToggle />
        <ThemeDecor />
      </>,
    ),
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/theme', expect.anything()));
  const toggle = screen.getByRole('button', { name: TOGGLE });
  expect(toggle.title).toMatch(/Halloween/);

  let resolvePut: () => void = () => undefined;
  const putDone = new Promise<void>((r) => (resolvePut = r));
  fetchMock.mockImplementationOnce(async (_url, init) => {
    await putDone;
    return json(JSON.parse(String(init?.body)));
  });
  fireEvent.click(toggle);
  // Đổi ngay trên máy admin, không chờ server trả lời.
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('halloween'));
  expect(toggle).toBeDisabled();
  resolvePut();
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(document.querySelector('.hw-decor')).not.toBeNull();
  expect(toggle.title).toMatch(/Giáng sinh/);

  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(document.documentElement.dataset.theme).toBe('christmas');
  expect(document.querySelector('.xm-decor')).not.toBeNull();
  expect(document.querySelector('.hw-decor')).toBeNull();
  expect(localStorage.getItem(THEME_KEY)).toBe('christmas');
  expect(toggle.title).toMatch(/Sảnh đêm/);

  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(document.querySelector('.xm-decor')).toBeNull();

  const sent = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(sent.map(([url]) => url)).toEqual(['/api/admin/theme', '/api/admin/theme', '/api/admin/theme']);
  expect(sent.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
    { theme: 'halloween' },
    { theme: 'christmas' },
    { theme: 'night' },
  ]);
});

test.each([
  ['night', '#1B1F4A'],
  ['halloween', '#1A0F26'],
  ['christmas', '#0B241C'],
] as const)('the mobile browser bar takes the %s background', (theme, colour) => {
  document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
  applyTheme(theme);
  expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', colour);
  document.head.innerHTML = '';
});

test('a failed change goes back to the previous theme', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? json({ error: { code: 'FORBIDDEN', message: 'Bạn không có quyền làm việc này' } }, 403)
      : json({ theme: 'christmas' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  applyTheme('christmas');
  render(withClient(<ThemeToggle />));
  const toggle = screen.getByRole('button', { name: TOGGLE });

  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(document.documentElement.dataset.theme).toBe('christmas');
  expect(toggle.title).toMatch(/Sảnh đêm/);
});

test.each([
  ['halloween', 'halloween', '#1A0F26'],
  ['christmas', 'christmas', '#0B241C'],
  ['night', undefined, '#1B1F4A'],
  ['tết', undefined, '#1B1F4A'],
] as const)('index.html paints a saved "%s" theme before the first paint', (saved, dataTheme, colour) => {
  const html = readFileSync(resolve(__dirname, '../../src/web/index.html'), 'utf8');
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(inline, 'index.html thiếu đoạn script đặt chủ đề').toBeDefined();
  document.head.innerHTML = '<meta name="theme-color" content="#1B1F4A" />';
  localStorage.setItem(THEME_KEY, saved);

  new Function(inline!)();

  expect(document.documentElement.dataset.theme).toBe(dataTheme);
  expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', colour);
  document.head.innerHTML = '';
});

test.each(['halloween', 'christmas'])('the %s palette keeps the contrast the night palette guarantees', (theme) => {
  const at = CSS.indexOf(`:root[data-theme='${theme}'] {`);
  expect(at, `styles.css thiếu bộ màu ${theme}`).toBeGreaterThan(-1);
  const block = CSS.slice(at, CSS.indexOf('}', at));
  const token = (name: string) => {
    const match = block.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`));
    expect(match, `chủ đề ${theme} thiếu --color-${name}`).not.toBeNull();
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
