import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { contrastRatio, PALETTE, type PaletteToken } from '../../src/web/lib/palette';

/**
 * Token màu của spec §3.1 — mỗi tên phải được khai báo là `--color-<tên>` trong
 * `styles.css` với đúng giá trị trong `PALETTE`. `white`, `discord`, `ink`, `beak`,
 * `wing` chỉ dùng trong SVG (TS) nên không cần token CSS.
 */
const TOKENS = [
  'night-950',
  'night-900',
  'night-800',
  'night-700',
  'night-600',
  'night-300',
  'night-200',
  'gold',
  'gold-ink',
  'goose',
  'duck',
  'third',
  'goose-strong',
  'duck-strong',
  'goose-soft',
  'duck-soft',
  'third-soft',
  'ok',
] as const satisfies readonly PaletteToken[];

// Môi trường jsdom cho `import.meta.url` dạng http, nên đi từ `__dirname` của vitest.
const stylesCss = readFileSync(resolve(__dirname, '../../src/web/styles.css'), 'utf8');

test('contrastRatio follows WCAG', () => {
  expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  expect(contrastRatio('#2A3070', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#2A3070'), 5);
});

test('styles.css declares every palette token with the same value', () => {
  for (const name of TOKENS) {
    const match = stylesCss.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`));
    expect(match, `styles.css thiếu --color-${name}`).not.toBeNull();
    expect(match?.[1]?.toLowerCase(), `--color-${name}`).toBe(PALETTE[name].toLowerCase());
  }
});

test.each<[PaletteToken, PaletteToken, number]>([
  ['white', 'night-800', 4.5],
  ['night-200', 'night-800', 4.5],
  ['night-300', 'night-800', 4.5],
  ['night-300', 'night-900', 4.5],
  ['gold-ink', 'gold', 4.5],
  ['gold', 'night-800', 4.5],
  ['white', 'goose-strong', 4.5],
  ['white', 'duck-strong', 4.5],
  ['white', 'third', 4.5],
  ['goose-soft', 'night-800', 4.5],
  ['duck-soft', 'night-800', 4.5],
  ['third-soft', 'night-800', 4.5],
  ['ok', 'night-800', 4.5],
  ['white', 'night-700', 4.5],
  ['white', 'discord', 4.5],
  ['night-600', 'night-800', 3],
  ['night-600', 'night-900', 3],
])('%s on %s reaches %s:1', (fg, bg, min) => {
  expect(contrastRatio(PALETTE[fg], PALETTE[bg])).toBeGreaterThanOrEqual(min);
});
