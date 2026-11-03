import { cleanup, render, screen } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CHUNK_RELOAD_FLAG, RELOAD_WINDOW_MS, lazyPage } from '../../src/web/lib/lazyPage';
import { prefetchRoute, registerPrefetchRoute, resetPrefetchRegistry } from '../../src/web/lib/prefetch';

beforeEach(() => {
  sessionStorage.clear();
  resetPrefetchRegistry();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Page() {
  return <h1>Đã tới</h1>;
}

/** Bắt lỗi ném từ lazy để test thấy "ném lên" thay vì cả cây bị gỡ. */
class Catch extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children;
  }
}

function stubReload() {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  return reload;
}

function renderLazy(Lazy: ReturnType<typeof lazyPage>) {
  // Nuốt lỗi React in ra console khi lazy ném.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <Catch>
      <Suspense fallback={<p>khung xương</p>}>
        <Lazy />
      </Suspense>
    </Catch>,
  );
}

const failing = (message = 'Failed to fetch dynamically imported module') => vi.fn(() => Promise.reject(new Error(message)));

test('renders the fallback until the chunk arrives, then the page', async () => {
  let resolve: (mod: { default: typeof Page }) => void = () => undefined;
  const Lazy = lazyPage(() => new Promise<{ default: typeof Page }>((r) => (resolve = r)));
  renderLazy(Lazy);
  expect(screen.getByText('khung xương')).toBeInTheDocument();
  resolve({ default: Page });
  expect(await screen.findByRole('heading', { name: 'Đã tới' })).toBeInTheDocument();
});

test('a rejected import while rendering (any error type) reloads the page once and stores a timestamp', async () => {
  const reload = stubReload();
  // Server trả index.html cho chunk đã xoá → trình duyệt ném lỗi MIME/syntax, không phải 404: lỗi gì cũng tải lại.
  const Lazy = lazyPage(failing());
  const before = Date.now();
  renderLazy(Lazy);
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(Number(sessionStorage.getItem(CHUNK_RELOAD_FLAG))).toBeGreaterThanOrEqual(before);
  // Trong lúc chờ trình duyệt tải lại: vẫn giữ fallback, không ném lỗi lên trên.
  expect(screen.getByText('khung xương')).toBeInTheDocument();
});

// (a) Tải trước không bao giờ tải lại trang.
test('preload of a failing chunk rejects and never reloads; the next preload retries', async () => {
  const reload = stubReload();
  const load = failing('mạng rớt');
  const Lazy = lazyPage(load);

  await expect(Lazy.preload()).rejects.toThrow('mạng rớt');
  await expect(Lazy.preload()).rejects.toThrow('mạng rớt');
  expect(load).toHaveBeenCalledTimes(2);
  expect(reload).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBeNull();
});

test('hover prefetch of a failing chunk does not reload and is retried on the next intent', async () => {
  const reload = stubReload();
  const load = failing();
  const Lazy = lazyPage(load);
  registerPrefetchRoute('/dai-sanh', Lazy.preload);

  prefetchRoute('/dai-sanh');
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  // `.catch` của prefetch đã chạy (lời hứa có xong) → lần tỏ ý định sau thử lại.
  await new Promise((r) => setTimeout(r, 0));
  prefetchRoute('/dai-sanh');
  expect(load).toHaveBeenCalledTimes(2);
  expect(reload).not.toHaveBeenCalled();
});

test('render and preload share one import', async () => {
  const load = vi.fn(() => Promise.resolve({ default: Page }));
  const Lazy = lazyPage(load);
  await Lazy.preload();
  renderLazy(Lazy);
  expect(await screen.findByRole('heading', { name: 'Đã tới' })).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
});

// (b) Đã tải lại trong ~30 s → ném lỗi, không tải lại nữa; thành công khác không xoá dấu.
test('a failure within the reload window is thrown instead of reloading again', async () => {
  const reload = stubReload();
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now() - 5_000));
  renderLazy(lazyPage(failing('chunk vẫn hỏng')));
  expect(await screen.findByRole('alert')).toHaveTextContent('chunk vẫn hỏng');
  expect(reload).not.toHaveBeenCalled();
});

