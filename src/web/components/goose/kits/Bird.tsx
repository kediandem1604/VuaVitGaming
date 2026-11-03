/**
 * Bộ `bird` (spec §4.2) — các loài chim, phần lớn là phe thứ 3. Mỗi loài một bộ riêng:
 * màu thân/mắt/mỏ do `bodyLook` (roleKits.ts) tô lên `GooseBody`, còn ở đây là đồ mặc
 * (lớp trước) và cánh/đuôi/áo choàng sau lưng (lớp sau, `BirdBack`). Mỗi bộ có đúng một
 * phần "điểm nhấn" mang `data-part="crest"` tô màu `birdCrestColour` của loài (mào, băng đô,
 * cổ lông…) để test đọc được. Loài không có bộ riêng (chim admin thêm sau) dùng ba túm mào.
 *
 * Không vẽ lên vùng bảng tên: mọi phần giữ y ≥ 29 như `wizard`/`halo`.
 */

import type { ReactNode } from 'react';
import { PALETTE } from '../../../lib/palette';
import { bodyLook, birdCrestColour, type KitRole } from '../../../lib/roleKits';
import { Grip, OUTLINE, starPath } from './shapes';

type Art = (props: { crest: string; wing: string }) => ReactNode;

const STEEL = '#D9DEE8';
const WOOD = '#6B4423';
const DARK = '#1E1B2B';

/** Phản chiếu một phần sang bên phải thân (trục x = 60). */
const MIRROR = 'translate(120 0) scale(-1 1)';

// ---------------------------------------------------------------------------
// Mảnh sau lưng dùng chung
// ---------------------------------------------------------------------------

/** Cánh xoè nhọn của chim săn mồi (bên trái; bên phải là bản phản chiếu). */
const WING_SWEPT =
  'M36 96 C26 84 14 72 3 50 C12 55 19 58 26 60 C18 66 14 72 11 80 C18 78 23 80 28 82 C21 89 18 97 18 106 C24 102 29 103 34 108 Z';
/** Cánh rách tả tơi (kền kền, quạ). */
const WING_RAGGED = 'M36 94 C28 80 16 68 2 54 L12 62 L7 69 L17 73 L11 81 L21 85 L15 95 L25 97 L21 107 L34 107 Z';
/** Đuôi xoè phía sau, ló ra bên trái dưới bụng. */
const TAIL = 'M30 132 C18 136 8 132 4 124 C10 123 14 121 17 118 C10 115 7 109 7 102 C14 106 20 109 26 110 Z';
/** Đuôi cụt tròn của đa đa. */
const TAIL_STUB = 'M28 132 C18 136 10 130 10 122 C16 124 20 122 22 118 C18 114 18 108 22 104 C26 110 30 114 32 118 Z';
/** Đuôi dài thẳng (ác là, cò gáy). */
const TAIL_LONG = 'M30 128 L2 142 C0 136 2 132 6 128 L28 114 Z';

function Wings({ d, fill }: { d: string; fill: string }) {
  return (
    <>
      <path d={d} fill={fill} {...OUTLINE} />
      <path d={d} fill={fill} transform={MIRROR} {...OUTLINE} />
    </>
  );
}

/** Vải áo choàng dài phủ sau lưng (bồ câu, quạ đen). */
const CLOAK = 'M33 84 C20 104 13 128 16 148 C36 153 84 153 104 148 C107 128 100 104 87 84 Z';

// ---------------------------------------------------------------------------
// Từng loài
// ---------------------------------------------------------------------------

/** Đa đa: kính râm đen, dây chuyền vàng, chùm lông xoăn — "vote tôi đi". */
const Dodo: Art = ({ crest }) => (
  <>
    <path data-part="crest" d="M50 42 C47 33 57 29 60 35 C62 28 72 31 70 41 C64 38 56 38 50 42 Z" fill={crest} {...OUTLINE} />
    <path d="M37 66 L83 66" stroke={PALETTE.ink} strokeWidth={3.5} strokeLinecap="round" />
    <path d="M40 64 L58 64 L57 72 Q56 77 49 77 Q42 77 41 72 Z" fill={DARK} {...OUTLINE} strokeWidth={2.5} />
    <path d="M62 64 L80 64 L79 72 Q78 77 71 77 Q64 77 63 72 Z" fill={DARK} {...OUTLINE} strokeWidth={2.5} />
    <path d="M44 67 L49 67 M66 67 L71 67" stroke={PALETTE.white} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
    <path d="M36 97 Q60 118 84 97" fill="none" stroke={PALETTE.ink} strokeWidth={6} strokeLinecap="round" />
    <path d="M36 97 Q60 118 84 97" fill="none" stroke={PALETTE.gold} strokeWidth={3} strokeLinecap="round" strokeDasharray="1 3.5" />
    <circle cx={60} cy={110} r={6} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.5} />
    <path d={starPath(60, 110.4, 3.6, 1.5)} fill="#FFF3B0" />
  </>
);

