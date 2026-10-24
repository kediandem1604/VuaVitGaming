/**
 * Bộ `bomb` (spec §4.2): quả bom tròn ôm ở cánh — thân tối có đốm sáng, nắp thép trên
 * đỉnh, ngòi uốn cong và ngọn lửa cam–vàng đang cháy.
 */

import { PALETTE } from '../../../lib/palette';
import { Grip, OUTLINE } from './shapes';

/** Thân bom `night-700`: "đen" nhưng vẫn nổi trên nền thẻ tối; nắp ngòi thép. */
const BOMB = PALETTE['night-700'];
const STEEL = '#C9CFDB';

const FUSE = 'M99 106 C99 100 104 98 106 94 C108 90 104 88 106 85';
const FLAME = 'M106 92 C100 86 102 80 106 77 C110 80 112 86 106 92 Z';
const FLAME_CORE = 'M106 90 C103.5 87 104 83 106 81 C108 83 108.5 87 106 90 Z';

export function Bomb() {
  return (
    <>
      <path d={FLAME} fill={PALETTE.beak} {...OUTLINE} />
      <path d={FLAME_CORE} fill={PALETTE.gold} />
      <path d={FUSE} fill="none" stroke={PALETTE.ink} strokeWidth={3} strokeLinecap="round" />
      <rect x={95} y={105} width={8} height={6} rx={1.5} fill={STEEL} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={99} cy={123} r={13} fill={BOMB} {...OUTLINE} />
      <ellipse cx={94} cy={117} rx={3.5} ry={2.5} transform="rotate(-35 94 117)" fill={PALETTE.white} opacity={0.6} />
      <Grip x={90} y={129} angle={30} />
    </>
  );
}
