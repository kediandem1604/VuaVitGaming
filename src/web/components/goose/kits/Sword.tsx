/**
 * Bộ `sword` (spec §4.2): kiếm dài cầm ở cánh (lưỡi thép, chắn tay và chuôi vàng) và
 * khăn đỏ buộc ngang trán, nút thắt bên phải với hai đuôi khăn bay ra sau.
 */

import { PALETTE } from '../../../lib/palette';
import { Grip, OUTLINE } from './shapes';

/** Màu riêng: vải khăn đỏ (không phải màu phe Vịt), thép lưỡi kiếm, cán bọc tối. */
const BANDANA = '#D62839';
const STEEL = '#D9DEE8';
const HANDLE = '#4A3B6B';

/** Khăn ôm vòng trán giữa y 54–60 (đầu rộng ±23 ở đó), hơi võng xuống ở giữa. */
const BAND = 'M36 54 Q60 57.5 84 54 L85 60 Q60 63.5 35 60 Z';
const TAIL_UPPER = 'M82 60 C92 52 100 54 108 48 C104 57 96 61 86 63 Z';
const TAIL_LOWER = 'M83 63 C94 64 100 69 108 69 C101 73 92 72 85 68 Z';

/** Lưỡi rộng 9, dài 52 tới mũi (0, −56); chắn tay rộng 20. */
const BLADE = 'M-4.5 -4 L-4.5 -48 L0 -56 L4.5 -48 L4.5 -4 Z';

export function Sword() {
  return (
    <>
      <path d={TAIL_UPPER} fill={BANDANA} {...OUTLINE} />
      <path d={TAIL_LOWER} fill={BANDANA} {...OUTLINE} />
      <path d={BAND} fill={BANDANA} {...OUTLINE} />
      <circle cx={85} cy={58} r={3.5} fill={BANDANA} {...OUTLINE} />
      <g transform="translate(97 126) rotate(14)">
        <rect x={-3} y={0} width={6} height={14} rx={2} fill={HANDLE} {...OUTLINE} />
        <circle cx={0} cy={16} r={3} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.5} />
        <path d={BLADE} fill={STEEL} {...OUTLINE} />
        <path d="M0 -8 L0 -46" stroke={PALETTE.white} strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
        <rect x={-10} y={-5} width={20} height={5} rx={1.5} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.5} />
      </g>
      <Grip x={95} y={124} angle={14} />
    </>
  );
}
