/**
 * Bộ `bird` (spec §4.2): mào lông trên đỉnh đầu, màu theo loài (`birdCrestColour`).
 * Vì không được vượt lên vùng bảng tên (y < 36) mà đỉnh đầu đã ở y 38, mào không dựng
 * đứng mà rẽ từ đỉnh thành ba túm: hai túm lớn ôm xuống hai bên đầu, một túm nhỏ rủ
 * trước trán. Mỗi túm là một `<path data-part="crest">` cùng màu để test đọc được.
 */

import { PALETTE } from '../../../lib/palette';
import { birdCrestColour, type KitRole } from '../../../lib/roleKits';
import { OUTLINE } from './shapes';

/** Mép trên của hai túm bên không xuống dưới y ≈ 37.6 (điểm điều khiển ở 37), nên viền không vượt y 36. */
const PLUME_LEFT = 'M62 41 C52 37 38 38 30 52 C38 48.5 48 50 58 51 Z';
const PLUME_RIGHT = 'M58 41 C68 37 82 38 90 52 C82 48.5 72 50 62 51 Z';
const PLUME_FRONT = 'M60 40 C55 40 50 45 52 55 C56 51 60 50.5 65 54 C68 45 65 40 60 40 Z';
/** Sống lông mảnh giữa mỗi túm để trông là lông chứ không phải dải vải. */
const RIB_LEFT = 'M58 46 C50 43.5 42 44 35 49';
const RIB_RIGHT = 'M62 46 C70 43.5 78 44 85 49';
const RIB_FRONT = 'M60 43 C57 46 56 49 56.5 52';

export function Bird({ role }: { role: KitRole }) {
  const colour = birdCrestColour(role.key);
  return (
    <>
      <path data-part="crest" d={PLUME_LEFT} fill={colour} {...OUTLINE} />
      <path data-part="crest" d={PLUME_RIGHT} fill={colour} {...OUTLINE} />
      <path data-part="crest" d={PLUME_FRONT} fill={colour} {...OUTLINE} />
      <g fill="none" stroke={PALETTE.ink} strokeWidth={1.5} strokeLinecap="round" opacity={0.6}>
        <path d={RIB_LEFT} />
        <path d={RIB_RIGHT} />
        <path d={RIB_FRONT} />
      </g>
    </>
  );
}
