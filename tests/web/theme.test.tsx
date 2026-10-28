import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { HalloweenDecor, ThemeToggle } from '../../src/web/components/HalloweenDecor';
import { RankAvatar } from '../../src/web/components/RankAvatar';
import { contrastRatio } from '../../src/web/lib/palette';
import { setTheme, THEME_KEY } from '../../src/web/lib/theme';

/**
 * Chủ đề Halloween: nút bật/tắt đổi `data-theme` của `<html>` và nhớ trong `localStorage`, lớp
 * trang trí chỉ có khi bật, bộ màu Halloween giữ đủ tương phản như Sảnh đêm. Khung avatar Top 1-2-3.
 */

const CSS = readFileSync(resolve(__dirname, '../../src/web/styles.css'), 'utf8');

afterEach(() => {
  cleanup();
  setTheme('night');
  localStorage.clear();
});

test('the toggle switches the Halloween theme on and off and remembers it', () => {
  render(
    <>
      <ThemeToggle />
      <HalloweenDecor />
    </>,
  );
  const toggle = screen.getByRole('button', { name: 'Chủ đề Halloween' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(document.querySelector('.hw-decor')).toBeNull();

  fireEvent.click(toggle);
  expect(document.documentElement.dataset.theme).toBe('halloween');
  expect(localStorage.getItem(THEME_KEY)).toBe('halloween');
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(document.querySelector('.hw-decor')).toHaveAttribute('aria-hidden', 'true');

  fireEvent.click(toggle);
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(localStorage.getItem(THEME_KEY)).toBe('night');
  expect(document.querySelector('.hw-decor')).toBeNull();
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

test('rank 4 and below is a plain avatar', () => {
  render(<RankAvatar rank={4} name="Kẹ" url={null} />);
  expect(document.querySelector('.rank-frame')).toBeNull();
  expect(document.body).toHaveTextContent('K');
});
