/**
 * Bộ đồ riêng của từng role phe Vịt — cùng cơ chế với `GooseOutfits.tsx`: vẽ thay lớp trước
 * (và có khi cả lớp sau) của bộ chung trong `roleKits.ts`, role vẫn thuộc đúng bộ (`data-kit`).
 * Phe Vịt mặc đồ tối — đen, đỏ máu, thép súng — cầm hung khí, và mang mắt quỷ của thân
 * (`bodyLook` đặt `evil` cho cả phe), nên đồ không che mắt: mặt nạ nào cũng chừa lỗ mắt.
 *
 * Toạ độ như bộ của Ngỗng: khung `0 0 120 160`, đỉnh đầu y = 38, mắt (50|70, 69), lông mày
 * quỷ bắt đầu từ y ≈ 60 nên mũ giữ đáy ≤ y 58, mỏ y 74–95, ngực (60, 118), mút cánh cầm đồ
 * (94, 125), mọi phần giữ y ≥ 29 (vùng bảng tên). Vật cầm tay vẽ trong toạ độ riêng — chĩa lên
 * theo trục y âm — rồi xoay và đặt vào mút cánh như bộ `knife`.
 */

import type { ReactNode } from 'react';
import { PALETTE } from '../../../lib/palette';
import type { Outfit } from './GooseOutfits';
import { NINJA_MASK } from './Ninja';
import { Grip, OUTLINE, starPath } from './shapes';

const INK = PALETTE.ink;
const BLACK = '#1E1A2B';
const COAT = '#2E2740';
const CRIMSON = '#9E1B24';
const BLOOD = '#D0202A';
const STEEL = '#D9DEE8';
const STEEL_DARK = '#8E97AB';
const GUN = '#3E4456';
const WOOD = '#6B4423';
const BONE = '#EFE6CF';
const TOXIC = '#8CF25A';
const VIOLET = '#6A2FA0';
const GOLD = PALETTE.gold;

/** Phản chiếu sang bên phải thân (trục x = 60). */
const MIRROR = 'translate(120 0) scale(-1 1)';

// ---------------------------------------------------------------------------
// Mảnh dùng chung
// ---------------------------------------------------------------------------

/** Đặt vật cầm tay (vẽ chĩa lên) vào mút cánh, xoay `angle` độ, rồi cánh nắm lấy cán. */
function Held({ angle, children, x = 96, y = 124 }: { angle: number; children: ReactNode; x?: number; y?: number }) {
  return (
    <>
      <g transform={`translate(${x} ${y}) rotate(${angle})`}>{children}</g>
      <Grip angle={angle} />
    </>
  );
}

/** Mũ trùm đầu chừa khoảng mặt (mắt, mỏ), hai vạt rủ qua vai tới y ≈ 100. */
const HOOD =
  'M22 100 C27 90 27 82 27 76 C27 48 44 29 60 29 C76 29 93 48 93 76 C93 82 93 90 98 100 L84 97 ' +
  'C82 90 82 80 82 72 C82 57 72 51 60 51 C48 51 38 57 38 72 C38 80 38 90 36 97 Z';
/** Mép trong của mũ trùm — viền màu hoặc bóng tối hắt lên mặt. */
const HOOD_EDGE = 'M36 97 C38 90 38 80 38 72 C38 57 48 51 60 51 C72 51 82 57 82 72 C82 80 82 90 84 97';

function Hood({ fill, trim }: { fill: string; trim?: string }) {
  return (
    <>
      <path d={HOOD} fill={fill} {...OUTLINE} />
      <path d={HOOD_EDGE} fill="none" stroke={trim ?? INK} strokeWidth={trim ? 2.4 : 4} opacity={trim ? 1 : 0.35} />
    </>
  );
}

/** Áo choàng sau lưng, gấu rách tua, cổ dựng hai bên đầu lót màu `lining`. */
const CAPE =
  'M32 82 C16 100 8 124 8 148 L16 141 L22 150 L31 142 L38 151 L46 143 L54 151 L60 144 L66 151 L74 143 ' +
  'L82 151 L89 142 L98 150 L104 141 L112 148 C112 124 104 100 88 82 Z';

function Cape({ fill, lining }: { fill: string; lining: string }) {
  return (
    <>
      <path d={CAPE} fill={fill} {...OUTLINE} />
      <path d="M30 88 L23 58 L47 72 Z" fill={lining} {...OUTLINE} />
      <path d="M30 88 L23 58 L47 72 Z" transform={MIRROR} fill={lining} {...OUTLINE} />
    </>
  );
}

/** Khăn bịt nửa dưới mặt: phủ mỏ, chừa mắt (mép trên y ≈ 77, dưới đáy mắt). */
const BANDANA = 'M35 80 C46 76 74 76 85 80 L87 91 C78 100 68 104 60 107 C52 104 42 100 33 91 Z';

function Bandana({ fill, fold }: { fill: string; fold: string }) {
  return (
    <>
      <path d={BANDANA} fill={fill} {...OUTLINE} />
      <path d="M41 87 C52 91 68 91 79 87 M48 96 C55 99 65 99 72 96" fill="none" stroke={fold} strokeWidth={1.8} strokeLinecap="round" />
    </>
  );
}

/** Băng đô ngang trán, hai đuôi bay về bên trái. */
function Headband({ fill }: { fill: string }) {
  return (
    <>
      <path d="M36 50 C38 46 82 46 84 50 L85 57 C76 53 44 53 35 57 Z" fill={fill} {...OUTLINE} />
      <path d="M36 52 C26 48 16 52 8 46 C12 56 22 60 35 57 Z" fill={fill} {...OUTLINE} />
      <path d="M36 55 C28 58 22 66 12 66 C20 72 30 66 36 58 Z" fill={fill} {...OUTLINE} />
    </>
  );
}

/** Cổ áo vest/áo khoác: hai ve áo, sơ mi và cà vạt ở giữa. */
function Suit({ jacket, shirt = PALETTE.white, tie }: { jacket: string; shirt?: string; tie?: string }) {
  return (
    <>
      <path d="M44 96 L60 104 L76 96 L72 124 L48 124 Z" fill={shirt} {...OUTLINE} strokeWidth={2.5} />
      {tie && <path d="M56 101 L64 101 L62 106 L66 124 L60 130 L54 124 L58 106 Z" fill={tie} {...OUTLINE} strokeWidth={2.2} />}
      <path d="M32 90 L46 96 L56 124 L40 132 C32 120 28 104 32 90 Z" fill={jacket} {...OUTLINE} />
      <path d="M32 90 L46 96 L56 124 L40 132 C32 120 28 104 32 90 Z" transform={MIRROR} fill={jacket} {...OUTLINE} />
    </>
  );
}

/** Dao găm chĩa lên trong toạ độ riêng: cán từ 0 xuống 15, lưỡi dài `length`. */
function Dagger({ length = 32, steel = STEEL, hilt = BLACK, blood }: { length?: number; steel?: string; hilt?: string; blood?: boolean }) {
  const tip = -length;
  return (
    <>
      <rect x={-3.5} y={0} width={7} height={15} rx={2.5} fill={hilt} {...OUTLINE} />
      <path d={`M-5 -1 L-5 ${tip + 10} Q-4 ${tip + 3} 2 ${tip} L5 ${tip + 7} L5 -1 Z`} fill={steel} {...OUTLINE} />
      <rect x={-8} y={-4} width={16} height={4.5} rx={2} fill={GUN} {...OUTLINE} strokeWidth={2} />
      <path d={`M1 -7 L1 ${tip + 8}`} stroke={PALETTE.white} strokeWidth={1.5} strokeLinecap="round" opacity={0.75} />
      {blood && <path d={`M-5 ${tip + 12} L-5 ${tip + 22} Q-7 ${tip + 26} -5 ${tip + 28} Q-3 ${tip + 26} -5 ${tip + 22}`} fill={BLOOD} stroke={BLOOD} strokeWidth={2.4} strokeLinejoin="round" />}
    </>
  );
}

/** Súng lục nhìn ngang, nòng chĩa sang phải (toạ độ riêng): báng đứng ở gốc, khoá nòng phía trên. */
function Pistol({ slide, suppressor }: { slide: string; suppressor?: boolean }) {
  return (
    <>
      <path d="M-4 14 L-6 -2 L5 -2 L5 14 Z" fill={BLACK} {...OUTLINE} strokeWidth={2.5} />
      <path d="M4 -1 C4 7 13 7 13 -1" fill="none" stroke={INK} strokeWidth={2.2} />
      <rect x={-7} y={-11} width={30} height={10} rx={2} fill={slide} {...OUTLINE} strokeWidth={2.5} />
      <path d="M-2 -8 L18 -8" stroke={PALETTE.white} strokeWidth={1.4} strokeLinecap="round" opacity={0.6} />
      {suppressor && <rect x={22} y={-10} width={24} height={8} rx={3} fill={BLACK} {...OUTLINE} strokeWidth={2.5} />}
    </>
  );
}

/** Vết máu bắn trên thân. */
function Splatter({ x, y }: { x: number; y: number }) {
  return (
    <g fill={BLOOD}>
      <circle cx={x} cy={y} r={3} />
      <circle cx={x + 6} cy={y + 5} r={1.6} />
      <circle cx={x - 4} cy={y + 7} r={1.2} />
      <circle cx={x + 3} cy={y - 5} r={1} />
    </g>
  );
}

/** Mũ len ôm đầu, gấu gập, sọc dệt dọc. */
function Beanie({ fill, cuff }: { fill: string; cuff: string }) {
  return (
    <>
      <path d="M38 56 C38 42 47 36 60 36 C73 36 82 42 82 56 Z" fill={fill} {...OUTLINE} />
      <path d="M48 38.5 L48 50 M56 36.6 L56 50 M64 36.6 L64 50 M72 38.5 L72 50" stroke={INK} strokeWidth={1.2} opacity={0.35} />
      <rect x={36} y={49} width={48} height={9} rx={4} fill={cuff} {...OUTLINE} />
    </>
  );
}

/** Mũ nồi nghiêng về bên phải. */
function Beret({ fill, badge }: { fill: string; badge?: ReactNode }) {
  return (
    <>
      <path d="M36 52 C33 42 50 34 66 36 C82 38 90 46 84 53 C70 57 46 57 36 52 Z" fill={fill} {...OUTLINE} />
      <path d="M62 36 L63 31" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      {badge}
    </>
  );
}

/** Mũ sắt quân sự với vành mỏng. */
function Helmet({ fill }: { fill: string }) {
  return (
    <>
      <path d="M37 54 C37 40 47 33 60 33 C73 33 83 40 83 54 Z" fill={fill} {...OUTLINE} />
      <path d="M33 54 C46 58 74 58 87 54 L86 58 C74 61 46 61 34 58 Z" fill={fill} {...OUTLINE} />
    </>
  );
}

