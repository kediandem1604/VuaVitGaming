import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Modal } from '../../src/web/components/Modal';
import { Presence } from '../../src/web/components/Presence';
import { Select } from '../../src/web/components/Select';
import { TabIndicator } from '../../src/web/components/TabIndicator';
import { EXIT_FALLBACK_MS, STAGGER_ROWS, STAGGER_TOTAL_MS, prefersReducedMotion, usePresence, useStaggerOnce } from '../../src/web/lib/motion';

/**
 * Bộ chuyển động thống nhất (spec §5): biến thời gian/nhịp trong styles.css và không còn số cứng;
 * lớp nổi có `data-state` mở/đóng và vẫn đóng được (gỡ khỏi DOM) kể cả khi máy giảm chuyển động;
 * tab có vạch chỉ báo theo tab đang chọn; danh sách chỉ so le lần hiện đầu (≤ 8 dòng).
 */

// Môi trường jsdom cho `import.meta.url` dạng http, nên đi từ `__dirname` của vitest.
const CSS = readFileSync(resolve(__dirname, '../../src/web/styles.css'), 'utf8');

/** Giả lập `matchMedia`: `reduce` = máy bật giảm chuyển động. */
function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Biến trong styles.css
// ---------------------------------------------------------------------------

test('styles.css declares the motion tokens with the values from spec §5', () => {
  expect(CSS).toMatch(/--dur-fast:\s*120ms/);
  expect(CSS).toMatch(/--dur-base:\s*200ms/);
  expect(CSS).toMatch(/--dur-slow:\s*320ms/);
  expect(CSS).toMatch(/--ease-out:\s*cubic-bezier\(0\.2,\s*0,\s*0,\s*1\)/);
  expect(CSS).toMatch(/--ease-in:\s*cubic-bezier\(0\.4,\s*0,\s*1,\s*1\)/);
  expect(CSS).toMatch(/--ease-spring:\s*cubic-bezier\(0\.34,\s*1\.4,\s*0\.64,\s*1\)/);
});

test('no transition or animation in styles.css uses a hard-coded duration', () => {
  // Mọi `transition:`/`animation:` phải lấy thời gian từ biến (mặc định `0s` của một biến thì được);
  // chỉ số trong `@keyframes` (phần trăm) không bị quét.
  const offenders = CSS.split('\n').flatMap((line, i) =>
    /\b(transition|animation)(-duration|-delay)?:/.test(line) && /(?<![\w.-])(?!0m?s\b)\d+(\.\d+)?m?s\b/.test(line) ? [`${i + 1}: ${line.trim()}`] : [],
  );
  expect(offenders).toEqual([]);
});

test('reduced motion collapses the slower tokens to the fast fade and keeps the row stagger at zero', () => {
  const reduce = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(reduce).toMatch(/--dur-base:\s*var\(--dur-fast\)/);
  expect(reduce).toMatch(/--dur-slow:\s*var\(--dur-fast\)/);
  expect(reduce).toMatch(/--stagger-step:\s*0ms/);
});

test('the list stagger only covers the first eight rows', () => {
  expect(STAGGER_ROWS).toBe(8);
  expect(CSS).toContain('.stagger-in > :nth-child(-n + 8)');
  expect(CSS).not.toContain(':nth-child(9)');
});

test('prefersReducedMotion follows matchMedia and is false without it', () => {
  vi.stubGlobal('matchMedia', undefined);
  expect(prefersReducedMotion()).toBe(false);
  stubMatchMedia(false);
  expect(prefersReducedMotion()).toBe(false);
  stubMatchMedia(true);
  expect(prefersReducedMotion()).toBe(true);
});

// ---------------------------------------------------------------------------
// usePresence: mở ngay, đóng thì giữ DOM trong lúc mờ ra rồi gỡ
// ---------------------------------------------------------------------------

test('usePresence keeps the element mounted in the closed state for the exit duration, then unmounts it', () => {
  const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: false } });
  expect(result.current).toEqual({ mounted: false, state: 'closed' });

  rerender({ open: true });
  expect(result.current).toEqual({ mounted: true, state: 'open' });

  rerender({ open: false });
  expect(result.current).toEqual({ mounted: true, state: 'closed' });

  act(() => vi.advanceTimersByTime(EXIT_FALLBACK_MS - 1));
  expect(result.current.mounted).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toEqual({ mounted: false, state: 'closed' });
});

test('usePresence reopening during the exit cancels the unmount', () => {
  const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: true } });
  rerender({ open: false });
  rerender({ open: true });
  act(() => vi.advanceTimersByTime(EXIT_FALLBACK_MS * 2));
  expect(result.current).toEqual({ mounted: true, state: 'open' });
});

test('usePresence still unmounts under reduced motion', () => {
  stubMatchMedia(true);
  const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: true } });
  rerender({ open: false });
  act(() => vi.advanceTimersByTime(EXIT_FALLBACK_MS));
  expect(result.current.mounted).toBe(false);
});

// ---------------------------------------------------------------------------
// Select: khung mang data-state, đóng thì ẩn khỏi cây truy cập ngay và gỡ sau khi mờ ra
// ---------------------------------------------------------------------------

const SEASONS = [{ options: [{ value: '2026-10', label: 'Tháng 10/2026' }, { value: '2026-09', label: 'Tháng 9/2026' }] }];