/** Đa đa song đấu: băng đô đỏ bay phần phật, lông mày dữ, kiếm liễu chĩa lên. */
const DuelingDodos: Art = ({ crest }) => (
  <>
    <path d="M81 54 C91 49 98 49 106 43 C104 51 98 56 88 58 Z" fill={crest} {...OUTLINE} />
    <path d="M82 57 C92 60 98 66 106 66 C100 70 92 68 85 62 Z" fill={crest} {...OUTLINE} />
    <path data-part="crest" d="M38 55 Q60 44 82 55 L82 61 Q60 51 38 61 Z" fill={crest} {...OUTLINE} />
    <path d="M42 58 L56 62.5 M78 58 L64 62.5" stroke={PALETTE.ink} strokeWidth={3.5} strokeLinecap="round" />
    <path d="M95 124 L113 56" stroke={PALETTE.ink} strokeWidth={5} strokeLinecap="round" />
    <path d="M95 124 L113 56" stroke={STEEL} strokeWidth={2.4} strokeLinecap="round" />
    <path d="M89 112 Q96 104 104 114 Q97 118 89 112 Z" fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.5} />
    <Grip x={94} y={124} angle={-15} />
  </>
);

/** Kền kền: đầu hói hồng nhăn, cổ lông xù kem, gặm khúc xương. */
const Vulture: Art = ({ crest }) => (
  <>
    <path d="M41 60 C41 46 48 38 60 38 C72 38 79 46 79 60 C72 56 48 56 41 60 Z" fill="#E7A3A0" {...OUTLINE} />
    <path d="M51 45 Q55 43 59 45 M61 45 Q65 43 69 45 M55 50 Q60 48 65 50" fill="none" stroke={PALETTE.ink} strokeWidth={1.5} strokeLinecap="round" opacity={0.55} />
    <path
      data-part="crest"
      d="M29 100 C32 93 39 96 41 100 C43 93 51 94 53 101 C55 94 65 94 67 101 C69 94 77 93 79 100 C81 96 88 93 91 100 C93 108 85 113 79 109 C75 115 67 113 63 109 C57 115 49 114 45 109 C39 113 27 108 29 100 Z"
      fill={crest}
      {...OUTLINE}
    />
    <g transform="translate(98 118) rotate(28)">
      <rect x={-3} y={-24} width={6} height={22} fill={PALETTE.wing} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={-3.5} cy={-26} r={4} fill={PALETTE.wing} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={3.5} cy={-26} r={4} fill={PALETTE.wing} {...OUTLINE} strokeWidth={2.5} />
      <rect x={-2} y={-25} width={4} height={6} fill={PALETTE.wing} />
    </g>
    <Grip x={95} y={124} angle={28} />
  </>
);

