import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CALLBACK_FALLBACK_MS, useDisplayedLocation } from '../../src/web/lib/viewTransition';
import { registerPrefetchRoute, resetPrefetchRegistry } from '../../src/web/lib/prefetch';

/**
 * Chuyển trang bằng View Transitions (spec §5.1): chỉ khi đổi `pathname` (không khi chỉ đổi
 * query string), chỉ khi trình duyệt có `document.startViewTransition` và máy không giảm chuyển
 * động; điều hướng dồn dập (Back nhanh) thì vị trí hiển thị cuối cùng luôn là vị trí mới nhất.
 */

type StartVT = (cb: () => void) => { finished: Promise<void> };
const doc = document as Document & { startViewTransition?: StartVT };

/** `startViewTransition` giả: chạy callback ở microtask kế tiếp như trình duyệt thật (chụp xong khung cũ mới cập nhật). */
function stubViewTransition() {
  const start = vi.fn((cb: () => void) => {
    const finished = Promise.resolve().then(cb);
    return { finished };
  });
  doc.startViewTransition = start as unknown as StartVT;
  return start;
}

function Harness() {
  const displayed = useDisplayedLocation();
  const navigate = useNavigate();
  const real = useLocation();
  return (
    <div>
      <output data-testid="displayed">{displayed.pathname + displayed.search}</output>
      <output data-testid="real">{real.pathname + real.search}</output>
      <button type="button" onClick={() => navigate('/a?x=1')}>
        search
      </button>
      <button type="button" onClick={() => navigate('/b')}>
        b
      </button>
      <button type="button" onClick={() => navigate('/c')}>
        c
      </button>
    </div>
  );
}

const shown = () => screen.getByTestId('displayed').textContent;

function renderAt(path = '/a') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Chờ các microtask (chunk sẵn sàng + callback của transition). */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

beforeEach(() => {
  resetPrefetchRegistry();
  vi.stubGlobal('matchMedia', undefined);
});
afterEach(() => {
  cleanup();
  delete doc.startViewTransition;
  vi.unstubAllGlobals();
});

test('without startViewTransition the displayed location follows the router immediately', () => {
  renderAt();
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  expect(shown()).toBe('/b');
});

test('a query-string-only change never starts a view transition', async () => {
  const start = stubViewTransition();
  renderAt();
  fireEvent.click(screen.getByRole('button', { name: 'search' }));
  expect(shown()).toBe('/a?x=1');
  await settle();
  expect(start).not.toHaveBeenCalled();
});

test('a pathname change runs inside startViewTransition and the new page shows when its callback runs', async () => {
  const start = stubViewTransition();
  renderAt();
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  // Router đã đổi, màn hình còn giữ trang cũ tới khi transition chụp xong khung cũ.
  expect(screen.getByTestId('real').textContent).toBe('/b');
  expect(shown()).toBe('/a');
  await settle();
  expect(start).toHaveBeenCalledTimes(1);
  expect(shown()).toBe('/b');
});

test('with reduced motion the pathname change skips the view transition', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
  const start = stubViewTransition();
  renderAt();
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  expect(shown()).toBe('/b');
  await settle();
  expect(start).not.toHaveBeenCalled();
});

test('rapid navigations end on the latest location even when earlier transitions are superseded', async () => {
  stubViewTransition();
  renderAt();
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  fireEvent.click(screen.getByRole('button', { name: 'c' }));
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  await settle();
  expect(shown()).toBe('/b');
  expect(screen.getByTestId('real').textContent).toBe('/b');
});

test('when the transition never runs its callback (hidden tab, aborted transition) the page still updates after the fallback', async () => {
  // Transition giả: nhận callback nhưng không bao giờ gọi, và `ready` bị huỷ như Chrome khi tab ẩn.
  const start = vi.fn(() => ({ ready: Promise.reject(new DOMException('invalid state', 'InvalidStateError')), finished: Promise.resolve() }));
  doc.startViewTransition = start as unknown as StartVT;
  renderAt();
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  await settle();
  expect(start).toHaveBeenCalledTimes(1);
  expect(shown()).toBe('/a');
  await act(() => new Promise<void>((r) => setTimeout(r, CALLBACK_FALLBACK_MS + 20)));
  expect(shown()).toBe('/b');
});

test('a startViewTransition that throws falls back to a plain update', async () => {
  doc.startViewTransition = (() => {
    throw new DOMException('invalid state', 'InvalidStateError');
  }) as unknown as StartVT;
  renderAt();
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  await settle();
  expect(shown()).toBe('/b');
});

test('the transition waits for the target chunk (bounded) so the new snapshot is not a blank page', async () => {
  const start = stubViewTransition();
  let resolveChunk = () => {};
  registerPrefetchRoute('/b', () => new Promise<void>((r) => (resolveChunk = r)));
  renderAt();
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  await settle();
  expect(start).not.toHaveBeenCalled();
  expect(shown()).toBe('/a');
  resolveChunk();
  await settle();
  expect(start).toHaveBeenCalledTimes(1);
  expect(shown()).toBe('/b');
});
