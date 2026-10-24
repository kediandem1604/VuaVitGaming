/**
 * Bộ `engineer` (spec §4.2): mũ bảo hộ vàng (vòm có gờ giữa, vành trước ngắn) và cờ lê
 * thép cầm ở cánh, đầu mở chĩa lên trên.
 */

import { PALETTE } from '../../../lib/palette';
import { Grip, OUTLINE } from './shapes';

/** Thép cờ lê. */
const STEEL = '#C9CFDB';

const DOME = 'M36 54 C36 42 46 38 60 38 C74 38 84 42 84 54 Z';
const RIDGE = 'M55 54 L55 45 Q55 40 60 39.5 Q65 40 65 45 L65 54';

/**
 * Cờ lê trong toạ độ riêng, đầu hướng lên: đầu tròn bán kính 8 tâm (0, −2) khoét rãnh
 * rộng 5 từ đỉnh, cán rộng 7 dài tới y 36, bo tròn đáy — một đường kín để viền liền mạch.
 */
const WRENCH =
  'M-2.5 -9.6 A8 8 0 0 0 -3.5 5.2 L-3.5 32 Q-3.5 36 0 36 Q3.5 36 3.5 32 L3.5 5.2 A8 8 0 0 0 2.5 -9.6 L2.5 -3 L-2.5 -3 Z';

export function Engineer() {
  return (
    <>
      <path d={DOME} fill={PALETTE.gold} {...OUTLINE} />
      <path d={RIDGE} fill="none" stroke={PALETTE.ink} strokeWidth={2.5} strokeLinecap="round" />
      <ellipse cx={60} cy={54} rx={30} ry={4} fill={PALETTE.gold} {...OUTLINE} />
      <g transform="translate(104 107.7) rotate(30)">
        <path d={WRENCH} fill={STEEL} {...OUTLINE} />
        <path d="M-0.5 6 L-0.5 30" stroke={PALETTE.white} strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
      </g>
      <Grip angle={30} />
    </>
  );
}