/** Súng trường dài chĩa lên (toạ độ riêng): báng, thân, ống ngắm, nòng. */
function Rifle({ body = GUN, stock = WOOD, scope = true }: { body?: string; stock?: string; scope?: boolean }) {
  return (
    <>
      <path d="M-5 14 L-6 -4 L3 -10 L5 14 Z" fill={stock} {...OUTLINE} strokeWidth={2.5} />
      <rect x={-3} y={-44} width={6} height={36} rx={1.5} fill={body} {...OUTLINE} strokeWidth={2.5} />
      <rect x={-1.6} y={-72} width={3.2} height={30} rx={1} fill={BLACK} {...OUTLINE} strokeWidth={2} />
      {scope && <rect x={3} y={-38} width={6} height={18} rx={2.5} fill={BLACK} {...OUTLINE} strokeWidth={2} />}
      {scope && <circle cx={6} cy={-38} r={1.6} fill={BLOOD} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Từng role
// ---------------------------------------------------------------------------

/** Vịt: băng đô đỏ máu, áo choàng rách, dao phay dính máu, máu bắn trên ngực. */
const duck: Outfit = {
  back: () => <Cape fill={BLACK} lining={CRIMSON} />,
  front: () => (
    <>
      <Headband fill={CRIMSON} />
      <Splatter x={44} y={116} />
      <Held angle={18}>
        <rect x={-3.5} y={0} width={7} height={16} rx={2.5} fill={WOOD} {...OUTLINE} />
        <path d="M-5 -2 L-5 -32 L16 -32 C18 -22 18 -12 16 -2 Z" fill={STEEL} {...OUTLINE} />
        <circle cx={10} cy={-26} r={2.2} fill={PALETTE['night-800']} stroke={INK} strokeWidth={1.5} />
        <path d="M16.5 -28 C18.5 -20 18.5 -12 16.5 -5" fill="none" stroke={BLOOD} strokeWidth={3.5} strokeLinecap="round" />
        <path d="M16 -14 Q19 -6 16.5 -3 Q14 -6 16 -14 Z" fill={BLOOD} />
      </Held>
    </>
  ),
};

/** Tình nhân (vịt): cánh dơi, vòng cổ gai, mặt dây trái tim vỡ, cầm hoa hồng đen. */
const loverDuck: Outfit = {
  back: () => (
    <>
      <path d="M34 96 C24 82 12 76 2 80 C7 85 8 90 6 95 C11 93 15 94 17 99 C19 95 24 95 26 100 C28 97 31 97 34 101 Z" fill="#3A1F4D" {...OUTLINE} />
      <path d="M34 96 C24 82 12 76 2 80 C7 85 8 90 6 95 C11 93 15 94 17 99 C19 95 24 95 26 100 C28 97 31 97 34 101 Z" transform={MIRROR} fill="#3A1F4D" {...OUTLINE} />
    </>
  ),
  front: () => (
    <>
      <path d="M36 96 C48 103 72 103 84 96 L83 102 C71 109 49 109 37 102 Z" fill={BLACK} {...OUTLINE} strokeWidth={2.5} />
      <path d="M42 102 l2 5 l2 -4 M54 105 l2 5 l2 -5 M66 105 l2 5 l2 -5 M76 101 l1.5 5 l2 -4" fill={STEEL} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M60 128 C52 121 47 117 47 112 C47 108 51 106 54 108 L57 112 L55 116 L59 119 Z" fill={BLOOD} {...OUTLINE} strokeWidth={2.2} />
      <path d="M62 129 C70 121 73 117 73 112 C73 108 69 106 66 108 L61 113 L64 116 L60 120 Z" fill={BLOOD} {...OUTLINE} strokeWidth={2.2} />
      <Held angle={-16}>
        <path d="M0 14 L0 -22" stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
        <path d="M0 14 L0 -22" stroke="#2F5B34" strokeWidth={2} strokeLinecap="round" />
        <path d="M0 -6 l-4 -2 M0 -14 l4 -2" stroke="#2F5B34" strokeWidth={2} strokeLinecap="round" />
        <path d="M-8 -26 C-10 -34 -4 -38 0 -34 C4 -38 10 -34 8 -26 C6 -20 -6 -20 -8 -26 Z" fill="#2A1630" {...OUTLINE} strokeWidth={2.4} />
        <path d="M-4 -28 C-2 -32 2 -32 4 -28" fill="none" stroke={BLOOD} strokeWidth={1.8} strokeLinecap="round" />
      </Held>
    </>
  ),
};

/** Kẻ ăn xác: khúc xương cài đầu, yếm dính máu, chĩa ba ăn thịt. */
const cannibal: Outfit = {
  front: () => (
    <>
      <g transform="rotate(-14 60 40)">
        <rect x={42} y={37} width={36} height={6} rx={3} fill={BONE} {...OUTLINE} strokeWidth={2.5} />
        <circle cx={41} cy={36.5} r={3.6} fill={BONE} {...OUTLINE} strokeWidth={2.2} />
        <circle cx={41} cy={43.5} r={3.6} fill={BONE} {...OUTLINE} strokeWidth={2.2} />
        <circle cx={79} cy={36.5} r={3.6} fill={BONE} {...OUTLINE} strokeWidth={2.2} />
        <circle cx={79} cy={43.5} r={3.6} fill={BONE} {...OUTLINE} strokeWidth={2.2} />
      </g>
      <path d="M38 97 C48 103 72 103 82 97 L79 122 C70 130 50 130 41 122 Z" fill={PALETTE.white} {...OUTLINE} />
      <path d="M38 97 C30 94 26 98 24 94 M82 97 C90 94 94 98 96 94" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M45 104 C47 110 44 114 47 120 M71 106 C70 112 74 116 71 122" fill="none" stroke={BLOOD} strokeWidth={3} strokeLinecap="round" />
      <Splatter x={56} y={112} />
      <path d="M72 88 Q74 93 72 96" fill="none" stroke={BLOOD} strokeWidth={2.5} strokeLinecap="round" />
      <Held angle={14}>
        <path d="M0 14 L0 -26" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        <path d="M0 14 L0 -26" stroke={WOOD} strokeWidth={3} strokeLinecap="round" />
        <path d="M-8 -26 L8 -26 M-8 -26 L-8 -42 M0 -26 L0 -46 M8 -26 L8 -42" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
        <path d="M-8 -26 L8 -26 M-8 -26 L-8 -42 M0 -26 L0 -46 M8 -26 L8 -42" fill="none" stroke={STEEL} strokeWidth={2.2} strokeLinecap="round" />
        <path d="M-8 -42 l0 4 M8 -42 l0 3" stroke={BLOOD} strokeWidth={2.2} strokeLinecap="round" />
      </Held>
    </>
  ),
};

/** Kẻ cải trang: nửa mặt nạ sứ nứt che mắt phải (chừa lỗ), khói tím, gương soi hiện mặt Ngỗng. */
const morphling: Outfit = {
  front: () => (
    <>
      <path
        d="M60 47 C75 47 87 57 87 72 C87 85 78 94 60 96 Z M70 61 a8 8 0 1 0 0.01 0 Z"
        fillRule="evenodd"
        fill="#F2EEF8"
        {...OUTLINE}
      />
      <path d="M60 58 L65 62 L62 66 L67 70 M78 82 L74 86 L77 90" fill="none" stroke={VIOLET} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M74 52 C78 50 82 52 83 55" fill="none" stroke={VIOLET} strokeWidth={2} strokeLinecap="round" />
      <g fill="none" stroke={PALETTE['third-soft']} strokeWidth={2.2} strokeLinecap="round" opacity={0.7}>
        <path d="M18 112 C12 106 18 100 14 94 M24 132 C18 128 22 122 18 118" />
      </g>
      <Held angle={-10}>
        <rect x={-2.5} y={-6} width={5} height={20} rx={2} fill={BLACK} {...OUTLINE} strokeWidth={2.4} />
        <ellipse cx={0} cy={-20} rx={11} ry={14} fill={VIOLET} {...OUTLINE} />
        <ellipse cx={0} cy={-20} rx={7.5} ry={10.5} fill="#BFD8FF" stroke={INK} strokeWidth={1.6} />
        <circle cx={-3} cy={-22} r={2} fill={INK} />
        <circle cx={3} cy={-22} r={2} fill={INK} />
        <path d="M-3.5 -16 C-3.5 -18.5 3.5 -18.5 3.5 -16 C3.5 -13 -3.5 -13 -3.5 -16 Z" fill={PALETTE.beak} />
        <path d="M-5 -28 L-1 -25" stroke={PALETTE.white} strokeWidth={1.4} strokeLinecap="round" />
      </Held>
    </>
  ),
};

/** Kẻ câm lặng: mũ len đen, áo cổ lọ, súng lục gắn ống giảm thanh. */
const silencer: Outfit = {
  front: () => (
    <>
      <Beanie fill={BLACK} cuff={COAT} />
      <path d="M33 92 C46 100 74 100 87 92 L88 104 C74 112 46 112 32 104 Z" fill={COAT} {...OUTLINE} />
      <path d="M36 98 C48 105 72 105 84 98" fill="none" stroke={BLACK} strokeWidth={1.6} />
      <Held angle={-40}>
        <Pistol slide={GUN} suppressor />
      </Held>
    </>
  ),
};

/** Cao thủ: tóc vuốt ngược, kính râm đỏ (mắt quỷ vẫn rực qua kính), áo da, xoè ba dao ném. */
const professional: Outfit = {
  front: () => (
    <>
      <path d="M40 54 C38 40 50 34 62 35 C74 36 84 42 82 54 C76 46 66 44 58 46 C52 47 46 50 40 54 Z" fill={BLACK} {...OUTLINE} />
      <path d="M50 40 C58 36 70 38 78 44" fill="none" stroke="#5A5170" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M36 66 L84 66" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <path d="M39 64 L58 64 L57 72 Q55 78 48 78 Q41 78 40 72 Z" fill={BLOOD} fillOpacity={0.45} {...OUTLINE} strokeWidth={2.5} />
      <path d="M62 64 L81 64 L80 72 Q79 78 72 78 Q65 78 63 72 Z" fill={BLOOD} fillOpacity={0.45} {...OUTLINE} strokeWidth={2.5} />
      <path d="M43 67 L48 67 M66 67 L71 67" stroke={PALETTE.white} strokeWidth={1.8} strokeLinecap="round" opacity={0.8} />
      <Suit jacket="#3A2A22" shirt={BLACK} />
      <path d="M60 104 L60 126" stroke={STEEL_DARK} strokeWidth={2} strokeDasharray="2 2" />
      {[-16, 4, 24].map((angle) => (
        <g key={angle} transform={`translate(96 124) rotate(${angle})`}>
          <Dagger length={26} />
        </g>
      ))}
      <Grip angle={4} />
    </>
  ),
};

/** Gián điệp: mũ phớt đen dải đỏ, cổ áo măng tô dựng, cặp hồ sơ "mật". */
const spy: Outfit = {
  front: () => (
    <>
      <g transform="rotate(-6 60 50)">
        <path d="M42 53 C41 41 48 36 60 38 C72 36 79 41 78 53 Z" fill={BLACK} {...OUTLINE} />
        <path d="M52 39 C56 42 64 42 68 39" fill="none" stroke={INK} strokeWidth={1.8} />
        <rect x={41} y={47} width={38} height={5} fill={CRIMSON} stroke={INK} strokeWidth={2} />
        <ellipse cx={60} cy={54} rx={31} ry={4.5} fill={BLACK} {...OUTLINE} />
      </g>
      <path d="M28 96 L36 80 L50 100 L42 118 Z" fill="#B08A5A" {...OUTLINE} />
      <path d="M28 96 L36 80 L50 100 L42 118 Z" transform={MIRROR} fill="#B08A5A" {...OUTLINE} />
      <path d="M50 100 L60 106 L70 100 L68 132 L52 132 Z" fill="#8C6A40" {...OUTLINE} strokeWidth={2.5} />
      <Held angle={-12}>
        <rect x={-12} y={-30} width={24} height={30} rx={2} fill="#C9A86A" {...OUTLINE} />
        <path d="M-12 -30 L-4 -30 L-2 -34 L-10 -34 Z" fill="#C9A86A" {...OUTLINE} strokeWidth={2} />
        <rect x={-9} y={-20} width={18} height={7} rx={1} fill="none" stroke={BLOOD} strokeWidth={1.8} transform="rotate(-10 0 -16)" />
        <path d="M-6 -16.5 L6 -18.5" stroke={BLOOD} strokeWidth={1.6} transform="rotate(-10 0 -16)" />
      </Held>
    </>
  ),
};

/** Ám sát: mũ trùm xám tro viền đỏ, khăn đỏ thắt chéo, lưỡi kiếm ẩn bật ra từ cánh. */
const assassin: Outfit = {
  front: () => (
    <>
      <Hood fill="#3B3550" trim={BLOOD} />
      <path d="M58 31 L60 26.5 L62 31" fill="#3B3550" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <path d="M34 104 L86 126 L84 134 L32 112 Z" fill={CRIMSON} {...OUTLINE} />
      <circle cx={60} cy={119} r={4.5} fill={STEEL} {...OUTLINE} strokeWidth={2.2} />
      <path d="M57.5 119 L60 115.5 L62.5 119 L60 122.5 Z" fill={BLACK} />
      <g transform="translate(96 124) rotate(-35)">
        <path d="M-2.5 -4 L-2.5 -34 L0 -40 L2.5 -34 L2.5 -4 Z" fill={STEEL} {...OUTLINE} strokeWidth={2.2} />
        <rect x={-5} y={-6} width={10} height={10} rx={2} fill={COAT} {...OUTLINE} strokeWidth={2.2} />
      </g>
      <Grip angle={-35} />
    </>
  ),
};

/** Sát thủ: mã vạch sau gáy, vest đen cà vạt đỏ, súng lục bạc. */
const hitman: Outfit = {
  front: () => (
    <>
      <g stroke={INK} strokeLinecap="butt">
        {[50, 52.5, 54, 57, 59, 60.5, 63.5, 65, 67.5, 70].map((x, i) => (
          <path key={x} d={`M${x} 41 L${x} 49`} strokeWidth={i % 3 === 0 ? 1.8 : 1} />
        ))}
      </g>
      <Suit jacket={BLACK} tie={BLOOD} />
      <Held angle={-30}>
        <Pistol slide={STEEL} />
        <circle cx={27} cy={-6} r={2.2} fill={BLOOD} />
      </Held>
      <circle cx={24} cy={116} r={7} fill="none" stroke={BLOOD} strokeWidth={2} opacity={0.85} />
      <path d="M24 106 L24 126 M14 116 L34 116" stroke={BLOOD} strokeWidth={1.6} opacity={0.85} />
    </>
  ),
};

/** Kẻ mách lẻo: mũ lưỡi trai đội ngược, còi trên dây, loa phóng thanh. */
const snitch: Outfit = {
  front: () => (
    <>
      <path d="M38 55 C38 42 47 36 60 36 C73 36 82 42 82 55 Z" fill={CRIMSON} {...OUTLINE} />
      <path d="M40 50 C34 50 26 52 22 56 C28 58 34 57 40 55 Z" fill={BLACK} {...OUTLINE} />
      <circle cx={60} cy={37} r={2.5} fill={BLACK} />
      <path d="M38 97 Q60 112 82 97" fill="none" stroke={INK} strokeWidth={2} />
      <path d="M58 108 L62 108 L63 116 L57 116 Z" fill={STEEL} {...OUTLINE} strokeWidth={2} />
      <circle cx={60} cy={118} r={4} fill={STEEL} {...OUTLINE} strokeWidth={2} />
      <Held angle={50}>
        <rect x={-3} y={0} width={6} height={10} rx={2} fill={BLACK} {...OUTLINE} strokeWidth={2.4} />
        <path d="M-5 -2 L-5 -10 L-14 -30 L14 -30 L5 -10 L5 -2 Z" fill={PALETTE.white} {...OUTLINE} />
        <path d="M-9 -20 L9 -20" stroke={BLOOD} strokeWidth={4} />
        <ellipse cx={0} cy={-30} rx={14} ry={3.5} fill={BLOOD} {...OUTLINE} strokeWidth={2.4} />
      </Held>
      <path d="M118 74 L114 78 M120 86 L114 86 M117 97 L112 94" stroke={GOLD} strokeWidth={2.4} strokeLinecap="round" />
    </>
  ),
};

/** Tiệc tùng: mũ chóp đen đầu lâu, pháo giấy đen-đỏ, ly "nước đỏ" bốc khói. */
const party: Outfit = {
  front: () => (
    <>
      <path d="M48 51 L58 30 L72 51 Z" fill={BLACK} {...OUTLINE} />
      <path d="M52 43 L66 43" stroke={BLOOD} strokeWidth={2.5} />
      <circle cx={58} cy={30} r={3.4} fill={BLOOD} {...OUTLINE} strokeWidth={2} />
      <circle cx={60} cy={49} r={2.6} fill={PALETTE.white} />
      <path d="M58.6 49 h0.6 M61 49 h0.6" stroke={INK} strokeWidth={1.2} strokeLinecap="round" />
      <path d="M48 51 C40 52 36 54 34 56" fill="none" stroke={INK} strokeWidth={1.4} />
      <g>
        <rect x={20} y={70} width={4} height={4} fill={BLOOD} transform="rotate(20 22 72)" />
        <rect x={14} y={96} width={4} height={4} fill={BLACK} stroke={PALETTE.white} strokeWidth={0.8} transform="rotate(-25 16 98)" />
        <rect x={100} y={40} width={4} height={4} fill={BLOOD} transform="rotate(40 102 42)" />
        <rect x={22} y={124} width={3.5} height={3.5} fill={GOLD} transform="rotate(15 24 126)" />
      </g>
      <Held angle={-6}>
        <path d="M-2 14 L-2 -4 L2 -4 L2 14 Z" fill={STEEL} {...OUTLINE} strokeWidth={2} />
        <ellipse cx={0} cy={14} rx={7} ry={2.5} fill={STEEL} {...OUTLINE} strokeWidth={2} />
        <path d="M-11 -24 L11 -24 L4 -4 L-4 -4 Z" fill={STEEL} fillOpacity={0.5} {...OUTLINE} strokeWidth={2.4} />
        <path d="M-8.8 -17 L8.8 -17 L4 -4 L-4 -4 Z" fill={BLOOD} />
        <path d="M-4 -28 C-6 -32 -2 -34 -4 -38 M4 -28 C2 -32 6 -34 4 -38" fill="none" stroke={PALETTE['duck-soft']} strokeWidth={1.6} strokeLinecap="round" opacity={0.8} />
      </Held>
    </>
  ),
};

/** Kẻ đặt bom: kính hàn đẩy lên trán, vết khói, dây đeo thuốc nổ chéo ngực, kíp nổ cầm tay. */
const demolitionist: Outfit = {
  front: () => (
    <>
      <path d="M37 52 C44 47 76 47 83 52" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <path d="M37 52 C44 47 76 47 83 52" fill="none" stroke="#5A4A3A" strokeWidth={2.6} strokeLinecap="round" />
      <circle cx={50} cy={48} r={7} fill={GUN} {...OUTLINE} />
      <circle cx={70} cy={48} r={7} fill={GUN} {...OUTLINE} />
      <circle cx={50} cy={48} r={4} fill="#2E6B4A" />
      <circle cx={70} cy={48} r={4} fill="#2E6B4A" />
      <path d="M48 46 l2 -1 M68 46 l2 -1" stroke={PALETTE.white} strokeWidth={1.4} strokeLinecap="round" />
      <path d="M36 84 C38 82 42 82 43 84 M78 86 C80 84 83 85 84 87" fill="none" stroke={INK} strokeWidth={2} opacity={0.35} strokeLinecap="round" />
      <path d="M30 98 L84 132 L80 138 L26 104 Z" fill="#5A4A3A" {...OUTLINE} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(${36 + i * 12} ${102 + i * 7.6}) rotate(32)`}>
          <rect x={-3} y={-9} width={6} height={15} rx={1.5} fill={BLOOD} {...OUTLINE} strokeWidth={2} />
          <path d="M0 -9 L0 -12" stroke={INK} strokeWidth={1.5} />
        </g>
      ))}
      <Held angle={-4}>
        <rect x={-9} y={-16} width={18} height={18} rx={2} fill="#C9A13B" {...OUTLINE} />
        <path d="M-6 -12 L6 -12" stroke={INK} strokeWidth={1.4} />
        <path d="M0 -16 L0 -28" stroke={INK} strokeWidth={4} strokeLinecap="round" />
        <path d="M0 -16 L0 -28" stroke={STEEL} strokeWidth={2} strokeLinecap="round" />
        <rect x={-8} y={-32} width={16} height={5} rx={2} fill={BLACK} {...OUTLINE} strokeWidth={2.2} />
        <circle cx={5} cy={-6} r={2.4} fill={BLOOD} stroke={INK} strokeWidth={1.2} />
      </Held>
    </>
  ),
};

/** Kẻ cắp danh tính: mặt nạ đen che mắt (chừa lỗ), mũ dẹt, thẻ căn cước gạch chéo, cầm "mặt" Ngỗng vừa lột. */
const identityThief: Outfit = {
  front: () => (
    <>
      <path d="M40 53 C40 43 48 38 60 38 C72 38 80 43 80 53 Z" fill="#4A4458" {...OUTLINE} />
      <path d="M36 54 C42 49 66 48 86 52 L85 57 C66 54 44 55 37 58 Z" fill="#4A4458" {...OUTLINE} />
      <path
        d="M36 64 C40 59 80 59 84 64 L84 74 C78 78 66 77 60 73 C54 77 42 78 36 74 Z M50 62 a7 7 0 1 0 0.01 0 Z M70 62 a7 7 0 1 0 0.01 0 Z"
        fillRule="evenodd"
        fill={BLACK}
        {...OUTLINE}
        strokeWidth={2.5}
      />
      <rect x={30} y={104} width={20} height={14} rx={2} fill={PALETTE.white} {...OUTLINE} strokeWidth={2.2} transform="rotate(-8 40 111)" />
      <circle cx={36} cy={111} r={3.4} fill={PALETTE['goose-soft']} transform="rotate(-8 40 111)" />
      <path d="M41 108 h6 M41 112 h5" stroke={PALETTE['night-600']} strokeWidth={1.4} transform="rotate(-8 40 111)" />
      <path d="M31 104 L49 118" stroke={BLOOD} strokeWidth={2.4} strokeLinecap="round" transform="rotate(-8 40 111)" />
      <Held angle={-14}>
        <path d="M0 10 L0 -6" stroke={STEEL_DARK} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M-12 -8 C-14 -24 -8 -34 0 -34 C8 -34 14 -24 12 -8 C8 -2 4 -6 0 -2 C-4 -6 -8 -2 -12 -8 Z" fill="#F4F1EA" {...OUTLINE} />
        <ellipse cx={-4.5} cy={-22} rx={2.6} ry={3.4} fill={INK} />
        <ellipse cx={4.5} cy={-22} rx={2.6} ry={3.4} fill={INK} />
        <path d="M-5 -14 C-5 -17 5 -17 5 -14 C5 -10 -5 -10 -5 -14 Z" fill={PALETTE.beak} stroke={INK} strokeWidth={1.6} />
      </Held>
    </>
  ),
};

/** Nhẫn giả: khăn trùm đen (chừa khe mắt), băng trán đỏ đính phiến thép, hai chuôi kiếm sau vai, phi tiêu. */
const ninja: Outfit = {
  back: () => (
    <>
      {[
        [88, 62, 98, 40],
        [32, 62, 22, 40],
      ].map(([x1, y1, x2, y2]) => (
        <g key={x1}>
          <path d={`M${x1} ${y1} L${x2} ${y2}`} stroke={INK} strokeWidth={7} strokeLinecap="round" />
          <path d={`M${x1} ${y1} L${x2} ${y2}`} stroke={CRIMSON} strokeWidth={3.5} strokeLinecap="round" strokeDasharray="3 2" />
        </g>
      ))}
    </>
  ),
  front: () => (
    <>
      <path d="M82 60 C92 53 100 55 110 50 C106 59 98 64 86 66 Z" fill={CRIMSON} {...OUTLINE} />
      <path d="M83 64 C94 65 100 71 108 72 C100 76 92 74 85 70 Z" fill={CRIMSON} {...OUTLINE} />
      <path data-part="mask" d={NINJA_MASK} fillRule="evenodd" fill={BLACK} {...OUTLINE} />
      <path d="M38 52 C46 47 74 47 82 52 L83 58 C74 54 46 54 37 58 Z" fill={CRIMSON} {...OUTLINE} strokeWidth={2.5} />
      <rect x={52} y={49} width={16} height={7} rx={1.5} fill={STEEL} {...OUTLINE} strokeWidth={2} />
      <path d="M56 52.5 h8" stroke={INK} strokeWidth={1.4} />
      <g transform="translate(104 104)">
        <path d={starPath(0, 0, 11, 3.5, 4)} fill={STEEL} {...OUTLINE} strokeWidth={2.4} />
        <circle r={2.4} fill={BLACK} />
      </g>
      <Grip y={124} angle={-20} />
    </>
  ),
};

/** Kẻ kéo lê: mũ chóp cao cắm lông quạ, áo đuôi tôm đen, vác xẻng đào huyệt. */
const undertaker: Outfit = {
  back: () => (
    <>
      <path d="M30 120 C24 132 22 144 26 156 L38 150 L40 132 Z" fill={BLACK} {...OUTLINE} />
      <path d="M30 120 C24 132 22 144 26 156 L38 150 L40 132 Z" transform={MIRROR} fill={BLACK} {...OUTLINE} />
    </>
  ),
  front: () => (
    <>
      <path d="M45 53 L47 31 L73 31 L75 53 Z" fill={BLACK} {...OUTLINE} />
      <rect x={45.5} y={45} width={29} height={5} fill={CRIMSON} stroke={INK} strokeWidth={1.8} />
      <path d="M73 46 C80 40 86 34 90 30 C88 38 84 44 76 49 Z" fill="#2A2340" {...OUTLINE} strokeWidth={2} />
      <path d="M75 46 L87 33" stroke="#5A5170" strokeWidth={1.2} />
      <ellipse cx={60} cy={54} rx={25} ry={4} fill={BLACK} {...OUTLINE} />
      <Suit jacket={BLACK} shirt="#CFC8DA" tie={BLACK} />
      <Held angle={22}>
        <path d="M0 14 L0 -30" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        <path d="M0 14 L0 -30" stroke={WOOD} strokeWidth={3} strokeLinecap="round" />
        <path d="M-9 -30 L9 -30 L8 -46 C4 -54 -4 -54 -8 -46 Z" fill={STEEL_DARK} {...OUTLINE} />
        <path d="M-5 -34 L-5 -44" stroke={STEEL} strokeWidth={1.6} strokeLinecap="round" />
        <path d="M-6 -48 C-2 -46 2 -46 6 -48" fill="none" stroke="#5A3818" strokeWidth={2} />
      </Held>
    </>
  ),
};

/** Tàng hình: mũ trùm trong suốt lấp lánh, nửa dưới thân tan thành vạch, lọ thuốc tàng hình. */
const invisibility: Outfit = {
  front: () => (
    <>
      <path d={HOOD} fill="#9FB4FF" fillOpacity={0.3} stroke="#CFE0FF" strokeWidth={2} strokeDasharray="4 3" strokeLinejoin="round" />
      <g fill={PALETTE['night-800']} opacity={0.55}>
        <rect x={18} y={122} width={84} height={3} />
        <rect x={20} y={130} width={82} height={4} />
        <rect x={24} y={139} width={72} height={5} />
      </g>
      <g fill={PALETTE.white}>
        <path className="aura-twinkle" d={starPath(22, 60, 4, 1.2, 4)} />
        <path className="aura-twinkle" style={{ animationDelay: '-0.7s' }} d={starPath(98, 48, 3.5, 1, 4)} />
        <path className="aura-twinkle" style={{ animationDelay: '-1.4s' }} d={starPath(14, 112, 3, 1, 4)} />
      </g>
      <Held angle={-6}>
        <rect x={-3} y={-24} width={6} height={6} rx={1} fill={WOOD} {...OUTLINE} strokeWidth={2} />
        <path d="M-3 -18 L-3 -14 C-11 -10 -11 4 0 4 C11 4 11 -10 3 -14 L3 -18 Z" fill="#7FE7FF" fillOpacity={0.75} {...OUTLINE} strokeWidth={2.5} />
        <circle cx={-3} cy={-6} r={1.8} fill={PALETTE.white} opacity={0.9} />
      </Held>
    </>
  ),
};

/** Kẻ giết người hàng loạt: mặt nạ khúc côn cầu (chừa hai lỗ mắt), dao rựa dính máu. */
const serialKiller: Outfit = {
  front: () => (
    <>
      <path
        d="M60 44 C76 44 86 54 86 72 C86 88 76 100 60 102 C44 100 34 88 34 72 C34 54 44 44 60 44 Z M50 61 a8.5 8 0 1 0 0.01 0 Z M70 61 a8.5 8 0 1 0 0.01 0 Z"
        fillRule="evenodd"
        fill="#F1EEE6"
        {...OUTLINE}
      />
      <g fill={INK}>
        {[
          [52, 84],
          [60, 86],
          [68, 84],
          [56, 92],
          [64, 92],
          [60, 52],
          [48, 50],
          [72, 50],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={1.5} />
        ))}
      </g>
      <path d="M40 58 L44 54 L48 58 M72 58 L76 54 L80 58" fill="none" stroke={BLOOD} strokeWidth={2.2} strokeLinejoin="round" />
      <path d="M78 92 L80 98" stroke={BLOOD} strokeWidth={2.4} strokeLinecap="round" />
      <Held angle={24}>
        <rect x={-3.5} y={0} width={7} height={15} rx={2.5} fill={BLACK} {...OUTLINE} />
        <path d="M-5 -2 L-6 -38 C-6 -46 4 -48 9 -44 L6 -2 Z" fill={STEEL} {...OUTLINE} />
        <path d="M7.5 -36 L6.5 -12" stroke={BLOOD} strokeWidth={3.4} strokeLinecap="round" />
        <path d="M6.5 -18 Q9 -10 6.5 -6 Q4 -10 6.5 -18 Z" fill={BLOOD} />
      </Held>
    </>
  ),
};

/** Thầy pháp: mũ trùm tím đen mọc sừng, phù văn xanh độc, gậy đầu lâu lửa xanh, bầy châu chấu. */
const warlock: Outfit = {
  front: () => (
    <>
      <Hood fill="#2A1F3D" trim={TOXIC} />
      <path d="M44 38 C36 36 30 30 31 29 C38 31 44 32 50 34 Z" fill={BONE} {...OUTLINE} strokeWidth={2.4} />
      <path d="M44 38 C36 36 30 30 31 29 C38 31 44 32 50 34 Z" transform={MIRROR} fill={BONE} {...OUTLINE} strokeWidth={2.4} />
      <path d="M60 40 L64 46 L60 48 L56 46 Z M60 40 L60 36" fill="none" stroke={TOXIC} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {[
        [16, 70, 20],
        [24, 116, -30],
        [108, 44, 10],
      ].map(([x, y, a]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${a})`}>
          <ellipse rx={4.5} ry={2.2} fill="#7A6A2A" stroke={INK} strokeWidth={1.4} />
          <path d="M-1 -1 C-3 -6 2 -7 3 -2" fill="#CFE0A0" fillOpacity={0.7} stroke={INK} strokeWidth={1} />
        </g>
      ))}
      <Held angle={10}>
        <path d="M0 14 L0 -40" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        <path d="M0 14 L0 -40" stroke="#3A2A1A" strokeWidth={3} strokeLinecap="round" />
        <circle cx={0} cy={-52} r={12} fill={TOXIC} opacity={0.3} />
        <path d="M-7 -46 C-9 -56 -4 -60 0 -60 C4 -60 9 -56 7 -46 L4 -42 L-4 -42 Z" fill={BONE} {...OUTLINE} strokeWidth={2.4} />
        <circle cx={-3} cy={-51} r={2} fill={TOXIC} />
        <circle cx={3} cy={-51} r={2} fill={TOXIC} />
        <path d="M-2 -44 L-2 -42 M2 -44 L2 -42" stroke={INK} strokeWidth={1.2} />
      </Held>
    </>
  ),
};

