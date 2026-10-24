/**
 * Bộ `knife` (spec §4.2): dao cầm ở cánh — lưỡi thép mũi nhọn chĩa lên, cán nâu, chuôi
 * nằm trong "tay" cánh. Vẽ trong toạ độ riêng (lưỡi hướng lên theo trục y) rồi xoay
 * 22° và đặt vào mút cánh.
 */

import { PALETTE } from '../../../lib/palette';
import { Grip, OUTLINE } from './shapes';

/** Màu riêng của vật: thép lưỡi dao và gỗ cán. */
const STEEL = '#D9DEE8';
const HANDLE = '#5A3B23';

/** Lưỡi: sống thẳng bên phải, lưỡi cong về mũi nhọn (3, −37); rộng 10 để còn đọc được ở 72px. */
const BLADE = 'M-5 -1 L-5 -24 Q-4 -32 3 -37 L5 -31 L5 -1 Z';

export function Knife() {
  return (
    <>
      <g transform="translate(96 124) rotate(22)">
        <rect x={-4} y={0} width={8} height={16} rx={2.5} fill={HANDLE} {...OUTLINE} />
        <path d={BLADE} fill={STEEL} {...OUTLINE} />
        <rect x={-7} y={-3} width={14} height={4} rx={1.5} fill={PALETTE.ink} />
        <path d="M1.5 -6 L1.5 -27" stroke={PALETTE.white} strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
      </g>
      <Grip angle={22} />
    </>
  );
}
