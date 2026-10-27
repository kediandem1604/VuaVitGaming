import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { contrastRatio, PALETTE, type PaletteToken } from '../../src/web/lib/palette';

/**
 * Token màu của spec §3.1 — mỗi tên phải được khai báo là `--color-<tên>` trong
 * `styles.css` với đúng giá trị trong `PALETTE` (kể cả `discord`, màu nút đăng nhập).
 * `white`, `ink`, `beak`, `wing` chỉ dùng trong SVG (TS) nên không cần token CSS.
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
  'discord',
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

/** Phần khai báo `@utility btn { … }` trong styles.css (tới utility kế tiếp). */
const btnUtility = stylesCss.slice(stylesCss.indexOf('@utility btn {'), stylesCss.indexOf('@utility btn-primary'));

/** Màu `#rrggbb` phủ một lớp đen có độ mờ `alpha` (tối đi `alpha`, như trình duyệt trộn trong sRGB). */
function darken(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [16, 8, 0].map((shift) => Math.round(((value >> shift) & 0xff) * (1 - alpha)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

test.each<[PaletteToken, PaletteToken]>([
  ['white', 'discord'],
  ['white', 'duck-strong'],
  ['gold-ink', 'gold'],
  ['white', 'night-700'],
])('button hover darkens only the fill: %s on hovered %s still reaches 4.5:1', (fg, bg) => {
  // `filter` (sáng hay tối) đổi luôn màu chữ — hover phải là lớp phủ đen trên nền, dưới chữ.
  expect(btnUtility).toContain('&:hover:not(:disabled)');
  expect(btnUtility).not.toMatch(/filter:\s*brightness/);
  const overlay = /background-image:\s*linear-gradient\(rgb\(0 0 0 \/ ([\d.]+)\)/.exec(btnUtility);
  expect(overlay, 'hover của btn phải là lớp phủ đen rgb(0 0 0 / a)').not.toBeNull();
  const alpha = Number(overlay?.[1]);
  expect(alpha).toBeGreaterThan(0);
  expect(contrastRatio(PALETTE[fg], darken(PALETTE[bg], alpha))).toBeGreaterThanOrEqual(4.5);
});

test('a disabled field looks disabled yet keeps readable text and a visible boundary', () => {
  const field = stylesCss.slice(stylesCss.indexOf('@utility field {'), stylesCss.indexOf('@utility chip'));
  const disabled = /&:disabled\s*\{([^}]*)\}/.exec(field)?.[1] ?? '';
  expect(disabled).toMatch(/\bbg-night-800\b/);
  expect(disabled).toMatch(/\btext-night-300\b/);
  expect(disabled).toMatch(/\bcursor-not-allowed\b/);
  // Viền `night-600` của ô (không bị đè khi tắt) vẫn ≥ 3:1 trên nền tắt và trên panel.
  expect(disabled).not.toMatch(/\bborder-/);
  // `<select>` gốc: luật mũi tên (`:is(select…)`) đặc hiệu hơn `&:disabled` nên con trỏ phải nhắc lại cho ô tắt.
  expect(/&:is\(select:not\(\[multiple\]\):not\(\[size\]\):disabled\)\s*\{([^}]*)\}/.exec(field)?.[1]).toMatch(/\bcursor-not-allowed\b/);
  expect(contrastRatio(PALETTE['night-300'], PALETTE['night-800'])).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(PALETTE['night-600'], PALETTE['night-800'])).toBeGreaterThanOrEqual(3);
});