/** Siêu năng lực gia: vòng trán đá tím phát sáng, sóng tâm linh hai bên đầu, hai con dao lơ lửng. */
const esper: Outfit = {
  front: () => (
    <>
      <path d="M37 54 C46 49 74 49 83 54" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <path d="M37 54 C46 49 74 49 83 54" fill="none" stroke={GOLD} strokeWidth={2.4} strokeLinecap="round" />
      <circle cx={60} cy={50} r={8} fill={PALETTE.third} opacity={0.35} />
      <path d="M60 44 L65 50 L60 56 L55 50 Z" fill="#B57BFF" {...OUTLINE} strokeWidth={2.2} />
      <g fill="none" stroke="#B57BFF" strokeWidth={2.2} strokeLinecap="round" opacity={0.8}>
        <path d="M30 60 C24 66 24 76 30 82 M22 56 C14 64 14 78 22 86" />
        <path d="M90 60 C96 66 96 76 90 82 M98 56 C106 64 106 78 98 86" />
      </g>
      {[
        [106, 104, 160],
        [16, 120, -150],
      ].map(([x, y, a]) => (
        <g key={x} transform={`translate(${x} ${y}) rotate(${a})`}>
          <circle cx={0} cy={-12} r={12} fill={PALETTE.third} opacity={0.18} />
          <Dagger length={22} hilt={VIOLET} />
        </g>
      ))}
    </>
  ),
};

