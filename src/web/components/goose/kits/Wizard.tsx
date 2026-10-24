/**
 * Bộ `wizard` (spec §4.2): mũ phù thuỷ tím nhọn, chóp cong nghiêng sang phải và được
 * phép nhô lên tới y ≈ 30 (brief Task 4), vành tròn rộng, một ngôi sao vàng to và hai
 * đốm sao nhỏ trên chóp.
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE, starPath } from './shapes';

/** Tím mũ — cố ý lệch khỏi tím phe thứ 3 (`third`) để không gợi phe. */
const HAT = '#5E48C9';

/**
 * Chóp: đáy 38–82 (đúng bề rộng đầu ở y 52), mép trái vươn lên rồi ngoặt sang phải tới
 * đỉnh cong (78, 33.5) — điểm điều khiển thấp nhất y 30.5 nên viền chạm y ≈ 29.5 —
 * rồi mép phải đổ xuống.
 */
const CONE = 'M38 52 C44 46 58 36 72 31 C75 30.5 79 30.5 78 33.5 C73 38 75 46 82 52 Z';
const STAR = starPath(60, 42, 5.5, 2.4);

export function Wizard() {
  return (
    <>
      <path d={CONE} fill={HAT} {...OUTLINE} />
      <path d={STAR} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={70} cy={36} r={1.6} fill={PALETTE.gold} />
      <circle cx={50} cy={47.5} r={1.6} fill={PALETTE.gold} />
      <ellipse cx={60} cy={52} rx={31} ry={5} fill={HAT} {...OUTLINE} />
    </>
  );
}
