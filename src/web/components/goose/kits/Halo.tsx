/**
 * Bộ `halo` (spec §4.2): vòng hào quang vàng đậu trên đỉnh đầu — vòng elip viền ink
 * với lõi vàng, một quầng vàng mờ phía sau và hai tia sáng nhỏ hai bên. Được phép nhô
 * tới y ≈ 30 (brief Task 4); vòng nằm từ y 29 tới 43.
 */

import { PALETTE } from '../../../lib/palette';
import { starPath } from './shapes';

const SPARK_LEFT = starPath(33, 45, 3.2, 1.2, 4);
const SPARK_RIGHT = starPath(89, 43, 3.2, 1.2, 4);

export function Halo() {
  return (
    <>
      <ellipse cx={60} cy={36} rx={23} ry={6} fill={PALETTE.gold} opacity={0.22} />
      <ellipse cx={60} cy={36} rx={19} ry={3.5} fill="none" stroke={PALETTE.ink} strokeWidth={7} />
      <ellipse cx={60} cy={36} rx={19} ry={3.5} fill="none" stroke={PALETTE.gold} strokeWidth={3.5} />
      <path d={SPARK_LEFT} fill={PALETTE.gold} />
      <path d={SPARK_RIGHT} fill={PALETTE.gold} />
    </>
  );
}