/** Bồ câu: bác sĩ dịch hạch — mũ rộng vành, kính bảo hộ, mặt nạ mỏ dài, lọ độc xanh. */
const Pigeon: Art = ({ crest }) => (
  <>
    <path d="M43 52 L45 33 Q60 29 75 33 L77 52 Z" fill={DARK} {...OUTLINE} />
    <rect data-part="crest" x={44} y={44} width={32} height={6} fill={crest} stroke={PALETTE.ink} strokeWidth={2} />
    <ellipse cx={60} cy={53} rx={35} ry={5} fill={DARK} {...OUTLINE} />
    <path d="M44 79 C44 73 76 73 76 79 C77 91 85 103 94 112 C81 110 63 104 53 97 C47 92 44 86 44 79 Z" fill="#5A3E2B" {...OUTLINE} />
    <path d="M52 82 L80 102" stroke="#C9A04A" strokeWidth={1.6} strokeDasharray="2.5 2.5" strokeLinecap="round" />
    <circle cx={50} cy={69} r={8.5} fill="#FFB23F" opacity={0.4} />
    <circle cx={70} cy={69} r={8.5} fill="#FFB23F" opacity={0.4} />
    <circle cx={50} cy={69} r={8.5} fill="none" stroke={PALETTE.ink} strokeWidth={4.5} />
    <circle cx={70} cy={69} r={8.5} fill="none" stroke={PALETTE.ink} strokeWidth={4.5} />
    <circle cx={50} cy={69} r={8.5} fill="none" stroke="#C9A04A" strokeWidth={2} />
    <circle cx={70} cy={69} r={8.5} fill="none" stroke="#C9A04A" strokeWidth={2} />
    <path d="M58.5 68 L61.5 68" stroke={PALETTE.ink} strokeWidth={3} />
    <rect x={99} y={89} width={7} height={9} rx={1.5} fill="#E6E2F0" {...OUTLINE} strokeWidth={2.5} />
    <rect x={98} y={85} width={9} height={5} rx={1.5} fill={WOOD} {...OUTLINE} strokeWidth={2} />
    <circle cx={102.5} cy={106} r={10} fill="#7CF29A" {...OUTLINE} />
    <path d="M94 104 Q102.5 110 111 104 L111 108 Q102.5 117 94 108 Z" fill="#3BB86A" opacity={0.7} />
    <circle cx={99} cy={102} r={1.8} fill={PALETTE.white} opacity={0.9} />
    <circle cx={105} cy={99} r={1.2} fill={PALETTE.white} opacity={0.8} />
    <Grip x={96} y={120} angle={-20} />
  </>
);

/** Chim ưng: mũ trụ thép chùm lông vàng, vệt "nước mắt" dưới mắt, dao găm cong. */
const Falcon: Art = ({ crest }) => (
  <>
    <path d="M40 72 C36 78 36 86 39 93 C42 87 44 79 44 72 Z" fill="#4A3424" />
    <path d="M80 72 C84 78 84 86 81 93 C78 87 76 79 76 72 Z" fill="#4A3424" />
    <path data-part="crest" d="M47 43 C49 34 61 28 77 30 C72 33 71 38 73 43 Z" fill={crest} {...OUTLINE} />
    <path d="M38 60 C38 46 46 38 60 38 C74 38 82 46 82 60 L77 58 C72 52 66 50 60 50 C54 50 48 52 43 58 Z" fill="#B8C2D6" {...OUTLINE} />
    <path d="M60 39 L60 50" stroke={PALETTE.ink} strokeWidth={2} />
    <circle cx={46} cy={51} r={1.5} fill={PALETTE.ink} />
    <circle cx={74} cy={51} r={1.5} fill={PALETTE.ink} />
    <path d="M44 46 Q50 41 56 41" fill="none" stroke={PALETTE.white} strokeWidth={1.8} strokeLinecap="round" opacity={0.8} />
    <g transform="translate(96 124) rotate(18)">
      <rect x={-3.5} y={0} width={7} height={14} rx={2.5} fill={WOOD} {...OUTLINE} />
      <path d="M-4 -1 C-6 -14 -2 -26 10 -34 C4 -24 4 -12 4 -1 Z" fill={STEEL} {...OUTLINE} />
      <rect x={-7} y={-3} width={14} height={4} rx={1.5} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.5} />
    </g>
    <Grip angle={18} />
  </>
);