/** Nhà truyền giáo: mũ rộng vành đen dải đỏ, cổ áo linh mục, tràng hạt đỏ, sách đen phù hiệu mắt đỏ. */
const preacher: Outfit = {
  front: () => (
    <>
      <path d="M44 52 C44 40 51 36 60 36 C69 36 76 40 76 52 Z" fill={BLACK} {...OUTLINE} />
      <rect x={44} y={46} width={32} height={5} fill={CRIMSON} stroke={INK} strokeWidth={1.8} />
      <ellipse cx={60} cy={54} rx={36} ry={5} fill={BLACK} {...OUTLINE} />
      <path d="M32 93 C46 101 74 101 88 93 L88 104 C74 112 46 112 32 104 Z" fill={BLACK} {...OUTLINE} />
      <rect x={55} y={98} width={10} height={7} rx={1} fill={PALETTE.white} stroke={INK} strokeWidth={1.8} />
      <path d="M40 104 Q60 132 80 104" fill="none" stroke={BLOOD} strokeWidth={3} strokeDasharray="0.1 5" strokeLinecap="round" />
      <path d="M60 122 L60 132 M56 126 L64 126" stroke={STEEL} strokeWidth={2.4} strokeLinecap="round" />
      <Held angle={-8}>
        <rect x={-12} y={-30} width={24} height={30} rx={2} fill={BLACK} {...OUTLINE} />
        <path d="M10 -28 L10 -2" stroke="#CFC8DA" strokeWidth={2} />
        <path d="M-7 -15 C-3 -21 3 -21 7 -15 C3 -9 -3 -9 -7 -15 Z" fill="none" stroke={BLOOD} strokeWidth={1.8} />
        <circle cx={0} cy={-15} r={2.2} fill={BLOOD} />
      </Held>
    </>
  ),
};

