/**
 * Bộ `crown` (spec §4.2): vương miện vàng ba chóp ôm đỉnh đầu, ba viên đá trên vành.
 * Chóp giữa chỉ tới y 38 (ngang đỉnh đầu) để không chạm vùng bảng tên.
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE } from './shapes';

/** Đá quý: hồng ngọc giữa, hai viên xanh ngọc hai bên. */
const RUBY = '#D62839';
const TOPAZ = '#3BB4F2';

const CROWN = 'M38 58 L38 50 L45 39 L52 48 L60 38 L68 48 L75 39 L82 50 L82 58 Z';

export function Crown() {
  return (
    <>
      <path d={CROWN} fill={PALETTE.gold} {...OUTLINE} />
      <circle cx={48} cy={54} r={2.6} fill={TOPAZ} stroke={PALETTE.ink} strokeWidth={1.5} />
      <circle cx={60} cy={54} r={2.8} fill={RUBY} stroke={PALETTE.ink} strokeWidth={1.5} />
      <circle cx={72} cy={54} r={2.6} fill={TOPAZ} stroke={PALETTE.ink} strokeWidth={1.5} />
    </>
  );
}
