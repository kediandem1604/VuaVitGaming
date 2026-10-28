import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { QueryState } from '../../src/web/components/QueryState';
import { Delayed, LoadingFallback, PageSkeleton, Skeleton, SkeletonCards, SkeletonRows } from '../../src/web/components/Skeleton';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const pending = { data: undefined, isError: false, error: null, refetch: () => Promise.resolve() };

test('Skeleton blocks are decorative and carry the shimmer class', () => {
  render(<Skeleton className="h-4 w-20" data-testid="sk" />);
  const block = screen.getByTestId('sk');
  expect(block).toHaveAttribute('aria-hidden', 'true');
  expect(block.className).toMatch(/\bskeleton\b/);
  expect(block.className).toMatch(/\bh-4\b/);
});

test('SkeletonRows, SkeletonCards and PageSkeleton render the requested shapes, all hidden from the tree', () => {
  const { container } = render(
    <>
      <SkeletonRows rows={3} />
      <SkeletonCards count={2} />
      <PageSkeleton />
    </>,
  );
  expect(container.querySelectorAll('[data-skeleton="rows"] .skeleton').length).toBeGreaterThanOrEqual(3);
  expect(container.querySelectorAll('[data-skeleton="cards"] > *')).toHaveLength(2);
  expect(container.querySelector('[data-skeleton="page"]')).not.toBeNull();
  for (const root of container.querySelectorAll('[data-skeleton]')) expect(root).toHaveAttribute('aria-hidden', 'true');
});

test('Delayed shows its children only after 150ms', () => {
  render(
    <Delayed>
      <p>muộn</p>
    </Delayed>,
  );
  expect(screen.queryByText('muộn')).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(149));
  expect(screen.queryByText('muộn')).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText('muộn')).toBeInTheDocument();
});

test('QueryState shows the default row skeleton after 150ms, not before', () => {
  const { container } = render(<QueryState query={pending}>{() => <p>dữ liệu</p>}</QueryState>);
  expect(container.querySelector('[data-skeleton]')).toBeNull();
  expect(screen.queryByText('Đang tải…')).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(150));
  expect(container.querySelector('[data-skeleton="rows"]')).not.toBeNull();
  // Khung xương ẩn khỏi cây truy cập; trình đọc màn hình nghe "Đang tải…" qua một dòng `status` ẩn.
  expect(screen.getByRole('status')).toHaveTextContent('Đang tải…');
  expect(screen.getByRole('status').className).toMatch(/\bsr-only\b/);
});

test('LoadingFallback announces loading only once its skeleton shows', () => {
  render(
    <LoadingFallback>
      <SkeletonRows />
    </LoadingFallback>,
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(150));
  expect(screen.getByRole('status')).toHaveTextContent('Đang tải…');
});

test('QueryState takes a custom skeleton', () => {
  const { container } = render(
    <QueryState query={pending} skeleton={<SkeletonCards count={4} />}>
      {() => <p>dữ liệu</p>}
    </QueryState>,
  );
  act(() => vi.advanceTimersByTime(150));
  expect(container.querySelector('[data-skeleton="cards"]')).not.toBeNull();
});

test('placeholder data dims the block and marks the nearest real container busy; fresh data clears it', () => {
  const view = (rows: string[], isPlaceholderData: boolean) => (
    <section data-testid="khung">
      <h2>Bảng</h2>
      <QueryState query={{ ...pending, data: rows, isPlaceholderData }}>{(r) => <p>{r.join()}</p>}</QueryState>
    </section>
  );
  const { container, rerender } = render(view(['cũ'], true));
  const block = container.querySelector('.query-block');
  // `display: contents` bị một số trình duyệt bỏ khỏi cây truy cập: `aria-busy` đặt ở `section`, khối chỉ mang dấu để mờ.
  expect(block).toHaveAttribute('data-busy', 'true');
  expect(block).not.toHaveAttribute('aria-busy');
  expect(screen.getByTestId('khung')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('cũ')).toBeInTheDocument();

  rerender(view(['mới'], false));
  expect(container.querySelector('.query-block')).toHaveAttribute('data-busy', 'false');
  expect(screen.getByTestId('khung')).not.toHaveAttribute('aria-busy');
  expect(screen.getByText('mới')).toBeInTheDocument();
});

test('two busy blocks in one container: it stays busy until both have fresh data', () => {
  const view = (a: boolean, b: boolean) => (
    <div role="tabpanel" data-testid="panel">
      <QueryState query={{ ...pending, data: 1, isPlaceholderData: a }}>{() => <p>a</p>}</QueryState>
      <QueryState query={{ ...pending, data: 2, isPlaceholderData: b }}>{() => <p>b</p>}</QueryState>
    </div>
  );
  const { rerender } = render(view(true, true));
  expect(screen.getByTestId('panel')).toHaveAttribute('aria-busy', 'true');
  rerender(view(false, true));
  expect(screen.getByTestId('panel')).toHaveAttribute('aria-busy', 'true');
  rerender(view(false, false));
  expect(screen.getByTestId('panel')).not.toHaveAttribute('aria-busy');
});