/** Thần tình yêu: cánh đen thiên thần sa ngã, cung gỗ đen, mũi tên đầu tim, sợi chỉ đỏ quấn. */
const cupid: Outfit = {
  back: () => (
    <>
      {[0, 1].map((side) => (
        <g key={side} transform={side ? MIRROR : undefined}>
          <path d="M36 94 C26 80 14 70 4 70 C6 76 8 80 12 82 C6 84 4 88 6 92 C10 90 14 92 16 94 C12 98 12 102 16 104 C22 100 28 100 34 104 Z" fill={BLACK} {...OUTLINE} />
          <path d="M14 84 C20 86 26 88 32 94 M18 96 C24 96 28 98 32 100" fill="none" stroke="#4A4458" strokeWidth={1.6} />
        </g>
      ))}
    </>
  ),
  front: () => (
    <>
      <path d="M30 108 C42 122 52 104 62 118 C72 132 82 112 92 124" fill="none" stroke={BLOOD} strokeWidth={2} strokeLinecap="round" />
      <Held angle={-6}>
        <path d="M-6 16 C14 4 14 -42 -6 -54" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        <path d="M-6 16 C14 4 14 -42 -6 -54" fill="none" stroke="#3A2A2A" strokeWidth={3} strokeLinecap="round" />
        <path d="M-6 16 L-6 -54" stroke={PALETTE.white} strokeWidth={1.2} opacity={0.85} />
        <path d="M-18 -16 L12 -22" stroke={INK} strokeWidth={4} strokeLinecap="round" />
        <path d="M-18 -16 L12 -22" stroke={STEEL_DARK} strokeWidth={1.8} strokeLinecap="round" />
        <path d="M12 -22 C14 -28 20 -28 20 -24 C22 -28 26 -24 22 -20 L15 -16 Z" fill={BLOOD} {...OUTLINE} strokeWidth={2} />
        <path d="M-18 -16 L-22 -20 M-18 -16 L-22 -12" stroke={BLACK} strokeWidth={2.4} strokeLinecap="round" />
      </Held>
    </>
  ),
};

/** Quái vật: sừng cong, hàm răng nhọn trùm mỏ, dãi xanh, đuôi gai sau lưng. */
const drone: Outfit = {
  back: () => (
    <path d="M30 128 C16 134 8 128 6 118 L12 120 L10 112 L16 116 L16 106 L22 113 L24 104 L28 112 L34 116 Z" fill="#3A2F4F" {...OUTLINE} />
  ),
  front: () => (
    <>
      <path d="M44 46 C34 42 28 34 30 29 C36 34 44 37 50 40 Z" fill="#3A2F4F" {...OUTLINE} />
      <path d="M44 46 C34 42 28 34 30 29 C36 34 44 37 50 40 Z" transform={MIRROR} fill="#3A2F4F" {...OUTLINE} />
      <path d="M46 40 L52 30 L54 38 L60 28.5 L66 38 L68 30 L74 40" fill="#3A2F4F" {...OUTLINE} strokeWidth={2.4} />
      <path d="M45 84 L48 92 L51 85 L54 93 L57 86 L60 94 L63 86 L66 93 L69 85 L72 92 L75 84" fill={PALETTE.white} {...OUTLINE} strokeWidth={1.8} />
      <path d="M68 92 C69 98 66 102 68 106 C70 102 72 100 70 94" fill={TOXIC} stroke={INK} strokeWidth={1.2} />
      <path d="M40 112 L46 126 M48 108 L54 124 M56 108 L60 120" stroke={PALETTE['night-700']} strokeWidth={3} strokeLinecap="round" opacity={0.7} />
      <g transform="translate(96 124)">
        {[-30, -10, 10].map((a) => (
          <path key={a} d="M0 0 C2 -6 6 -10 10 -12 C8 -8 6 -4 6 2 Z" transform={`rotate(${a})`} fill={BONE} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
        ))}
      </g>
      <Grip angle={-20} />
    </>
  ),
};

/** Nghệ sĩ kịch câm: mũ nồi đen, giọt lệ vẽ dưới mắt, cổ áo sọc, khăn đỏ, tay cầm khung giật dây rối. */
const mime: Outfit = {
  front: () => (
    <>
      <Beret fill={BLACK} />
      <path d="M44 78 C42 82 44 86 46 86 C48 86 49 82 44 78 Z" fill={INK} />
      <path d="M33 93 C46 101 74 101 87 93 L88 105 C74 113 46 113 32 105 Z" fill={PALETTE.white} {...OUTLINE} />
      <path d="M34 99 C46 106 74 106 86 99" fill="none" stroke={INK} strokeWidth={3} />
      <path d="M52 106 L60 114 L68 106 L66 124 L60 118 L54 124 Z" fill={BLOOD} {...OUTLINE} strokeWidth={2.2} />
      <Held angle={0}>
        <path d="M0 4 L0 -28" stroke={INK} strokeWidth={5} strokeLinecap="round" />
        <path d="M0 4 L0 -28" stroke={WOOD} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M-12 -22 L12 -22" stroke={INK} strokeWidth={5} strokeLinecap="round" />
        <path d="M-12 -22 L12 -22" stroke={WOOD} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M-12 -22 L-16 18 M12 -22 L18 14 M0 -28 L-4 -4" stroke={PALETTE.white} strokeWidth={1} opacity={0.75} />
      </Held>
    </>
  ),
};

/** Chú hề: tóc xù đỏ hai bên, mũi đỏ, cổ áo bèo đen-đỏ rách, bóng bay đỏ mặt cười gian. */
const clown: Outfit = {
  front: () => (
    <>
      <path d="M38 58 C28 58 22 50 26 44 C22 40 28 32 34 36 C36 30 44 32 44 38 C44 44 42 50 38 58 Z" fill={BLOOD} {...OUTLINE} />
      <path d="M38 58 C28 58 22 50 26 44 C22 40 28 32 34 36 C36 30 44 32 44 38 C44 44 42 50 38 58 Z" transform={MIRROR} fill={BLOOD} {...OUTLINE} />
      <circle cx={60} cy={80} r={5} fill={BLOOD} {...OUTLINE} strokeWidth={2.2} />
      <circle cx={58.5} cy={78.5} r={1.4} fill={PALETTE.white} />
      <path d="M32 96 L38 104 L44 98 L50 106 L56 100 L60 108 L64 100 L70 106 L76 98 L82 104 L88 96 C74 92 46 92 32 96 Z" fill={BLACK} {...OUTLINE} strokeWidth={2.4} />
      <path d="M38 104 L41 110 L44 102 M64 102 L67 110 L70 104" fill={BLOOD} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <path d="M96 122 C100 110 104 100 104 86" fill="none" stroke={PALETTE.white} strokeWidth={1.2} />
      <ellipse cx={104} cy={74} rx={11} ry={13} fill={BLOOD} {...OUTLINE} />
      <path d="M102 87 L106 87 L104 90 Z" fill={BLOOD} stroke={INK} strokeWidth={1.4} />
      <path d="M99 70 L102 72 M109 70 L106 72" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M98 77 C101 81 107 81 110 77" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M99 66 C100 64 102 63 103 63" fill="none" stroke={PALETTE.white} strokeWidth={1.6} strokeLinecap="round" opacity={0.7} />
      <Grip angle={-10} />
    </>
  ),
};

