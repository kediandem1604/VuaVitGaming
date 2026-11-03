/**
 * Bộ `pouch` (spec §4.2): túi mỏ bồ nông phồng to treo dưới mỏ, phủ lên ngực, có đốm
 * sáng; một đuôi cá xanh thò ra bên phải túi cho dễ nhận. Đội mũ thuyền trưởng trắng
 * lưỡi trai đen, huy hiệu mỏ neo vàng — "thuyền trưởng nuốt cả bến cảng".
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE } from './shapes';

const CAP = '#F4F6FB';
const CAP_BAND = '#1E2A4A';

/** Màu riêng: da túi sáng hơn mỏ một chút để tách khỏi mỏ, và cá. */
const POUCH = '#FFB84D';
const FISH = '#5DADE2';

/** Mép trên võng theo đáy mỏ (mỏ kết thúc y 95, túi phủ từ y ≈ 91), đáy túi y 120. */
const POUCH_SHAPE = 'M44 86 C37 98 39 118 60 120 C81 118 83 98 76 86 C70 93 50 93 44 86 Z';
const FISH_TAIL = 'M78 101 L89 94 L87 102 L90 109 Z';

/** Chóp mũ ôm đỉnh đầu (y 38) phồng ra hai bên, đáy y 54; lưỡi trai đen phía trước. */
const CAP_TOP = 'M36 50 C34 40 44 31 60 31 C76 31 86 40 84 50 Z';
const VISOR = 'M40 54 Q60 62 80 54 L80 51 Q60 56 40 51 Z';
const ANCHOR = 'M60 39.5 L60 47.5 M56.5 42 L63.5 42 M56 45 Q60 50 64 45';

export function Pouch() {
  return (
    <>
      <path d={CAP_TOP} fill={CAP} {...OUTLINE} />
      <rect x={39} y={48} width={42} height={6} fill={CAP_BAND} stroke={PALETTE.ink} strokeWidth={2} />
      <path d={VISOR} fill={PALETTE.ink} stroke={PALETTE.ink} strokeWidth={2} strokeLinejoin="round" />
      <path d={ANCHOR} fill="none" stroke={PALETTE.gold} strokeWidth={2.2} strokeLinecap="round" />
      <path d={FISH_TAIL} fill={FISH} {...OUTLINE} strokeWidth={2.5} />
      <path d={POUCH_SHAPE} fill={POUCH} {...OUTLINE} />
      <ellipse cx={50} cy={104} rx={3.5} ry={7} transform="rotate(18 50 104)" fill={PALETTE.white} opacity={0.4} />
    </>
  );
}
