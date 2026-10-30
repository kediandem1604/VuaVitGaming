/**
 * Bộ `clown` (spec §4.2): mũ hề hai màu với hai chóp mềm rủ sang hai bên, chuông vàng
 * ở đầu chóp, băng vàng dưới mũ; mũi đỏ tròn trên mỏ.
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE } from './shapes';

/** Màu riêng: hai màu vải mũ hề, đỏ mũi. */
const TEAL = '#1FB2A6';
const VIOLET = '#8B5CF6';
const NOSE = '#E63946';

const CAP_LEFT = 'M38 54 C38 42 46 38 60 38 L60 54 Z';
const CAP_RIGHT = 'M60 38 C74 38 82 42 82 54 L60 54 Z';
/** Hai chóp rủ ra ngoài đầu; mép trên không vượt quá y ≈ 38 (chừa vùng bảng tên). */
const PRONG_LEFT = 'M56 39 C44 37 30 39 26 50 C32 46 40 47 46 51 Z';
const PRONG_RIGHT = 'M64 39 C76 37 90 39 94 50 C88 46 80 47 74 51 Z';

export function Clown() {
  return (
    <>
      <path d={PRONG_LEFT} fill={VIOLET} {...OUTLINE} />
      <path d={PRONG_RIGHT} fill={TEAL} {...OUTLINE} />
      <path d={CAP_LEFT} fill={TEAL} {...OUTLINE} />
      <path d={CAP_RIGHT} fill={VIOLET} {...OUTLINE} />
      <circle cx={25} cy={51} r={3.5} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={95} cy={51} r={3.5} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.5} />
      <rect x={37} y={51} width={46} height={5.5} rx={2} fill={PALETTE.gold} {...OUTLINE} />
      <circle cx={60} cy={81} r={6} fill={NOSE} {...OUTLINE} />
      <circle cx={58} cy={79} r={1.8} fill={PALETTE.white} />
    </>
  );
}
