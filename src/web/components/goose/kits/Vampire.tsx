/**
 * Bộ `vampire` (spec §4.2): áo choàng tím sẫm phủ sau lưng với cổ áo dựng cao lót đỏ
 * nhô lên hai bên đầu (lớp sau); phía trước là hai tà áo vắt qua vai, khoá áo vàng và
 * hai răng nanh trắng thò xuống dưới mỏ.
 */

import { PALETTE } from '../../../lib/palette';
import { OUTLINE } from './shapes';

/** Màu riêng: vải áo choàng tím sẫm (lệch khỏi `night-700` của bộ ninja) và lót đỏ. */
const CAPE = '#3D2B66';
const LINING = '#C1272D';

/** Thân áo xoè từ vai (y 82) xuống đất (y 146), rộng hơn thân mỗi bên ≈ 8–12. */
const CAPE_BODY = 'M32 82 C16 100 8 126 12 146 C30 150 90 150 108 146 C112 126 104 100 88 82 Z';
/** Cổ áo dựng: mũi nhọn ngoài đầu ở y 56, hai đỉnh còn lại nằm khuất trong thân. */
const COLLAR_LEFT = 'M30 86 L25 56 L48 70 Z';
const COLLAR_RIGHT = 'M90 86 L95 56 L72 70 Z';
const LAPEL_LEFT = 'M33 80 L46 92 L36 110 L28 96 Z';
const LAPEL_RIGHT = 'M87 80 L74 92 L84 110 L92 96 Z';
const FANG_LEFT = 'M50 92 L53.5 101 L57 92 Z';
const FANG_RIGHT = 'M63 92 L66.5 101 L70 92 Z';

export function Vampire() {
  return (
    <>
      <path d={LAPEL_LEFT} fill={CAPE} {...OUTLINE} />
      <path d={LAPEL_RIGHT} fill={CAPE} {...OUTLINE} />
      <circle cx={60} cy={106} r={3.5} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2} />
      <circle cx={60} cy={106} r={1.4} fill={LINING} />
      <path d={FANG_LEFT} fill={PALETTE.white} stroke={PALETTE.ink} strokeWidth={2} strokeLinejoin="round" />
      <path d={FANG_RIGHT} fill={PALETTE.white} stroke={PALETTE.ink} strokeWidth={2} strokeLinejoin="round" />
    </>
  );
}

export function VampireCape() {
  return (
    <>
      <path d={CAPE_BODY} fill={CAPE} {...OUTLINE} />
      <path d={COLLAR_LEFT} fill={LINING} {...OUTLINE} />
      <path d={COLLAR_RIGHT} fill={LINING} {...OUTLINE} />
    </>
  );
}