/** Kẻ hôi của: mũ dẹt, khăn bịt mặt nâu, vác bao tải tiền rơi vàng. */
const looter: Outfit = {
  front: () => (
    <>
      <path d="M40 53 C40 43 48 38 60 38 C72 38 80 43 80 53 Z" fill="#5A4A3A" {...OUTLINE} />
      <path d="M36 54 C42 49 66 48 86 52 L85 57 C66 54 44 55 37 58 Z" fill="#5A4A3A" {...OUTLINE} />
      <Bandana fill="#7A5230" fold="#4A3018" />
      <Held angle={-2}>
        <path d="M-4 6 L-2 -6 L2 -6 L4 6 Z" fill="#B08A5A" {...OUTLINE} strokeWidth={2} />
        <path d="M-2 -6 C-18 -8 -20 -36 0 -40 C20 -36 18 -8 2 -6 Z" fill="#B08A5A" {...OUTLINE} />
        <path d="M0 -32 L0 -14 M4 -29 C-4 -31 -6 -24 0 -23 C6 -22 4 -15 -4 -17" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      </Held>
      <g fill={GOLD} stroke={INK} strokeWidth={1.4}>
        <ellipse cx={86} cy={140} rx={4} ry={2.4} />
        <ellipse cx={110} cy={146} rx={3.5} ry={2} />
      </g>
    </>
  ),
};

/** Bắn tỉa: mũ nồi đen huy hiệu đầu lâu, vằn sơn rằn ri dưới mắt, súng bắn tỉa tia laser đỏ. */
const sniper: Outfit = {
  front: () => (
    <>
      <Beret
        fill={BLACK}
        badge={
          <g>
            <circle cx={46} cy={47} r={4} fill={BONE} stroke={INK} strokeWidth={1.4} />
            <path d="M44 46.5 h1 M47 46.5 h1" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
          </g>
        }
      />
      <path d="M38 80 L46 78 M74 78 L82 80 M36 85 L44 83" stroke="#2F4A2A" strokeWidth={2.6} strokeLinecap="round" />
      <Held angle={18}>
        <Rifle />
        <path d="M0 -72 L0 -104" stroke={BLOOD} strokeWidth={1} opacity={0.7} />
      </Held>
    </>
  ),
};

/** Thầy phù thuỷ: đầu lâu làm mũ cắm lông đỏ đen, vòng cổ xương, búp bê voodoo cắm ghim. */
const witchDoctor: Outfit = {
  front: () => (
    <>
      {[-80, -60, -40, 40, 60, 80].map((a, i) => (
        <path key={a} d="M60 52 C55 42 56 32 60 24 C64 32 65 42 60 52 Z" transform={`rotate(${a} 60 54)`} fill={i % 2 ? BLOOD : BLACK} {...OUTLINE} strokeWidth={2} />
      ))}
      <path d="M46 54 C44 42 51 34 60 34 C69 34 76 42 74 54 L69 57 L51 57 Z" fill={BONE} {...OUTLINE} />
      <ellipse cx={54} cy={46} rx={4} ry={4.5} fill={INK} />
      <ellipse cx={66} cy={46} rx={4} ry={4.5} fill={INK} />
      <circle cx={54} cy={46.5} r={1.6} fill={TOXIC} />
      <circle cx={66} cy={46.5} r={1.6} fill={TOXIC} />
      <path d="M60 50 L58 53 L62 53 Z" fill={INK} />
      <path d="M54 55 L54 57 M58 55 L58 57 M62 55 L62 57 M66 55 L66 57" stroke={INK} strokeWidth={1.2} />
      <path d="M36 97 Q60 114 84 97" fill="none" stroke={INK} strokeWidth={1.6} />
      {[40, 48, 56, 64, 72, 80].map((x, i) => (
        <path key={x} d={`M${x} ${98 + Math.sin((i / 5) * Math.PI) * 9} l0 7`} stroke={BONE} strokeWidth={3.4} strokeLinecap="round" />
      ))}
      <Held angle={-10}>
        <path d="M-7 -8 C-7 -20 7 -20 7 -8 L10 -4 L6 -2 L8 8 L2 8 L0 2 L-2 8 L-8 8 L-6 -2 L-10 -4 Z" fill="#B58A5A" {...OUTLINE} strokeWidth={2.2} />
        <path d="M-3 -14 l2 2 M-1 -14 l-2 2 M2 -13 l3 0" stroke={INK} strokeWidth={1.2} />
        <path d="M-2 -6 L-12 -16 M3 -2 L12 -12" stroke={STEEL_DARK} strokeWidth={1.4} />
        <circle cx={-12} cy={-16} r={1.8} fill={BLOOD} />
        <circle cx={12} cy={-12} r={1.8} fill={TOXIC} />
      </Held>
    </>
  ),
};

/** Vịt con lạc lối: vỏ trứng nứt trên đầu, băng cá nhân, cầm con dao bếp to gấp đôi người. */
const lostDuckling: Outfit = {
  front: () => (
    <>
      <path d="M40 53 C40 41 48 34 60 34 C72 34 80 41 80 53 L76 49 L72 54 L67 48 L62 54 L57 48 L52 54 L47 48 L43 53 Z" fill="#F6F1E4" {...OUTLINE} />
      <path d="M54 37 L57 42 L54 45" fill="none" stroke={INK} strokeWidth={1.4} />
      <path d="M58 32 C56 28 62 27 61 32" fill={GOLD} stroke={INK} strokeWidth={1.4} />
      <g transform="rotate(-30 40 92)">
        <rect x={32} y={88} width={16} height={7} rx={3} fill="#F2C9A0" stroke={INK} strokeWidth={1.8} />
        <path d="M38 90 v3 M42 90 v3" stroke="#C99A70" strokeWidth={1} />
      </g>
      <Held angle={14}>
        <Dagger length={44} hilt={BLACK} blood />
      </Held>
    </>
  ),
};

/** Vật chủ: mặt nạ phòng độc hai bình lọc, phù hiệu sinh học, ống nghiệm ký sinh trùng xanh độc. */
const carrier: Outfit = {
  front: () => (
    <>
      <path d="M38 78 C46 74 74 74 82 78 L84 92 C76 100 44 100 36 92 Z" fill={GUN} {...OUTLINE} />
      <circle cx={42} cy={94} r={7} fill={BLACK} {...OUTLINE} strokeWidth={2.4} />
      <circle cx={78} cy={94} r={7} fill={BLACK} {...OUTLINE} strokeWidth={2.4} />
      <circle cx={42} cy={94} r={3} fill={TOXIC} opacity={0.8} />
      <circle cx={78} cy={94} r={3} fill={TOXIC} opacity={0.8} />
      <rect x={54} y={84} width={12} height={8} rx={2} fill={BLACK} stroke={INK} strokeWidth={1.8} />
      <path d="M38 78 C30 70 32 62 36 58 M82 78 C90 70 88 62 84 58" fill="none" stroke={BLACK} strokeWidth={2.6} strokeLinecap="round" />
      <circle cx={60} cy={120} r={8} fill={GOLD} {...OUTLINE} strokeWidth={2.4} />
      <g fill={INK}>
        <circle cx={60} cy={116.5} r={2.4} />
        <circle cx={57} cy={121.5} r={2.4} />
        <circle cx={63} cy={121.5} r={2.4} />
      </g>
      <circle cx={60} cy={120} r={1.4} fill={GOLD} />
      <Held angle={-8}>
        <rect x={-5} y={-36} width={10} height={4} rx={1.5} fill={GUN} {...OUTLINE} strokeWidth={2} />
        <path d="M-4 -32 L-4 -2 C-4 4 4 4 4 -2 L4 -32 Z" fill={TOXIC} fillOpacity={0.55} {...OUTLINE} strokeWidth={2.4} />
        <path d="M-1 -24 C2 -22 -2 -18 1 -16 M0 -12 C3 -10 -1 -6 2 -4" fill="none" stroke="#2F5B1A" strokeWidth={1.6} strokeLinecap="round" />
      </Held>
    </>
  ),
};

/** Ký sinh trùng: xúc tu tím mọc từ đỉnh đầu và sau lưng, gân xanh độc phát sáng trên thân. */
const parasite: Outfit = {
  back: () => (
    <>
      <path d="M34 100 C20 96 12 84 16 72 C20 66 26 70 22 76 C20 82 26 90 36 92 Z" fill="#6A3A8A" {...OUTLINE} />
      <path d="M86 100 C102 100 110 88 108 76 C106 70 100 72 102 78 C104 86 96 92 86 92 Z" fill="#6A3A8A" {...OUTLINE} />
    </>
  ),
  front: () => (
    <>
      {[
        'M50 42 C42 36 40 30 46 29 C50 30 46 34 52 38 Z',
        'M58 39 C56 33 60 29 64 30 C66 32 62 34 62 39 Z',
        'M68 41 C74 34 80 32 82 36 C82 40 76 38 70 44 Z',
      ].map((d) => (
        <path key={d} d={d} fill="#8A4FB0" {...OUTLINE} strokeWidth={2.4} />
      ))}
      <g fill="#C9A2F2">
        <circle cx={46} cy={33} r={1} />
        <circle cx={62} cy={32} r={1} />
        <circle cx={78} cy={36} r={1} />
      </g>
      <g fill="none" stroke={TOXIC} strokeWidth={1.8} strokeLinecap="round" opacity={0.85}>
        <path d="M40 108 C46 114 42 120 48 126 M48 126 L44 132 M48 126 L54 130" />
        <path d="M74 104 C70 110 76 116 72 122 M72 122 L66 126" />
      </g>
      <circle cx={60} cy={118} r={4} fill={TOXIC} opacity={0.5} />
      <Grip y={124} angle={-15} />
    </>
  ),
};