test('a failure after the reload window reloads again (a later deploy)', async () => {
  const reload = stubReload();
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now() - RELOAD_WINDOW_MS - 1_000));
  renderLazy(lazyPage(failing()));
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});

test('successful imports (nested or unrelated) do not clear the mark, so nested lazies cannot ping-pong', async () => {
  const reload = stubReload();
  const mark = String(Date.now() - 1_000);
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, mark);

  // Trang cha (vd AdminPage) tải được, tải trước một trang khác cũng được…
  const Parent = lazyPage(() => Promise.resolve({ default: Page }));
  await Parent.preload();
  renderLazy(Parent);
  await screen.findByRole('heading', { name: 'Đã tới' });
  expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBe(mark);
  cleanup();

  // …rồi chunk tab con hỏng: không tải lại lần nữa.
  renderLazy(lazyPage(failing('tab hỏng')));
  expect(await screen.findByRole('alert')).toHaveTextContent('tab hỏng');
  expect(reload).not.toHaveBeenCalled();
});

// (c) sessionStorage không dùng được → không bao giờ tải lại.
test('when sessionStorage throws on read, the error is thrown and the page is not reloaded', async () => {
  const reload = stubReload();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  renderLazy(lazyPage(failing('không có storage')));
  expect(await screen.findByRole('alert')).toHaveTextContent('không có storage');
  expect(reload).not.toHaveBeenCalled();
});

test('when sessionStorage cannot be written, the error is thrown and the page is not reloaded', async () => {
  const reload = stubReload();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  renderLazy(lazyPage(failing('không ghi được')));
  expect(await screen.findByRole('alert')).toHaveTextContent('không ghi được');
  expect(reload).not.toHaveBeenCalled();
});

test('when sessionStorage is missing entirely, the error is thrown and the page is not reloaded', async () => {
  const reload = stubReload();
  vi.stubGlobal('sessionStorage', undefined);
  renderLazy(lazyPage(failing('không có sessionStorage')));
  expect(await screen.findByRole('alert')).toHaveTextContent('không có sessionStorage');
  expect(reload).not.toHaveBeenCalled();
});

// Task 3 review: chuyển cảnh lần đầu vào trang lười không được chụp trang trống.
test('once preload has resolved, the first render does not suspend', async () => {
  const Lazy = lazyPage(() => Promise.resolve({ default: Page }));
  await Lazy.preload();
  render(
    <Suspense fallback={<p>khung xương</p>}>
      <Lazy />
    </Suspense>,
  );
  // Đồng bộ, không `findBy`: trang có ngay trong lần commit đầu (như trong `flushSync` của View Transition).
  expect(screen.getByRole('heading', { name: 'Đã tới' })).toBeInTheDocument();
  expect(screen.queryByText('khung xương')).not.toBeInTheDocument();
});

test('props reach the page whether it renders through lazy or directly', async () => {
  const Greet = ({ name }: { name: string }) => <p>Chào {name}</p>;
  const Lazy = lazyPage(() => Promise.resolve({ default: Greet }));
  render(
    <Suspense fallback={null}>
      <Lazy name="Ngỗng" />
    </Suspense>,
  );
  expect(await screen.findByText('Chào Ngỗng')).toBeInTheDocument();
  cleanup();
  render(<Lazy name="Vịt" />);
  expect(screen.getByText('Chào Vịt')).toBeInTheDocument();
});

test('a page first rendered through lazy keeps its state when the parent re-renders after the chunk arrived', async () => {
  const { useState: useLocalState } = await import('react');
  function Counter() {
    const [n, setN] = useLocalState(0);
    return <button onClick={() => setN(n + 1)}>đếm {n}</button>;
  }
  const Lazy = lazyPage(() => Promise.resolve({ default: Counter }));
  const view = render(
    <Suspense fallback={null}>
      <Lazy key="a" />
    </Suspense>,
  );
  (await screen.findByRole('button')).click();
  expect(await screen.findByRole('button', { name: 'đếm 1' })).toBeInTheDocument();
  view.rerender(
    <Suspense fallback={<p>x</p>}>
      <Lazy key="a" />
    </Suspense>,
  );
  expect(screen.getByRole('button', { name: 'đếm 1' })).toBeInTheDocument();
});
