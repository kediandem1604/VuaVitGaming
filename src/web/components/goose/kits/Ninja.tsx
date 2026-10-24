/**
 * Bộ `ninja` (spec §4.2): khăn trùm kín đầu và mỏ, chỉ chừa một khe ngang cho mắt — khe
 * là lỗ thủng (even-odd) trong cùng một đường nên mắt của thân lộ qua, không vẽ lại mắt.
 * Nút thắt bên phải với hai đuôi khăn bay ra sau.
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE } from './shapes';

/** Vải khăn: `night-700` — đủ tối để ra ninja nhưng vẫn tách khỏi viền ink và nền thẻ. */
const CLOTH = PALETTE['night-700'];

/**
 * Lớp ngoài bám theo viền đầu của `GooseBody` (đỉnh y 38, cổ ±26 ở y 74, rộng tới ±33 ở
 * y 92) và võng xuống y ≈ 96.5 để phủ hết mỏ; lỗ khe mắt x 40–80, y 59–79 (mắt tâm y 69).
 */
const MASK =
  'M34 74 C34 56 41 38 60 38 C79 38 86 56 86 74 C86 80 89 86 92 92 Q60 101 28 92 C31 86 34 80 34 74 Z ' +
  'M44 59 L76 59 Q80 59 80 63 L80 75 Q80 79 76 79 L44 79 Q40 79 40 75 L40 63 Q40 59 44 59 Z';
const TAIL_UPPER = 'M82 60 C92 53 100 55 110 50 C106 59 98 64 86 66 Z';
const TAIL_LOWER = 'M83 64 C94 65 100 71 108 72 C100 76 92 74 85 70 Z';

export function Ninja() {
  return (
    <>
      <path d={TAIL_UPPER} fill={CLOTH} {...OUTLINE} />
      <path d={TAIL_LOWER} fill={CLOTH} {...OUTLINE} />
      <path data-part="mask" d={MASK} fillRule="evenodd" fill={CLOTH} {...OUTLINE} />
      <circle cx={85} cy={63} r={3.5} fill={CLOTH} {...OUTLINE} />
    </>
  );
}
