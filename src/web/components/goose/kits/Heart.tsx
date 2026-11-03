/**
 * Bộ `heart` (spec §4.2): tim đỏ to trên ngực (lớp trước) và đôi cánh thiên thần nhỏ
 * xoè ra hai bên lưng (lớp sau — gốc cánh nằm khuất dưới thân).
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE } from './shapes';

/** Hồng đỏ của tim — không phải đỏ phe Vịt. */
const HEART = '#EF476F';

const HEART_SHAPE = 'M60 130 C50 123 46 116 48 110 C50 105 57 105 60 110 C63 105 70 105 72 110 C74 116 70 123 60 130 Z';
/** Cánh trái ba lớp lông; gốc (32–33, 96–104) nằm trong thân nên bị thân che. */
const WING_LEFT = 'M32 96 C22 86 8 88 6 98 C12 98 14 103 10 109 C16 107 21 109 19 117 C25 115 29 110 33 104 Z';
const WING_RIGHT = 'M88 96 C98 86 112 88 114 98 C108 98 106 103 110 109 C104 107 99 109 101 117 C95 115 91 110 87 104 Z';

export function Heart() {
  return (
    <>
      <path d={HEART_SHAPE} fill={HEART} {...OUTLINE} />
      <ellipse cx={53} cy={112} rx={2.6} ry={1.8} transform="rotate(-35 53 112)" fill={PALETTE.white} opacity={0.85} />
    </>
  );
}

export function HeartWings() {
  return (
    <>
      <path d={WING_LEFT} fill={PALETTE.white} {...OUTLINE} />
      <path d={WING_RIGHT} fill={PALETTE.white} {...OUTLINE} />
    </>
  );
}
