import { cleanup, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CHUNK_RELOAD_FLAG, lazyPage } from '../../src/web/lib/lazyPage';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Page() {
  return <h1>Đã tới</h1>;
}

test('renders the fallback until the chunk arrives, then the page', async () => {
  let resolve: (mod: { default: typeof Page }) => void = () => undefined;
  const Lazy = lazyPage(() => new Promise<{ default: typeof Page }>((r) => (resolve = r)));
  render(
    <Suspense fallback={<p>khung xương</p>}>
      <Lazy />
    </Suspense>,
  );
  expect(screen.getByText('khung xương')).toBeInTheDocument();
  resolve({ default: Page });
  expect(await screen.findByRole('heading', { name: 'Đã tới' })).toBeInTheDocument();
});

test('a rejected import (any error type) reloads the page once and marks sessionStorage', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  // Server trả index.html cho chunk đã xoá → trình duyệt ném lỗi MIME/syntax, không phải 404: lỗi gì cũng tải lại.
  const load = vi.fn().mockRejectedValue(new Error('Failed to fetch dynamically imported module'));

  const Lazy = lazyPage(load);
  // Nuốt lỗi React in ra console trong lúc chờ reload.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <Suspense fallback={<p>khung xương</p>}>
      <Lazy />
    </Suspense>,
  );
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).not.toBeNull();
  // Trong lúc chờ trình duyệt tải lại: vẫn giữ fallback, không ném lỗi lên trên.
  expect(screen.getByText('khung xương')).toBeInTheDocument();
});

test('after one reload a second failure is thrown instead of reloading again', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  const load = vi.fn().mockRejectedValue(new TypeError('mạng rớt'));
  const Lazy = lazyPage(load);

  await expect(Lazy.preload()).rejects.toThrow('mạng rớt');
  expect(reload).not.toHaveBeenCalled();
});

test('a successful load clears the reload flag', async () => {
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  const Lazy = lazyPage(() => Promise.resolve({ default: Page }));
  await Lazy.preload();
  expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBeNull();
});