/** Kiếm sĩ: nón lá samurai nghiêng, vết sẹo chéo mắt trái, khăn đỏ bay, katana tuốt trần. */
const swordsman: Outfit = {
  back: () => (
    <g transform="rotate(-30 60 120)">
      <rect x={16} y={116} width={50} height={6} rx={3} fill={BLACK} {...OUTLINE} />
      <rect x={10} y={115} width={8} height={8} rx={2} fill={CRIMSON} {...OUTLINE} strokeWidth={2} />
    </g>
  ),
  front: () => (
    <>
      <g transform="rotate(-8 60 48)">
        <path d="M22 56 L60 31 L98 56 Q60 62 22 56 Z" fill="#C9A75A" {...OUTLINE} />
        <path d="M60 31 L40 57 M60 31 L52 59 M60 31 L68 59 M60 31 L80 57" stroke="#8C6A2A" strokeWidth={1.2} />
      </g>
      <path d="M40 58 L54 76" stroke={BLOOD} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
      <path d="M44 63 L48 61 M48 68 L52 66" stroke={BLOOD} strokeWidth={1.4} strokeLinecap="round" opacity={0.85} />
      <path d="M33 93 C46 101 74 101 87 93 L88 103 C74 111 46 111 32 103 Z" fill={CRIMSON} {...OUTLINE} />
      <path d="M34 98 C22 96 14 102 6 98 C10 106 22 108 33 103 Z" fill={CRIMSON} {...OUTLINE} />
      <Held angle={20}>
        <rect x={-3} y={0} width={6} height={18} rx={2} fill={BLACK} {...OUTLINE} strokeWidth={2.4} />
        <path d="M-2 3 l4 3 M-2 9 l4 3" stroke={CRIMSON} strokeWidth={1.4} />
        <ellipse cx={0} cy={-1} rx={7} ry={2.6} fill={GOLD} {...OUTLINE} strokeWidth={2} />
        <path d="M-3 -3 L-3 -56 C-3 -62 2 -66 4 -66 L3 -3 Z" fill={STEEL} {...OUTLINE} strokeWidth={2.4} />
        <path d="M0 -8 L0 -56" stroke={PALETTE.white} strokeWidth={1.2} opacity={0.8} />
      </Held>
    </>
  ),
};

// --- Role của chế độ đặc biệt ---

/** Đại tư tế: mũ mitre đen viền vàng có mắt đỏ, áo choàng nghi lễ, dao tế cong. */
const highPriest: Outfit = {
  back: () => <Cape fill="#2A0E14" lining={GOLD} />,
  front: () => (
    <>
      <path d="M42 56 C40 44 50 35 60 29 C70 35 80 44 78 56 Z" fill={BLACK} {...OUTLINE} />
      <path d="M60 30 L60 56" stroke={GOLD} strokeWidth={2.4} />
      <rect x={41} y={50} width={38} height={6} fill={GOLD} stroke={INK} strokeWidth={1.8} />
      <path d="M52 42 C56 38 64 38 68 42 C64 46 56 46 52 42 Z" fill={PALETTE.white} stroke={INK} strokeWidth={1.6} />
      <circle cx={60} cy={42} r={2.4} fill={BLOOD} />
      <path d="M32 92 L60 112 L88 92 L86 104 L60 124 L34 104 Z" fill={CRIMSON} {...OUTLINE} />
      <path d="M40 100 L60 115 L80 100" fill="none" stroke={GOLD} strokeWidth={2} />
      <Held angle={-16}>
        <rect x={-3} y={0} width={6} height={14} rx={2} fill={GOLD} {...OUTLINE} strokeWidth={2.2} />
        <path d="M-4 -2 C-8 -16 -2 -28 8 -34 C4 -24 6 -12 4 -2 Z" fill={STEEL} {...OUTLINE} strokeWidth={2.4} />
        <circle cx={0} cy={2} r={2} fill={BLOOD} />
      </Held>
    </>
  ),
};

/** Tông đồ: mũ trùm đỏ sẫm, dây thừng thắt ngang, cầm nến đen lửa đỏ. */
const initiate: Outfit = {
  front: () => (
    <>
      <Hood fill="#5A1A22" />
      <path d="M26 124 C44 132 76 132 94 124" fill="none" stroke="#C9A86A" strokeWidth={3.5} strokeLinecap="round" />
      <path d="M40 129 L38 142 M44 130 L44 144" stroke="#C9A86A" strokeWidth={2.4} strokeLinecap="round" />
      <Held angle={-4}>
        <rect x={-4} y={-22} width={8} height={26} rx={1.5} fill={BLACK} {...OUTLINE} strokeWidth={2.4} />
        <path d="M-4 -18 C-6 -14 -4 -12 -4 -10" fill="none" stroke={BLACK} strokeWidth={2} />
        <circle cx={0} cy={-30} r={8} fill={BLOOD} opacity={0.25} />
        <path d="M0 -36 C4 -30 4 -26 0 -24 C-4 -26 -4 -30 0 -36 Z" fill={BLOOD} stroke={INK} strokeWidth={1.4} />
      </Held>
    </>
  ),
};

/** Kẻ xoá tội: mũ trùm đen viền xám, xích sắt quanh cổ, chén thánh rượu đen bốc khói. */
const sinEater: Outfit = {
  front: () => (
    <>
      <Hood fill={BLACK} trim={STEEL_DARK} />
      <path d="M36 100 Q60 116 84 100" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <path d="M36 100 Q60 116 84 100" fill="none" stroke={STEEL_DARK} strokeWidth={3} strokeLinecap="round" strokeDasharray="4 2" />
      <Held angle={-4}>
        <path d="M-6 10 L6 10 L3 4 L1 -6 L-1 -6 L-3 4 Z" fill={GOLD} {...OUTLINE} strokeWidth={2.2} />
        <path d="M-11 -20 L11 -20 C11 -10 6 -6 0 -6 C-6 -6 -11 -10 -11 -20 Z" fill={GOLD} {...OUTLINE} />
        <ellipse cx={0} cy={-20} rx={11} ry={3} fill="#2A1630" {...OUTLINE} strokeWidth={2} />
        <path d="M-3 -24 C-6 -30 0 -32 -3 -38 M4 -24 C1 -30 7 -32 4 -38" fill="none" stroke="#8A7A9A" strokeWidth={1.8} strokeLinecap="round" opacity={0.75} />
      </Held>
    </>
  ),
};

/** Vampire: tóc chữ V rẽ ngôi, cổ áo dựng, nanh, ly máu; áo choàng tím lót đỏ sau lưng. */
const vampire: Outfit = {
  back: () => <Cape fill="#3D2B66" lining="#C1272D" />,
  front: () => (
    <>
      <path d="M38 56 C36 42 46 35 60 35 C74 35 84 42 82 56 C74 52 66 50 60 58 C54 50 46 52 38 56 Z" fill={BLACK} {...OUTLINE} />
      <path d="M33 80 L46 92 L36 110 L28 96 Z" fill="#3D2B66" {...OUTLINE} />
      <path d="M33 80 L46 92 L36 110 L28 96 Z" transform={MIRROR} fill="#3D2B66" {...OUTLINE} />
      <circle cx={60} cy={106} r={3.5} fill={GOLD} {...OUTLINE} strokeWidth={2} />
      <circle cx={60} cy={106} r={1.4} fill={BLOOD} />
      <Held angle={-6}>
        <path d="M-2 14 L-2 -4 L2 -4 L2 14 Z" fill={GOLD} {...OUTLINE} strokeWidth={2} />
        <ellipse cx={0} cy={14} rx={7} ry={2.5} fill={GOLD} {...OUTLINE} strokeWidth={2} />
        <path d="M-10 -22 C-10 -10 -6 -4 0 -4 C6 -4 10 -10 10 -22 Z" fill={BLOOD} {...OUTLINE} strokeWidth={2.4} />
        <ellipse cx={0} cy={-22} rx={10} ry={2.6} fill="#8A0F18" {...OUTLINE} strokeWidth={2} />
      </Held>
    </>
  ),
};

/** Mummy: băng vải quấn đầu và thân, che bớt mắt trái, mắt phải rực đỏ. */
const mummy: Outfit = {
  front: () => (
    <>
      {[
        'M38 44 C48 36 72 36 84 46 L82 52 C70 44 50 44 38 50 Z',
        'M30 56 L64 72 L62 78 L28 63 Z',
        'M86 82 C72 86 50 88 34 84 L34 90 C50 94 72 92 86 88 Z',
        'M24 108 C44 102 70 112 96 104 L98 111 C72 119 44 109 23 115 Z',
        'M22 128 C44 136 76 124 98 132 L96 139 C76 131 44 143 24 135 Z',
      ].map((d) => (
        <path key={d} d={d} fill="#E8DDC0" {...OUTLINE} strokeWidth={2.4} />
      ))}
      <path d="M42 46 L48 43 M66 41 L72 44 M38 60 L44 62 M40 110 L46 108 M70 112 L76 110 M44 133 L50 135" stroke="#B8A880" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M96 111 C102 114 104 120 100 124" fill="none" stroke="#E8DDC0" strokeWidth={4} strokeLinecap="round" />
      <Grip y={124} angle={-15} />
    </>
  ),
};

/** Thrall: vết cắn trên cổ, vòng sắt có xích, đèn lồng xanh lập loè. */
const thrall: Outfit = {
  front: () => (
    <>
      <circle cx={34} cy={92} r={1.8} fill={BLOOD} />
      <circle cx={38} cy={94} r={1.8} fill={BLOOD} />
      <path d="M34 94 L33 98 M38 96 L38 100" stroke={BLOOD} strokeWidth={1.2} strokeLinecap="round" />
      <path d="M34 96 C46 104 74 104 86 96 L86 103 C74 111 46 111 34 103 Z" fill={GUN} {...OUTLINE} />
      <circle cx={60} cy={108} r={3.5} fill="none" stroke={INK} strokeWidth={4} />
      <circle cx={60} cy={108} r={3.5} fill="none" stroke={STEEL_DARK} strokeWidth={2} />
      <path d="M60 112 C58 120 64 126 60 134 C58 140 52 142 48 146" fill="none" stroke={STEEL_DARK} strokeWidth={2.4} strokeDasharray="3 1.5" />
      <Held angle={-6}>
        <path d="M0 2 L0 -6" stroke={INK} strokeWidth={2} />
        <path d="M-6 -6 C-6 -12 6 -12 6 -6" fill="none" stroke={INK} strokeWidth={2} />
        <rect x={-8} y={-30} width={16} height={20} rx={3} fill={TOXIC} fillOpacity={0.45} {...OUTLINE} strokeWidth={2.4} />
        <path d="M-9 -30 L9 -30 L6 -34 L-6 -34 Z M-9 -10 L9 -10 L7 -6 L-7 -6 Z" fill={GUN} {...OUTLINE} strokeWidth={2} />
        <path d="M0 -26 C3 -22 3 -18 0 -14 C-3 -18 -3 -22 0 -26 Z" fill={TOXIC} />
      </Held>
    </>
  ),
};