test('the Select popup opens with data-state=open and closes through data-state=closed before leaving the DOM', () => {
  render(<Select label="Mùa" value="2026-10" onChange={() => {}} groups={SEASONS} />);
  const trigger = screen.getByRole('combobox', { name: 'Mùa' });
  fireEvent.click(trigger);
  const popup = screen.getByRole('listbox').closest('[data-state]');
  expect(popup).toHaveAttribute('data-state', 'open');
  expect(popup).toHaveClass('layer-pop');

  fireEvent.keyDown(trigger, { key: 'Escape' });
  // Đang mờ ra: còn trong DOM nhưng đã ẩn với trình đọc màn hình và không nhận tương tác.
  expect(popup).toBeInTheDocument();
  expect(popup).toHaveAttribute('data-state', 'closed');
  expect(popup).toHaveAttribute('aria-hidden', 'true');
  expect(popup).toHaveAttribute('inert');
  expect(screen.queryByRole('listbox')).toBeNull();

  act(() => vi.advanceTimersByTime(EXIT_FALLBACK_MS));
  expect(popup).not.toBeInTheDocument();
});

test('the Select popup is gone after the exit even when the machine reduces motion', () => {
  stubMatchMedia(true);
  render(<Select label="Mùa" value="2026-10" onChange={() => {}} groups={SEASONS} />);
  const trigger = screen.getByRole('combobox', { name: 'Mùa' });
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: 'Escape' });
  act(() => vi.advanceTimersByTime(EXIT_FALLBACK_MS));
  expect(document.querySelector('[data-state]')).toBeNull();
});

// ---------------------------------------------------------------------------
// Modal trong Presence: nền và hộp có data-state; đóng thì trả tiêu điểm ngay rồi gỡ
// ---------------------------------------------------------------------------

function ModalHost() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Mở
      </button>
      <Presence present={open}>
        <Modal titleId="t" onClose={() => setOpen(false)}>
          <h2 id="t">Hộp</h2>
          <button type="button" onClick={() => setOpen(false)}>
            Đóng
          </button>
        </Modal>
      </Presence>
    </>
  );
}

test('a Modal inside Presence animates open, then fades out before unmounting and hands focus back at once', () => {
  render(<ModalHost />);
  const opener = screen.getByRole('button', { name: 'Mở' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'Hộp' });
  const backdrop = dialog.parentElement!;
  expect(dialog).toHaveAttribute('data-state', 'open');
  expect(backdrop).toHaveAttribute('data-state', 'open');
  expect(dialog.contains(document.activeElement)).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(backdrop).toBeInTheDocument();
  expect(backdrop).toHaveAttribute('data-state', 'closed');
  expect(backdrop).toHaveAttribute('inert');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(opener).toHaveFocus();

  act(() => vi.advanceTimersByTime(EXIT_FALLBACK_MS));
  expect(backdrop).not.toBeInTheDocument();
});

test('a Modal inside Presence still closes with reduced motion on', () => {
  stubMatchMedia(true);
  render(<ModalHost />);
  fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  act(() => vi.advanceTimersByTime(EXIT_FALLBACK_MS));
  expect(document.querySelector('[data-state]')).toBeNull();
});

// ---------------------------------------------------------------------------
// TabIndicator: vạch bám theo tab đang chọn
// ---------------------------------------------------------------------------

function Tabs() {
  const [picked, setPicked] = useState('a');
  return (
    <div role="tablist" className="relative">
      {['a', 'b'].map((key) => (
        <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={picked === key} onClick={() => setPicked(key)}>
          {key}
        </button>
      ))}
      <TabIndicator selectedId={`tab-${picked}`} />
    </div>
  );
}

test('the tab indicator is decorative and follows the selected tab', () => {
  render(<Tabs />);
  const bar = document.querySelector('[data-tab-indicator]')!;
  expect(bar).toHaveAttribute('aria-hidden', 'true');
  expect(bar).toHaveAttribute('data-for', 'tab-a');
  expect(bar).toHaveClass('tab-indicator');
  // Đo được ngay ở lần render đầu (không chờ bấm tab): có transform, không còn `opacity: 0` chờ đo.
  expect((bar as HTMLElement).style.transform).toMatch(/^translateX\(\d+px\) scaleX\(\d+\)$/);
  expect((bar as HTMLElement).style.opacity).toBe('');
  fireEvent.click(screen.getByRole('tab', { name: 'b' }));
  expect(bar).toHaveAttribute('data-for', 'tab-b');
  expect((bar as HTMLElement).style.transform).toMatch(/^translateX\(\d+px\) scaleX\(\d+\)$/);
});

// ---------------------------------------------------------------------------
// useStaggerOnce: lớp so le chỉ có ở lần hiện đầu
// ---------------------------------------------------------------------------

test('useStaggerOnce returns the stagger class only until the first stagger has played', () => {
  const { result, rerender } = renderHook(() => useStaggerOnce());
  expect(result.current).toBe('stagger-in');
  rerender();
  expect(result.current).toBe('stagger-in');
  act(() => vi.advanceTimersByTime(STAGGER_TOTAL_MS));
  expect(result.current).toBeUndefined();
  rerender();
  expect(result.current).toBeUndefined();
});
