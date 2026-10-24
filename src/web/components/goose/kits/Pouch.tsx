/**
 * Bộ `pouch` (spec §4.2): túi mỏ bồ nông phồng to treo dưới mỏ, phủ lên ngực, có đốm
 * sáng; một đuôi cá xanh thò ra bên phải túi cho dễ nhận.
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE } from './shapes';

/** Màu riêng: da túi sáng hơn mỏ một chút để tách khỏi mỏ, và cá. */
const POUCH = '#FFB84D';
const FISH = '#5DADE2';

/** Mép trên võng theo đáy mỏ (mỏ kết thúc y 95, túi phủ từ y ≈ 91), đáy túi y 120. */
const POUCH_SHAPE = 'M44 86 C37 98 39 118 60 120 C81 118 83 98 76 86 C70 93 50 93 44 86 Z';
const FISH_TAIL = 'M78 101 L89 94 L87 102 L90 109 Z';

export function Pouch() {
  return (
    <>
      <path d={FISH_TAIL} fill={FISH} {...OUTLINE} strokeWidth={2.5} />
      <path d={POUCH_SHAPE} fill={POUCH} {...OUTLINE} />
      <ellipse cx={50} cy={104} rx={3.5} ry={7} transform="rotate(18 50 104)" fill={PALETTE.white} opacity={0.4} />
    </>
  );
}