/** Diều hâu: lính đánh thuê — băng đô cắm lông vũ, sơn chiến, sẹo qua mắt, giáo dài. */
const Hawk: Art = ({ crest }) => (
  <>
    <path d="M44 50 C38 44 35 38 37 31 C42 35 46 41 47 48 Z" fill={crest} {...OUTLINE} strokeWidth={2.5} />
    <path data-part="crest" d="M50 47 C46 40 46 34 49 29 C53 34 54 40 53 47 Z" fill={crest} {...OUTLINE} strokeWidth={2.5} />
    <path d="M38 55 Q60 45 82 55" fill="none" stroke={PALETTE.ink} strokeWidth={7} strokeLinecap="round" />
    <path d="M38 55 Q60 45 82 55" fill="none" stroke="#7A4A22" strokeWidth={4} strokeLinecap="round" />
    <path d="M35 74 L43 76 M35 80 L43 82" stroke="#E03A2F" strokeWidth={2.6} strokeLinecap="round" />
    <path d="M85 74 L77 76 M85 80 L77 82" stroke="#E03A2F" strokeWidth={2.6} strokeLinecap="round" />
    <path d="M65 58 L77 81" stroke="#F0A0A0" strokeWidth={2.4} strokeLinecap="round" />
    <path d="M67 64 L71 62 M70 70 L74 68 M73 76 L77 74" stroke={PALETTE.ink} strokeWidth={1.3} strokeLinecap="round" />
    <path d="M92 146 L110 50" stroke={PALETTE.ink} strokeWidth={6.5} strokeLinecap="round" />
    <path d="M92 146 L110 50" stroke={WOOD} strokeWidth={3.5} strokeLinecap="round" />
    <path d="M106 54 L113 33 L116 56 Z" fill={STEEL} {...OUTLINE} strokeWidth={2.5} />
    <path d="M106 60 L114 62" stroke={crest} strokeWidth={3} strokeLinecap="round" />
    <Grip x={97} y={122} angle={-12} />
  </>
);

/** Quạ đen: mũ trùm bóng tối ôm mặt, bùa tím phát sáng trước ngực, lưỡi hái. */
const Raven: Art = ({ crest }) => (
  <>
    <path d="M93 146 L107 44" stroke={PALETTE.ink} strokeWidth={6.5} strokeLinecap="round" />
    <path d="M93 146 L107 44" stroke="#3A3350" strokeWidth={3.5} strokeLinecap="round" />
    <path d="M108 42 C96 32 78 33 66 44 C80 40 94 43 104 53 Z" fill={STEEL} {...OUTLINE} />
    <path d="M100 44 C90 39 80 40 72 44" fill="none" stroke={PALETTE.white} strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
    <path
      d="M28 98 C24 66 36 33 60 29 C84 33 96 66 92 98 Q60 106 28 98 Z M40 80 C40 60 48 49 60 49 C72 49 80 60 80 80 C80 92 72 98 60 98 C48 98 40 92 40 80 Z"
      fillRule="evenodd"
      fill="#1B1830"
      {...OUTLINE}
    />
    <path d="M42 70 C43 57 50 51 60 51 C70 51 77 57 78 70" fill="none" stroke={crest} strokeWidth={1.6} opacity={0.55} />
    <path d="M44 100 Q60 108 76 100" fill="none" stroke={PALETTE.ink} strokeWidth={2} />
    <circle cx={60} cy={114} r={9} fill={crest} opacity={0.3} />
    <path data-part="crest" d="M60 105 L66 114 L60 123 L54 114 Z" fill={crest} {...OUTLINE} strokeWidth={2.5} />
    <path d="M58 110 L60 107 L62 110" stroke={PALETTE.white} strokeWidth={1.4} fill="none" strokeLinecap="round" />
    <Grip x={95} y={128} angle={-10} />
  </>
);

/** Cò gáy: tổ chim trên đầu có quả trứng đốm, ngực sọc ngang, lông mày tinh quái, ôm trứng. */
const Cuckoo: Art = ({ crest }) => (
  <>
    <g fill="none" stroke="#6E6650" strokeWidth={2.2} strokeLinecap="round" opacity={0.55}>
      <path d="M32 110 Q46 106 58 110" />
      <path d="M30 120 Q44 116 58 120" />
      <path d="M31 130 Q45 126 58 130" />
      <path d="M62 110 Q74 106 84 110" />
      <path d="M62 120 Q74 116 84 121" />
      <path d="M62 130 Q72 127 82 132" />
    </g>
    <ellipse cx={62} cy={37} rx={6} ry={6.5} fill="#F5EBD0" {...OUTLINE} strokeWidth={2.5} />
    <circle cx={60} cy={35} r={1.2} fill="#8B6B3E" />
    <circle cx={64.5} cy={38} r={1} fill="#8B6B3E" />
    <path data-part="crest" d="M39 44 C41 38 79 38 81 44 C80 51 40 51 39 44 Z" fill={crest} {...OUTLINE} />
    <path d="M42 44 L52 47 M50 42 L62 46 M64 46 L76 42 M70 47 L79 44" stroke="#5A4426" strokeWidth={1.5} strokeLinecap="round" />
    <path d="M42 60 L55 57 M78 60 L65 57" stroke={PALETTE.ink} strokeWidth={3} strokeLinecap="round" />
    <ellipse cx={102} cy={114} rx={8} ry={10} fill="#F5EBD0" {...OUTLINE} />
    <circle cx={99} cy={110} r={1.5} fill="#8B6B3E" />
    <circle cx={105} cy={116} r={1.3} fill="#8B6B3E" />
    <circle cx={101} cy={119} r={1} fill="#8B6B3E" />
    <Grip x={95} y={124} />
  </>
);

