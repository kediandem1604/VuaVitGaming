/**
 * Bộ `explorer` (spec §4.2): mũ thám hiểm xanh rêu vành rộng (lớp trước) và ba lô nâu
 * đeo sau lưng, ló ra bên trái thân cùng cuộn chăn trên nóc (lớp sau); hai quai ba lô
 * vắt qua ngực ở lớp trước.
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE } from './shapes';

/** Màu riêng: xanh rêu mũ và băng mũ tối hơn, nâu ba lô và nắp, vải chăn. */
const HAT = '#6B8E3D';
const HAT_BAND = '#4B6A2A';
const PACK = '#8B5E3C';
const PACK_FLAP = '#6B4226';
const BEDROLL = '#D9B382';

const DOME = 'M38 55 C38 44 46 38 60 38 C74 38 82 44 82 55 Z';
const PACK_LID = 'M8 102 L8 94 Q8 86 16 86 L32 86 Q40 86 40 94 L40 102 Z';
/** Quai ba lô: nét ink dày rồi nét nâu đè lên; nằm trong thân (mép trái thân x ≈ 33 → 20 từ y 82 → 124). */
const STRAP_LEFT = 'M42 82 C36 94 30 108 30 124';
const STRAP_RIGHT = 'M78 82 C84 94 88 108 88 124';

function Strap({ d }: { d: string }) {
  return (
    <>
      <path d={d} fill="none" stroke={PALETTE.ink} strokeWidth={7} strokeLinecap="round" />
      <path d={d} fill="none" stroke={PACK_FLAP} strokeWidth={3.5} strokeLinecap="round" />
    </>
  );
}

export function Explorer() {
  return (
    <>
      <Strap d={STRAP_LEFT} />
      <Strap d={STRAP_RIGHT} />
      <path d={DOME} fill={HAT} {...OUTLINE} />
      <rect x={38} y={45} width={44} height={6} fill={HAT_BAND} stroke={PALETTE.ink} strokeWidth={2} />
      <ellipse cx={60} cy={55} rx={36} ry={5.5} fill={HAT} {...OUTLINE} />
    </>
  );
}

export function ExplorerPack() {
  return (
    <>
      <rect x={4} y={79} width={30} height={9} rx={4.5} fill={BEDROLL} {...OUTLINE} />
      <rect x={8} y={86} width={32} height={44} rx={9} fill={PACK} {...OUTLINE} />
      <path d={PACK_LID} fill={PACK_FLAP} {...OUTLINE} />
      <circle cx={15} cy={108} r={2.5} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.5} />
    </>
  );
}
