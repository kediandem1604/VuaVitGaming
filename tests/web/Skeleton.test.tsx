import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { QueryState } from '../../src/web/components/QueryState';
import { Delayed, PageSkeleton, Skeleton, SkeletonCards, SkeletonRows } from '../../src/web/components/Skeleton';

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

test('placeholder data renders dimmed with aria-busy; fresh data clears it', () => {
  const { container, rerender } = render(
    <QueryState query={{ ...pending, data: ['cũ'], isPlaceholderData: true }}>{(rows) => <p>{rows.join()}</p>}</QueryState>,
  );
  const block = container.querySelector('.query-block');
  expect(block).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('cũ')).toBeInTheDocument();

  rerender(<QueryState query={{ ...pending, data: ['mới'], isPlaceholderData: false }}>{(rows) => <p>{rows.join()}</p>}</QueryState>);
  expect(container.querySelector('.query-block')).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByText('mới')).toBeInTheDocument();
});