/** Ác là: quý ông trộm đồ — bụng trắng, mũ chóp, kính một mắt dây vàng, viên kim cương. */
const Magpie: Art = ({ crest }) => (
  <>
    <path d="M34 114 C34 102 46 98 60 98 C74 98 86 102 86 114 C86 132 74 144 60 144 C46 144 34 132 34 114 Z" fill="#F4F2FA" stroke={PALETTE.ink} strokeWidth={2} />
    <path d="M45 51 L47 30 L73 30 L75 51 Z" fill={DARK} {...OUTLINE} />
    <rect data-part="crest" x={46} y={42} width={28} height={6} fill={crest} stroke={PALETTE.ink} strokeWidth={2} />
    <ellipse cx={60} cy={51} rx={26} ry={4} fill={DARK} {...OUTLINE} />
    <path d="M50 34 L50 40" stroke={PALETTE.white} strokeWidth={1.6} strokeLinecap="round" opacity={0.6} />
    <circle cx={70} cy={69} r={10} fill="#CDEBFF" opacity={0.25} />
    <circle cx={70} cy={69} r={10} fill="none" stroke={PALETTE.ink} strokeWidth={4.5} />
    <circle cx={70} cy={69} r={10} fill="none" stroke={PALETTE.gold} strokeWidth={2.2} />
    <path d="M79 74 Q86 86 84 98" fill="none" stroke={PALETTE.gold} strokeWidth={1.4} strokeDasharray="1.5 1.5" />
    <path d="M96 104 L102 97 L110 97 L116 104 L106 116 Z" fill="#9FE7FF" {...OUTLINE} strokeWidth={2.5} />
    <path d="M96 104 L116 104 M102 97 L106 116 L110 97" fill="none" stroke={PALETTE.ink} strokeWidth={1.2} opacity={0.5} />
    <path d={starPath(113, 92, 4, 1.2, 4)} fill={PALETTE.white} />
    <Grip x={98} y={120} />
  </>
);

/** Quạ (chế độ Corruption): vương miện gai đỏ thẫm, mắt đỏ, đèn lồng lửa ma xanh. */
const Crow: Art = ({ crest }) => (
  <>
    <path
      data-part="crest"
      d="M39 55 L41 44 L46 50 L49 36 L54 47 L60 31 L66 47 L71 36 L74 50 L79 44 L81 55 Q60 47 39 55 Z"
      fill={crest}
      {...OUTLINE}
    />
    <path d="M100 86 L100 94" stroke={PALETTE.ink} strokeWidth={2.5} />
    <circle cx={100} cy={85} r={2.5} fill="none" stroke={PALETTE.ink} strokeWidth={2} />
    <rect x={91} y={94} width={18} height={4} rx={1.5} fill="#3A3448" {...OUTLINE} strokeWidth={2} />
    <rect x={93} y={98} width={14} height={16} rx={2} fill="#7CF29A" opacity={0.3} />
    <path d="M100 112 C95 108 96 103 100 99 C101 104 105 106 100 112 Z" fill="#7CF29A" />
    <rect x={93} y={98} width={14} height={16} rx={2} fill="none" {...OUTLINE} strokeWidth={2.5} />
    <rect x={91} y={114} width={18} height={4} rx={1.5} fill="#3A3448" {...OUTLINE} strokeWidth={2} />
    <Grip x={95} y={124} />
  </>
);

