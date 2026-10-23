/**
 * Bộ `police` (spec §4.2): mũ kê-pi xanh đậm (chóp, băng tối, lưỡi trai đen, phù hiệu
 * vàng) và huy hiệu ngôi sao vàng to trên ngực.
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE, starPath } from './shapes';

/** Màu riêng: xanh mũ cảnh sát (không phải xanh phe Ngỗng) và băng mũ tối hơn. */
const CAP = '#2E4A8F';
const CAP_BAND = '#1C2F5E';

const CROWN = 'M38 51 C38 41 47 38 60 38 C73 38 82 41 82 51 Z';
/** Lưỡi trai dưới băng mũ, võng tới y ≈ 61 — mắt bắt đầu từ y 62.5. */
const VISOR = 'M40 56 C44 63 76 63 80 56 Z';
const STAR = starPath(60, 118, 12, 5.2);

export function Police() {
  return (
    <>
      <path d={CROWN} fill={CAP} {...OUTLINE} />
      <rect x={36} y={50} width={48} height={6} fill={CAP_BAND} {...OUTLINE} />
      <path d={VISOR} fill={PALETTE.ink} {...OUTLINE} />
      <circle cx={60} cy={45} r={4} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2} />
      <path d={STAR} fill={PALETTE.gold} {...OUTLINE} />
      <circle cx={60} cy={118} r={2.2} fill={PALETTE['gold-ink']} />
    </>
  );
}
