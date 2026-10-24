/**
 * Mảnh dùng chung cho các bộ đồ: nét viền chuẩn, đường ngôi sao, và chỗ cánh nắm vật
 * cầm tay. Toạ độ theo khung `0 0 120 160` của `Character`; mút cánh (nơi cầm đồ) ở
 * khoảng (94, 125) — xem `GooseBody`.
 */

import { PALETTE } from '../../../lib/palette';

/** Nét viền chung của bộ đồ (spec §4.1): `ink` dày 3, góc và đầu nét bo tròn. */
export const OUTLINE = {
  stroke: PALETTE.ink,
  strokeWidth: 3,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
} as const;

const round = (n: number) => Math.round(n * 10) / 10;

/** Đường ngôi sao `points` cánh, một đỉnh hướng thẳng lên, tâm (cx, cy), bán kính ngoài/trong. */
export function starPath(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  const step = Math.PI / points;
  const vertices: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + i * step;
    vertices.push(`${round(cx + r * Math.cos(angle))} ${round(cy + r * Math.sin(angle))}`);
  }
  return `M${vertices.join(' L')} Z`;
}

/**
 * Chỗ cánh nắm vật cầm tay: một elip màu cánh đè lên cán, xoay theo hướng vật, để vật
 * trông như được cánh giữ chứ không dán lên thân. Vẽ sau vật.
 */
export function Grip({ x = 94, y = 125, angle = 0 }: { x?: number; y?: number; angle?: number }) {
  return (
    <ellipse cx={x} cy={y} rx={6.5} ry={5} transform={`rotate(${angle} ${x} ${y})`} fill={PALETTE.wing} {...OUTLINE} />
  );
}