/** Cú (chế độ Hoot & Seek): túm tai nhọn, kính tròn gọng mảnh. */
const Owl: Art = ({ crest }) => (
  <>
    <path data-part="crest" d="M40 56 L38 37 L52 48 Z" fill={crest} {...OUTLINE} />
    <path d="M80 56 L82 37 L68 48 Z" fill={crest} {...OUTLINE} />
    <circle cx={50} cy={69} r={9.5} fill="none" stroke={PALETTE.ink} strokeWidth={2.2} />
    <circle cx={70} cy={69} r={9.5} fill="none" stroke={PALETTE.ink} strokeWidth={2.2} />
    <path d="M59.5 68 L60.5 68" stroke={PALETTE.ink} strokeWidth={2.2} />
  </>
);

/** Gà (chế độ Tastes Like Chicken): mào đỏ răng cưa và yếm đỏ dưới mỏ. */
const Chicken: Art = ({ crest }) => (
  <>
    <path data-part="crest" d="M48 43 C45 34 52 31 54 37 C55 29 63 29 63 36 C65 30 73 32 71 41 C65 43 55 44 48 43 Z" fill={crest} {...OUTLINE} />
    <ellipse cx={60} cy={100} rx={4.5} ry={6} fill={crest} {...OUTLINE} strokeWidth={2.5} />
  </>
);

/** Chim chưa có bộ riêng: ba túm mào rẽ từ đỉnh đầu (bộ `bird` cũ). */
const Plumes: Art = ({ crest }) => (
  <>
    <path data-part="crest" d="M62 41 C52 37 38 38 30 52 C38 48.5 48 50 58 51 Z" fill={crest} {...OUTLINE} />
    <path d="M58 41 C68 37 82 38 90 52 C82 48.5 72 50 62 51 Z" fill={crest} {...OUTLINE} />
    <path d="M60 40 C55 40 50 45 52 55 C56 51 60 50.5 65 54 C68 45 65 40 60 40 Z" fill={crest} {...OUTLINE} />
  </>
);

const FRONT: Partial<Record<string, Art>> = {
  dodo: Dodo,
  dueling_dodos: DuelingDodos,
  vulture: Vulture,
  pigeon: Pigeon,
  falcon: Falcon,
  hawk: Hawk,
  raven: Raven,
  cuckoo: Cuckoo,
  magpie: Magpie,
  crow: Crow,
  owl: Owl,
  chicken: Chicken,
};

/** Lớp sau lưng của từng loài; loài không có trong bảng xoè đuôi màu cánh. */
const BACK: Partial<Record<string, Art>> = {
  dodo: ({ wing }) => <path d={TAIL_STUB} fill={wing} {...OUTLINE} />,
  dueling_dodos: ({ wing }) => <path d={TAIL_STUB} fill={wing} {...OUTLINE} />,
  vulture: ({ wing }) => <Wings d={WING_RAGGED} fill={wing} />,
  pigeon: () => <path d={CLOAK} fill="#2A2633" {...OUTLINE} />,
  falcon: ({ wing }) => <Wings d={WING_SWEPT} fill={wing} />,
  hawk: ({ wing }) => (
    <>
      <path d={TAIL} fill={wing} {...OUTLINE} />
      <Wings d={WING_SWEPT} fill={wing} />
    </>
  ),
  raven: ({ wing }) => (
    <>
      <Wings d={WING_RAGGED} fill={wing} />
      <path d={CLOAK} fill="#1B1830" {...OUTLINE} />
    </>
  ),
  cuckoo: ({ wing }) => <path d={TAIL_LONG} fill={wing} {...OUTLINE} />,
  magpie: ({ wing }) => <path d={TAIL_LONG} fill={wing} {...OUTLINE} />,
  crow: ({ wing }) => <Wings d={WING_RAGGED} fill={wing} />,
  chicken: () => <path d={TAIL} fill="#2A2740" {...OUTLINE} />,
};

const DEFAULT_TAIL: Art = ({ wing }) => <path d={TAIL} fill={wing} {...OUTLINE} />;

function colours(key: string) {
  return { crest: birdCrestColour(key), wing: bodyLook(key)?.wing ?? PALETTE.wing };
}

export function Bird({ role }: { role: KitRole }) {
  const Front = FRONT[role.key] ?? Plumes;
  return <Front {...colours(role.key)} />;
}

export function BirdBack({ role }: { role: KitRole }) {
  const Back = BACK[role.key] ?? DEFAULT_TAIL;
  return <Back {...colours(role.key)} />;
}