/** Dr. Turducken: kính bảo hộ tròn trên trán, khẩu trang dính máu kéo xuống cổ, áo blouse vấy máu, cưa xương. */
const drTurducken: Outfit = {
  front: () => (
    <>
      <path d="M37 52 C44 47 76 47 83 52" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <circle cx={50} cy={49} r={6.5} fill="#9FD8C9" fillOpacity={0.7} {...OUTLINE} strokeWidth={2.6} />
      <circle cx={70} cy={49} r={6.5} fill="#9FD8C9" fillOpacity={0.7} {...OUTLINE} strokeWidth={2.6} />
      <path d="M38 96 C48 100 72 100 82 96 L80 104 C70 108 50 108 40 104 Z" fill="#9FD8C9" {...OUTLINE} strokeWidth={2.4} />
      <path d="M52 100 C54 103 58 103 60 101" fill="none" stroke={BLOOD} strokeWidth={2} strokeLinecap="round" />
      <path d="M30 100 L46 108 L50 134 L32 128 Z" fill={PALETTE.white} {...OUTLINE} />
      <path d="M30 100 L46 108 L50 134 L32 128 Z" transform={MIRROR} fill={PALETTE.white} {...OUTLINE} />
      <Splatter x={38} y={116} />
      <Held angle={10}>
        <rect x={-4} y={-2} width={8} height={16} rx={2} fill={BLACK} {...OUTLINE} strokeWidth={2.4} />
        <path d="M-4 -2 L-4 -40 L10 -40 L10 -2 Z" fill={STEEL} {...OUTLINE} strokeWidth={2.4} />
        <path d="M10 -40 l3 3 l-3 3 l3 3 l-3 3 l3 3 l-3 3 l3 3 l-3 3 l3 3 l-3 3 l3 3 l-3 3" fill="none" stroke={INK} strokeWidth={1.4} />
        <path d="M11 -28 L11 -18" stroke={BLOOD} strokeWidth={3} strokeLinecap="round" />
      </Held>
    </>
  ),
};

/** Quái vật của Turducken: tóc đầu bằng, vết khâu ngang trán và thân, hai bu-lông ở cổ. */
const turduckenMonster: Outfit = {
  front: () => (
    <>
      <path d="M38 53 L38 37 L82 37 L82 53 C74 50 66 54 60 50 C54 54 46 50 38 53 Z" fill={BLACK} {...OUTLINE} />
      <path d="M38 37 L82 37" stroke="#4A4458" strokeWidth={1.6} />
      <path d="M44 58 L76 58" stroke={INK} strokeWidth={1.8} />
      <path d="M48 55 L48 61 M54 55 L54 61 M60 55 L60 61 M66 55 L66 61 M72 55 L72 61" stroke={INK} strokeWidth={1.4} />
      <rect x={18} y={89} width={12} height={7} rx={1.5} fill={STEEL_DARK} {...OUTLINE} strokeWidth={2.2} />
      <rect x={90} y={89} width={12} height={7} rx={1.5} fill={STEEL_DARK} {...OUTLINE} strokeWidth={2.2} />
      <path d="M30 116 C44 120 52 110 66 118 C74 122 82 116 90 118" fill="none" stroke={INK} strokeWidth={1.8} />
      {[36, 44, 52, 60, 68, 76, 84].map((x, i) => (
        <path key={x} d={`M${x} ${114 + (i % 2) * 2} l0 7`} stroke={INK} strokeWidth={1.4} />
      ))}
      <path d="M40 126 L46 140" stroke="#7FB06A" strokeWidth={3} strokeLinecap="round" opacity={0.45} />
      <Grip y={124} angle={-15} />
    </>
  ),
};

/** Wereduck: tai sói, lông xù hai má, áo rách, móng vuốt ở cánh; đuôi sói xù sau lưng. */
const wereduck: Outfit = {
  back: () => <path d="M30 130 C14 134 4 124 6 110 C12 116 16 116 18 112 C20 118 24 120 28 118 C28 122 30 126 34 126 Z" fill="#6E6578" {...OUTLINE} />,
  front: () => (
    <>
      <path d="M40 52 L36 30 L54 42 Z" fill="#6E6578" {...OUTLINE} />
      <path d="M41 46 L39 35 L49 42 Z" fill="#E5737A" />
      <path d="M40 52 L36 30 L54 42 Z" transform={MIRROR} fill="#6E6578" {...OUTLINE} />
      <path d="M41 46 L39 35 L49 42 Z" transform={MIRROR} fill="#E5737A" />
      <path d="M30 66 L24 70 L30 74 L24 80 L32 82 L28 88 L36 86" fill="#6E6578" {...OUTLINE} strokeWidth={2.4} />
      <path d="M30 66 L24 70 L30 74 L24 80 L32 82 L28 88 L36 86" transform={MIRROR} fill="#6E6578" {...OUTLINE} strokeWidth={2.4} />
      <path d="M30 100 C46 106 74 106 90 100 L92 120 L84 116 L80 126 L72 118 L66 128 L58 118 L50 128 L44 118 L36 126 L32 116 L26 120 Z" fill="#5A4A6A" {...OUTLINE} />
      <path d="M60 104 L60 116" stroke={INK} strokeWidth={1.4} opacity={0.5} />
      <g transform="translate(96 126)">
        {[-40, -14, 12].map((a) => (
          <path key={a} d="M0 0 C2 -6 6 -9 11 -10 C8 -6 6 -3 6 2 Z" transform={`rotate(${a})`} fill={BONE} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
        ))}
      </g>
      <Grip y={126} angle={-20} />
    </>
  ),
};

/** Camo Duck: mũ sắt rằn ri cắm lá cành, sơn mặt, cầm cành lá nguỵ trang. */
const camoDuck: Outfit = {
  front: () => (
    <>
      <Helmet fill="#4E6B3A" />
      <g fill="#33502A">
        <ellipse cx={48} cy={42} rx={5} ry={3} />
        <ellipse cx={68} cy={38} rx={4} ry={2.6} />
        <ellipse cx={74} cy={50} rx={4} ry={2.4} />
      </g>
      <path d="M44 38 C40 34 42 30 46 31 C46 34 46 36 44 38 Z M70 36 C72 31 77 31 77 34 C74 35 72 36 70 36 Z" fill="#7AA35A" stroke={INK} strokeWidth={1.6} />
      <path d="M38 79 L46 77 M74 77 L82 79" stroke="#33502A" strokeWidth={3} strokeLinecap="round" />
      <Held angle={-12}>
        <path d="M0 14 L0 -28" stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
        <path d="M0 14 L0 -28" stroke={WOOD} strokeWidth={2} strokeLinecap="round" />
        {[
          [-8, -30, -30],
          [7, -24, 30],
          [-7, -16, -40],
          [6, -10, 40],
          [0, -36, 0],
        ].map(([x, y, a]) => (
          <ellipse key={`${x}${y}`} cx={x} cy={y} rx={7} ry={3.6} transform={`rotate(${a} ${x} ${y})`} fill="#5E8A44" stroke={INK} strokeWidth={1.8} />
        ))}
      </Held>
    </>
  ),
};

/** Sniper (Hoot & Seek): mũ sắt gắn ống nhìn đêm xanh lật lên, súng trường giảm thanh. */
const hootSniper: Outfit = {
  front: () => (
    <>
      <Helmet fill={GUN} />
      <rect x={52} y={33} width={16} height={8} rx={2} fill={BLACK} {...OUTLINE} strokeWidth={2.2} />
      <circle cx={52} cy={33} r={5} fill={BLACK} {...OUTLINE} strokeWidth={2.2} />
      <circle cx={68} cy={33} r={5} fill={BLACK} {...OUTLINE} strokeWidth={2.2} />
      <circle cx={52} cy={33} r={2.6} fill={TOXIC} />
      <circle cx={68} cy={33} r={2.6} fill={TOXIC} />
      <Held angle={14}>
        <Rifle body={BLACK} stock={GUN} />
        <rect x={-2.6} y={-86} width={5.2} height={16} rx={2} fill={GUN} {...OUTLINE} strokeWidth={2} />
      </Held>
    </>
  ),
};

/** Spotter (Hoot & Seek): mũ tai bèo, tai nghe micro, ống nhòm quân sự. */
const hootSpotter: Outfit = {
  front: () => (
    <>
      <path d="M42 52 C42 42 50 37 60 37 C70 37 78 42 78 52 Z" fill="#5E6B4A" {...OUTLINE} />
      <path d="M32 54 C44 49 76 49 88 54 L90 59 C76 55 44 55 30 59 Z" fill="#5E6B4A" {...OUTLINE} />
      <path d="M34 62 C34 54 38 50 42 50" fill="none" stroke={INK} strokeWidth={2.6} />
      <rect x={28} y={60} width={8} height={12} rx={3} fill={BLACK} {...OUTLINE} strokeWidth={2.2} />
      <path d="M32 72 C34 82 40 86 46 86" fill="none" stroke={INK} strokeWidth={2} />
      <circle cx={47} cy={86} r={2.4} fill={BLOOD} stroke={INK} strokeWidth={1.2} />
      <Held angle={-8}>
        <rect x={-11} y={-22} width={9} height={18} rx={3} fill="#4E5A3A" {...OUTLINE} strokeWidth={2.4} />
        <rect x={2} y={-22} width={9} height={18} rx={3} fill="#4E5A3A" {...OUTLINE} strokeWidth={2.4} />
        <rect x={-3} y={-16} width={6} height={6} fill={BLACK} stroke={INK} strokeWidth={1.6} />
        <ellipse cx={-6.5} cy={-23} rx={4} ry={2} fill={BLACK} stroke={INK} strokeWidth={1.6} />
        <ellipse cx={6.5} cy={-23} rx={4} ry={2} fill={BLACK} stroke={INK} strokeWidth={1.6} />
        <path d="M-8 -24 l2 -0.5 M5 -24 l2 -0.5" stroke="#7CB8FF" strokeWidth={1.2} strokeLinecap="round" />
      </Held>
    </>
  ),
};

const OUTFITS: Partial<Record<string, Outfit>> = {
  duck,
  lover_duck: loverDuck,
  cannibal,
  morphling,
  silencer,
  professional,
  spy,
  assassin,
  hitman,
  snitch,
  party,
  demolitionist,
  identity_thief: identityThief,
  ninja,
  undertaker,
  invisibility,
  serial_killer: serialKiller,
  warlock,
  esper,
  preacher,
  cupid,
  drone,
  mime,
  clown,
  looter,
  sniper,
  witch_doctor: witchDoctor,
  lost_duckling: lostDuckling,
  carrier,
  parasite,
  swordsman,
  high_priest: highPriest,
  initiate,
  sin_eater: sinEater,
  vampire,
  mummy,
  thrall,
  dr_turducken: drTurducken,
  turducken_monster: turduckenMonster,
  wereduck,
  camo_duck: camoDuck,
  hoot_sniper: hootSniper,
  hoot_spotter: hootSpotter,
};

/** Bộ đồ riêng của role phe Vịt (`undefined` → mặc bộ chung của kit). */
export function duckOutfit(role: { key: string; faction: string }): Outfit | undefined {
  return role.faction === 'duck' ? OUTFITS[role.key] : undefined;
}
