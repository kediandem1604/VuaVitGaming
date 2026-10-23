/**
 * Bộ `detective` (spec §4.2): mũ phớt nâu (chóp tròn, dải băng tối, vành rộng) và kính
 * lúp vành vàng cầm ở cánh, giơ lên phía trên cánh.
 */

import { PALETTE } from '../../../lib/palette';
import { Grip, OUTLINE } from './shapes';

/** Màu riêng: nâu mũ, băng mũ tối hơn, mặt kính xanh nhạt. */
const HAT = '#8B5A2B';
const HAT_BAND = '#4A2E14';
const LENS = '#CDEBFF';

/** Chóp mũ ôm đỉnh đầu (đỉnh đầu y = 38), đáy chóp y = 54. */
const CROWN = 'M41 54 C41 44 45 38 60 38 C75 38 79 44 79 54 Z';

export function Detective() {
  return (
    <>
      <path d={CROWN} fill={HAT} {...OUTLINE} />
      <rect x={41.5} y={47} width={37} height={7} fill={HAT_BAND} stroke={PALETTE.ink} strokeWidth={2} />
      <ellipse cx={60} cy={54} rx={34} ry={4.5} fill={HAT} {...OUTLINE} />
      {/* Cán kính: nét ink dày rồi nét nâu mảnh hơn đè lên → cán nâu có viền. */}
      <path d="M95 126 L101 112" stroke={PALETTE.ink} strokeWidth={8} strokeLinecap="round" />
      <path d="M95 126 L101 112" stroke={HAT} strokeWidth={4.5} strokeLinecap="round" />
      <circle cx={105.5} cy={102} r={11} fill={PALETTE.gold} {...OUTLINE} />
      <circle cx={105.5} cy={102} r={7.5} fill={LENS} />
      <path d="M101 100 Q102.5 97 106 96.5" stroke={PALETTE.white} strokeWidth={1.6} strokeLinecap="round" fill="none" />
      <Grip angle={-65} />
    </>
  );
}
