/**
 * Bảng màu "Sảnh đêm" (spec §3.1). Đây là nguồn sự thật cho code TS (SVG nhân vật,
 * meta theme-color…); `styles.css` khai báo lại cùng giá trị dưới dạng `--color-<tên>`
 * trong `@theme`, và test `tests/web/palette.test.ts` giữ hai bên khớp nhau.
 *
 * Màu phe (`goose`, `duck`, `third`) giữ nguyên theo Global Constraints. Chữ trắng
 * không đặt thẳng lên `goose`/`duck` (chỉ ~3.9:1) mà lên bản `-strong`; chữ màu phe
 * trên nền tối dùng bản `-soft`.
 */

export const PALETTE = {
  'night-950': '#0E1130',
  'night-900': '#1B1F4A',
  'night-800': '#2A3070',
  'night-700': '#3A4180',
  'night-600': '#7680D4',
  'night-300': '#AEB6FF',
  'night-200': '#D6DAFF',
  gold: '#FFD23F',
  'gold-ink': '#3A2600',
  goose: '#2F80ED',
  duck: '#E5484D',
  third: '#8E4EC6',
  'goose-strong': '#1F6FD6',
  'duck-strong': '#C9353A',
  'goose-soft': '#7CB8FF',
  'duck-soft': '#FF8A8F',
  'third-soft': '#C9A2F2',
  ok: '#7CF29A',
  // Màu nút Discord ở trang Đăng nhập — có token CSS `--color-discord` (lớp `bg-discord`).
  discord: '#5865F2',
  // Màu vẽ nhân vật (spec §4.1) — chỉ dùng trong TS/SVG, không có token CSS.
  ink: '#231A3A',
  beak: '#FF9F1C',
  wing: '#E6E2F0',
  white: '#FFFFFF',
} as const;

export type PaletteToken = keyof typeof PALETTE;

/** Độ chói tương đối (WCAG 2.x) của một màu `#rrggbb`. */
function relativeLuminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Màu không hợp lệ (cần dạng #rrggbb): ${hex}`);
  const value = Number.parseInt(match[1] as string, 16);
  const [r, g, b] = [16, 8, 0].map((shift) => {
    const channel = ((value >> shift) & 0xff) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Tỉ lệ tương phản WCAG 2.x giữa hai màu (1 → 21), không phụ thuộc thứ tự tham số.
 * Chữ thường cần ≥ 4.5:1; chữ lớn, icon và viền ô nhập liệu cần ≥ 3:1.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
