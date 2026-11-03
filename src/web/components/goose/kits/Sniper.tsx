/**
 * Bộ `sniper` (spec §4.2): súng trường dài có ống ngắm, cầm chéo trước thân — báng gỗ
 * ở dưới trái, nòng chĩa lên trên phải, cánh đỡ ở đoạn ốp lót. Vẽ trong toạ độ riêng
 * (nòng theo trục +x, gốc ở đế báng) rồi xoay −38°.
 */

import { PALETTE } from '../../../lib/palette';
import { Grip, OUTLINE } from './shapes';

/** Màu riêng: gỗ báng, thép xám súng, mặt kính ống ngắm. */
const STOCK = '#8B5A2B';
const GUNMETAL = '#5C6578';
const LENS = '#9ED0FF';

const STOCK_SHAPE = 'M0 -5 L0 6 L9 6 L22 2.5 L22 -4.5 Z';
const TRIGGER_GUARD = 'M30 2.5 Q30 8 36 8 Q40 8 40 2.5';

export function Sniper() {
  return (
    <>
      <g transform="translate(34 136) rotate(-38)">
        <path d={TRIGGER_GUARD} fill="none" stroke={PALETTE.ink} strokeWidth={2.5} strokeLinecap="round" />
        <path d={STOCK_SHAPE} fill={STOCK} {...OUTLINE} />
        <rect x={50} y={-3} width={44} height={4} rx={1} fill={GUNMETAL} {...OUTLINE} />
        <rect x={88} y={-3.5} width={6} height={5} rx={1} fill={GUNMETAL} {...OUTLINE} strokeWidth={2.5} />
        <rect x={22} y={-4.5} width={28} height={7} rx={1.5} fill={GUNMETAL} {...OUTLINE} />
        <rect x={34} y={-7} width={3} height={3} fill={GUNMETAL} stroke={PALETTE.ink} strokeWidth={2} />
        <rect x={46} y={-7} width={3} height={3} fill={GUNMETAL} stroke={PALETTE.ink} strokeWidth={2} />
        <rect x={30} y={-12} width={22} height={6} rx={3} fill={GUNMETAL} {...OUTLINE} />
        <ellipse cx={50.5} cy={-9} rx={1.6} ry={2.4} fill={LENS} />
      </g>
      <Grip x={84} y={101} angle={-38} />
    </>
  );
}
