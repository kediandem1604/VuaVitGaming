/**
 * Bộ đồ riêng của từng role phe Ngỗng — vẽ thay lớp trước (và đôi khi thêm lớp sau) của bộ
 * chung trong bảng `roleKits.ts`, nên role vẫn thuộc đúng bộ (`data-kit`) mà mỗi role trông
 * một kiểu: Cảnh sát trưởng đội mũ cao bồi, Kỹ sư đội mũ bảo hộ, Thầy đồng quấn khăn ôm cầu
 * pha lê… Role không có ở đây (role admin thêm sau, role phe khác) mặc bộ chung.
 *
 * Toạ độ theo khung `0 0 120 160` của `GooseBody`: đỉnh đầu y = 35, mắt (50|70, 69) lòng trắng
 * bán kính ≈ 9, mỏ y 74–95, ngực quanh (60, 118), mút cánh cầm đồ ở (94, 125). Mũ giữ đáy ≤ y 58 để
 * không che mắt và mọi phần giữ y ≥ 29 (vùng bảng tên).
 */

import type { ReactNode } from 'react';
import { PALETTE } from '../../../lib/palette';
import { Grip, OUTLINE, starPath } from './shapes';

export interface Outfit {
  front: () => ReactNode;
  back?: () => ReactNode;
}

const STEEL = '#D9DEE8';
const STEEL_DARK = '#8E97AB';
const WOOD = '#8B5A2B';
const WOOD_DARK = '#5A3818';
const BLACK = '#24213A';
const FLAME = '#FFB627';
const LEAF = '#4FA35B';

/** Khăn quàng tam giác thắt dưới mỏ (đáy mỏ y 95). */
function Neckerchief({ fill, stripe }: { fill: string; stripe?: string }) {
  return (
    <>
      <path d="M34 95 C46 104 74 104 86 95 L84 103 C72 111 48 111 36 103 Z" fill={fill} {...OUTLINE} />
      <path d="M52 106 L60 124 L68 106 Z" fill={fill} {...OUTLINE} />
      {stripe && <path d="M38 100 C50 107 70 107 82 100" fill="none" stroke={stripe} strokeWidth={2.2} strokeLinecap="round" />}
    </>
  );
}

/** Vành mũ elip (đáy mũ), tâm y mặc định 54. */
function Brim({ fill, rx = 33, cy = 54, ry = 4.5 }: { fill: string; rx?: number; cy?: number; ry?: number }) {
  return <ellipse cx={60} cy={cy} rx={rx} ry={ry} fill={fill} {...OUTLINE} />;
}

/** Băng buộc đầu ngang trán, hai đuôi bay về bên trái. */
function Headband({ fill }: { fill: string }) {
  return (
    <>
      <path d="M36 50 C38 46 82 46 84 50 L85 57 C76 53 44 53 35 57 Z" fill={fill} {...OUTLINE} />
      <path d="M36 52 C26 48 16 52 8 46 C12 56 22 60 35 57 Z" fill={fill} {...OUTLINE} />
      <path d="M36 55 C28 58 22 66 12 66 C20 72 30 66 36 58 Z" fill={fill} {...OUTLINE} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Từng role
// ---------------------------------------------------------------------------

/** Ngỗng: khăn quàng xanh phe, chỏm lông dựng, bảng nhiệm vụ đã tick. */
const goose: Outfit = {
  front: () => (
    <>
      <path d="M54 40 C50 30 58 28 60 36 C62 27 70 30 66 40 Z" fill={PALETTE['goose-soft']} {...OUTLINE} strokeWidth={2.5} />
      <Neckerchief fill={PALETTE.goose} stripe={PALETTE['goose-soft']} />
      <g transform="rotate(12 104 108)">
        <rect x={93} y={92} width={22} height={30} rx={3} fill={WOOD} {...OUTLINE} />
        <rect x={96} y={97} width={16} height={22} rx={1.5} fill={PALETTE.white} stroke={PALETTE.ink} strokeWidth={1.5} />
        <rect x={99} y={89} width={10} height={6} rx={2} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={2} />
        {[102, 108, 114].map((y) => (
          <g key={y}>
            <path d={`M98.5 ${y} l2 2 l3.5 -4`} fill="none" stroke={PALETTE.ok} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={`M105 ${y} h5`} stroke={PALETTE['night-600']} strokeWidth={1.6} strokeLinecap="round" />
          </g>
        ))}
      </g>
      <Grip y={124} angle={-20} />
    </>
  ),
};

/** Ngỗng ba gang: đội nồi làm mũ sắt, giọt mồ hôi, cầm muôi múc canh phòng thân. */
const gravy: Outfit = {
  front: () => (
    <>
      <path d="M40 52 L42 40 C50 36 70 36 78 40 L80 52 Z" fill={STEEL_DARK} {...OUTLINE} />
      <path d="M46 42 C52 40 58 40 62 41" fill="none" stroke={PALETTE.white} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
      <rect x={36} y={50} width={48} height={7} rx={3.5} fill={STEEL} {...OUTLINE} />
      <path d="M38 44 C30 42 30 50 37 50" fill="none" stroke={PALETTE.ink} strokeWidth={3} strokeLinecap="round" />
      <path d="M82 44 C90 42 90 50 83 50" fill="none" stroke={PALETTE.ink} strokeWidth={3} strokeLinecap="round" />
      <path d="M88 60 C85 65 86 69 89 69 C92 69 93 65 88 60 Z" fill={PALETTE['goose-soft']} stroke={PALETTE.ink} strokeWidth={1.8} />
      <path d="M95 126 L108 96" stroke={PALETTE.ink} strokeWidth={7} strokeLinecap="round" />
      <path d="M95 126 L108 96" stroke={STEEL} strokeWidth={3.5} strokeLinecap="round" />
      <path d="M102 92 C102 84 116 84 116 92 C116 98 102 98 102 92 Z" fill={STEEL} {...OUTLINE} />
      <path d="M104 91 C106 89 112 89 114 91" fill="none" stroke="#C47A2C" strokeWidth={3} strokeLinecap="round" />
      <Grip angle={-65} />
    </>
  ),
};

const MAPLE = '#D52B1E';
const MAPLE_LEAF = 'M60 47 L61.6 50.6 L64.5 49.2 L63.6 53 L66.5 53.6 L62.6 56.4 L63.2 58 L60.6 57.4 L60.6 60 L59.4 60 L59.4 57.4 L56.8 58 L57.4 56.4 L53.5 53.6 L56.4 53 L55.5 49.2 L58.4 50.6 Z';

/** Người Canada: mũ len đỏ chỏm bông, lá phong, khăn sọc, cầm cờ lá phong. */
const canadian: Outfit = {
  front: () => (
    <>
      <path d="M39 52 C39 41 47 36 60 36 C73 36 81 41 81 52 Z" fill={MAPLE} {...OUTLINE} />
      <path d="M48 38 L48 50 M56 36.5 L56 50 M64 36.5 L64 50 M72 38 L72 50" stroke={PALETTE.ink} strokeWidth={1.2} opacity={0.3} />
      <circle cx={60} cy={34} r={4.5} fill={PALETTE.white} {...OUTLINE} strokeWidth={2.5} />
      <rect x={36} y={49} width={48} height={9} rx={4} fill={PALETTE.white} {...OUTLINE} />
      <path d={MAPLE_LEAF} transform="translate(60 53.5) scale(0.62) translate(-60 -53.5)" fill={MAPLE} />
      <Neckerchief fill={MAPLE} stripe={PALETTE.white} />
      <path d="M95 128 L106 84" stroke={PALETTE.ink} strokeWidth={6} strokeLinecap="round" />
      <path d="M95 128 L106 84" stroke={WOOD} strokeWidth={3} strokeLinecap="round" />
      <path d="M106 84 L119 88 L116 102 L103 98 Z" fill={PALETTE.white} {...OUTLINE} strokeWidth={2.5} />
      <path d={MAPLE_LEAF} transform="translate(110.5 93) scale(0.62) translate(-60 -53.5)" fill={MAPLE} />
      <Grip angle={-70} />
    </>
  ),
};

/** Kẻ bắt chước: lông mày gian, giơ mặt nạ Vịt trên que. */
const mimic: Outfit = {
  front: () => (
    <>
      <path d="M42 59 L56 61" stroke={PALETTE.ink} strokeWidth={3} strokeLinecap="round" />
      <path d="M78 56 L64 61" stroke={PALETTE.ink} strokeWidth={3} strokeLinecap="round" />
      <Neckerchief fill={PALETTE['third-soft']} stripe={PALETTE.duck} />
      <path d="M95 126 L100 102" stroke={PALETTE.ink} strokeWidth={6} strokeLinecap="round" />
      <path d="M95 126 L100 102" stroke={PALETTE.gold} strokeWidth={3} strokeLinecap="round" />
      <path
        d="M86 92 C86 82 114 82 114 92 C114 101 105 103 100 97 C95 103 86 101 86 92 Z M91.5 91.5 a3.6 3 0 1 0 7.2 0 a3.6 3 0 1 0 -7.2 0 Z M101.3 91.5 a3.6 3 0 1 0 7.2 0 a3.6 3 0 1 0 -7.2 0 Z"
        fillRule="evenodd"
        fill={PALETTE.duck}
        {...OUTLINE}
        strokeWidth={2.5}
      />
      <path d="M86 88 L80 82 M114 88 L120 82" stroke={PALETTE.duck} strokeWidth={2.5} strokeLinecap="round" />
      <Grip angle={-75} />
    </>
  ),
};

/** Thợ may: gối ghim trên đầu, thước dây vắt cổ, kim chỉ đỏ. */
const seamstress: Outfit = {
  front: () => (
    <>
      <path d="M52 34 L54 40 M60 31 L60 39 M68 34 L66 40" stroke={STEEL_DARK} strokeWidth={1.8} strokeLinecap="round" />
      <circle cx={52} cy={33.5} r={2.3} fill={PALETTE.goose} />
      <circle cx={60} cy={30.5} r={2.3} fill={PALETTE.gold} />
      <circle cx={68} cy={33.5} r={2.3} fill={PALETTE.ok} />
      <ellipse cx={60} cy={42} rx={13} ry={6} fill="#E5484D" {...OUTLINE} strokeWidth={2.5} />
      <path d="M60 36.5 L60 47.5" stroke={PALETTE.ink} strokeWidth={1.2} opacity={0.35} />
      <path d="M34 93 C46 101 74 101 86 93" fill="none" stroke={PALETTE.ink} strokeWidth={8} strokeLinecap="round" />
      <path d="M34 93 C46 101 74 101 86 93" fill="none" stroke="#FFD86B" strokeWidth={4.5} strokeLinecap="round" />
      <path d="M40 96 L36 128" stroke={PALETTE.ink} strokeWidth={8} strokeLinecap="round" />
      <path d="M40 96 L36 128" stroke="#FFD86B" strokeWidth={4.5} strokeLinecap="round" />
      <path d="M80 97 L84 120" stroke={PALETTE.ink} strokeWidth={8} strokeLinecap="round" />
      <path d="M80 97 L84 120" stroke="#FFD86B" strokeWidth={4.5} strokeLinecap="round" />
      <path d="M39 104 l2 0.3 M38.4 110 l2 0.3 M37.6 116 l2 0.3 M37 122 l2 0.3 M81.5 104 l2 -0.3 M82.4 110 l2 -0.3 M83.2 116 l2 -0.3" stroke={PALETTE.ink} strokeWidth={1.2} />
      <path d="M96 124 L112 92" stroke={PALETTE.ink} strokeWidth={4.5} strokeLinecap="round" />
      <path d="M96 124 L112 92" stroke={STEEL} strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={111} cy={95} rx={1.2} ry={2.4} transform="rotate(27 111 95)" fill={PALETTE.ink} />
      <path d="M111 95 C120 102 104 108 114 116 C120 121 112 128 106 130" fill="none" stroke="#E5484D" strokeWidth={1.8} strokeLinecap="round" />
      <Grip angle={-62} />
    </>
  ),
};

/** Dân làng: nón rơm vành rộng, cầm chĩa ba. */
const villager: Outfit = {
  front: () => (
    <>
      <path d="M44 50 C44 42 50 38 60 38 C70 38 76 42 76 50 Z" fill="#E8C66A" {...OUTLINE} />
      <rect x={44} y={46} width={32} height={4.5} fill="#C9353A" stroke={PALETTE.ink} strokeWidth={1.8} />
      <Brim fill="#E8C66A" rx={37} cy={52} ry={6} />
      <path d="M30 52 L36 50 M40 56 L44 53 M76 53 L80 56 M84 50 L90 52 M52 57 L54 55 M66 55 L68 57" stroke="#B08A2E" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M95 130 L108 78" stroke={PALETTE.ink} strokeWidth={6.5} strokeLinecap="round" />
      <path d="M95 130 L108 78" stroke={WOOD} strokeWidth={3.5} strokeLinecap="round" />
      <path d="M100 80 L116 84 M100 80 L102 66 M108 82 L110 67 M116 84 L118 69" fill="none" stroke={PALETTE.ink} strokeWidth={5} strokeLinecap="round" />
      <path d="M100 80 L116 84 M100 80 L102 66 M108 82 L110 67 M116 84 L118 69" fill="none" stroke={STEEL} strokeWidth={2.4} strokeLinecap="round" />
      <Grip angle={-74} />
    </>
  ),
};

/** Người nổi tiếng: kính râm hình sao, khăn lông vũ hồng, micro vàng, tia lấp lánh. */
const celebrity: Outfit = {
  front: () => (
    <>
      <path d={starPath(50, 69, 11, 5)} fill="#FF4FA3" {...OUTLINE} strokeWidth={2.5} />
      <path d={starPath(70, 69, 11, 5)} fill="#FF4FA3" {...OUTLINE} strokeWidth={2.5} />
      <path d="M57 67 Q60 65 63 67" fill="none" stroke={PALETTE.ink} strokeWidth={2.5} />
      <circle cx={47} cy={66} r={1.8} fill={PALETTE.white} />
      <circle cx={67} cy={66} r={1.8} fill={PALETTE.white} />
      {[36, 44, 52, 60, 68, 76, 84].map((x, i) => (
        <circle key={x} cx={x} cy={96 + Math.abs(i - 3) * -1.3 + 4} r={6} fill="#FF7EB6" stroke={PALETTE.ink} strokeWidth={2} />
      ))}
      <path d={starPath(30, 46, 4.5, 1.6, 4)} fill={PALETTE.gold} className="aura-twinkle" />
      <path d={starPath(92, 40, 3.5, 1.3, 4)} fill={PALETTE.gold} className="aura-twinkle" style={{ animationDelay: '-1s' }} />
      <path d="M95 126 L102 108" stroke={PALETTE.ink} strokeWidth={7} strokeLinecap="round" />
      <path d="M95 126 L102 108" stroke={BLACK} strokeWidth={4} strokeLinecap="round" />
      <circle cx={104} cy={102} r={7} fill={PALETTE.gold} {...OUTLINE} />
      <path d="M99 100 L109 100 M99 104 L109 104 M104 96 L104 108" stroke={PALETTE['gold-ink']} strokeWidth={1} opacity={0.5} />
      <Grip angle={-68} />
    </>
  ),
};

/** Người vận động hành lang: tóc chải mượt, cổ áo + cà vạt đỏ, cặp da. */
const lobbyist: Outfit = {
  front: () => (
    <>
      <path d="M39 54 C36 38 50 31 63 32 C77 33 85 42 82 54 C77 45 67 42 57 44 C50 45 43 49 39 54 Z" fill="#4A3426" {...OUTLINE} strokeWidth={2.5} />
      <path d="M48 40 C54 36 64 35 72 38" fill="none" stroke={PALETTE.white} strokeWidth={1.8} strokeLinecap="round" opacity={0.45} />
      <path d="M48 95 L60 103 L72 95 L71 102 L60 109 L49 102 Z" fill={PALETTE.white} {...OUTLINE} strokeWidth={2.5} />
      <path d="M57 104 L63 104 L66 128 L60 134 L54 128 Z" fill="#C9353A" {...OUTLINE} strokeWidth={2.5} />
      <path d="M57.5 104 L62.5 104 L61.5 109 L58.5 109 Z" fill="#8F2226" />
      <rect x={54} y={116} width={12} height={2.6} rx={1} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.2} />
      <path d="M96 120 L99 110 L106 112 L104 120 Z M104 120 L108 109 L115 112 L111 120 Z" fill="#7CCB7E" stroke={PALETTE.ink} strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M100 118 C100 112 110 112 110 118" fill="none" stroke={PALETTE.ink} strokeWidth={3.5} />
      <rect x={92} y={118} width={26} height={18} rx={3} fill="#7A4A26" {...OUTLINE} />
      <path d="M92 125 L118 125" stroke={PALETTE.ink} strokeWidth={1.6} />
      <rect x={102} y={122.5} width={6} height={5} rx={1} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.4} />
      <Grip x={95} y={121} angle={-10} />
    </>
  ),
};

/** Chính trị gia: mũ chóp cao, dải băng chéo vai, huy hiệu nơ. */
const politician: Outfit = {
  front: () => (
    <>
      <path d="M46 54 L48 30 L72 30 L74 54 Z" fill={BLACK} {...OUTLINE} />
      <rect x={46.5} y={45} width={27} height={6} fill={PALETTE.goose} stroke={PALETTE.ink} strokeWidth={1.8} />
      <Brim fill={BLACK} rx={22} ry={3.8} />
      <path d="M51 33 L52 44" stroke={PALETTE.white} strokeWidth={1.6} strokeLinecap="round" opacity={0.35} />
      <path d="M28 104 L36 96 L94 132 L88 142 Z" fill={PALETTE.white} {...OUTLINE} />
      <path d="M31 101 L91 137" stroke="#C9353A" strokeWidth={3} />
      <path d="M33.5 98.5 L92.5 134" stroke={PALETTE.goose} strokeWidth={2} />
      <path d={starPath(46, 112, 7.5, 4.5, 8)} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.2} />
      <circle cx={46} cy={112} r={2.6} fill="#C9353A" />
    </>
  ),
};

/** Kẻ rình mò: mũ tai bèo cắm lông, ống nhòm đeo ngực. */
const birdwatcher: Outfit = {
  front: () => (
    <>
      <path d="M43 50 C43 41 49 38 60 38 C71 38 77 41 77 50 Z" fill="#A89A6A" {...OUTLINE} />
      <path d="M78 48 C84 36 92 34 96 30 C94 38 88 46 80 50 Z" fill={LEAF} {...OUTLINE} strokeWidth={2.2} />
      <path d="M33 53 C40 61 80 61 87 53 C80 48 40 48 33 53 Z" fill="#8F8253" {...OUTLINE} />
      <path d="M42 94 L52 108 M78 94 L68 108" stroke={WOOD_DARK} strokeWidth={2.4} />
      <rect x={46} y={106} width={12} height={18} rx={4} fill={BLACK} {...OUTLINE} strokeWidth={2.5} />
      <rect x={62} y={106} width={12} height={18} rx={4} fill={BLACK} {...OUTLINE} strokeWidth={2.5} />
      <rect x={56} y={110} width={8} height={6} fill={STEEL_DARK} stroke={PALETTE.ink} strokeWidth={1.6} />
      <circle cx={52} cy={121} r={3.4} fill="#9FD8FF" />
      <circle cx={68} cy={121} r={3.4} fill="#9FD8FF" />
    </>
  ),
};

/** Điều tra viên: mũ phẫu thuật chấm bi, gương soi trán, ống nghe quanh cổ. */
const coroner: Outfit = {
  front: () => (
    <>
      <path d="M38 55 C33 41 47 34 60 34 C73 34 87 41 82 55 C74 50 46 50 38 55 Z" fill="#3FB5A5" {...OUTLINE} />
      {[[46, 42], [56, 39], [66, 39], [74, 44], [52, 47], [68, 47]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} fill={PALETTE.white} opacity={0.75} />
      ))}
      <circle cx={60} cy={48} r={6} fill={STEEL} {...OUTLINE} strokeWidth={2.4} />
      <circle cx={58} cy={46.5} r={1.6} fill={PALETTE.white} />
      <path d="M38 95 C38 116 56 122 60 112 M82 95 C82 116 64 122 60 112 L60 120" fill="none" stroke={PALETTE.ink} strokeWidth={6} strokeLinecap="round" />
      <path d="M38 95 C38 116 56 122 60 112 M82 95 C82 116 64 122 60 112 L60 120" fill="none" stroke="#5B6B8C" strokeWidth={3} strokeLinecap="round" />
      <circle cx={60} cy={124} r={5.5} fill={STEEL} {...OUTLINE} strokeWidth={2.5} />
    </>
  ),
};

/** Thám tử: mũ thợ săn kẻ ô, tẩu thuốc, kính lúp. */
const detective: Outfit = {
  front: () => (
    <>
      <path d="M40 55 C40 42 48 37 60 37 C72 37 80 42 80 55 Z" fill="#9C6B3C" {...OUTLINE} />
      <path d="M48 39 L48 55 M56 37.5 L56 55 M64 37.5 L64 55 M72 39 L72 55 M41 45 L79 45 M40.5 50 L79.5 50" stroke={WOOD_DARK} strokeWidth={1.2} opacity={0.55} />
      <path d="M43 55 C48 61 72 61 77 55 Z" fill="#7C522B" {...OUTLINE} strokeWidth={2.5} />
      <path d="M56 37 C54 32 58 31 60 35 C62 31 66 32 64 37" fill="none" stroke={PALETTE.ink} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M72 88 L84 93" stroke={PALETTE.ink} strokeWidth={4.5} strokeLinecap="round" />
      <path d="M72 88 L84 93" stroke={WOOD_DARK} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M82 86 L91 86 L90 97 C88 99 85 99 83 97 Z" fill={WOOD} {...OUTLINE} strokeWidth={2.5} />
      <path d="M86 82 C84 78 90 76 88 72 M90 80 C89 77 93 75 92 72" fill="none" stroke={PALETTE.white} strokeWidth={1.6} strokeLinecap="round" opacity={0.65} />
      <path d="M95 126 L101 112" stroke={PALETTE.ink} strokeWidth={8} strokeLinecap="round" />
      <path d="M95 126 L101 112" stroke={WOOD} strokeWidth={4.5} strokeLinecap="round" />
      <circle cx={105.5} cy={102} r={11} fill={PALETTE.gold} {...OUTLINE} />
      <circle cx={105.5} cy={102} r={7.5} fill="#CDEBFF" />
      <path d="M101 100 Q102.5 97 106 96.5" stroke={PALETTE.white} strokeWidth={1.6} strokeLinecap="round" fill="none" />
      <Grip angle={-65} />
    </>
  ),
};

/** Thanh tra: mũ chóp khoá bạc kiểu thợ săn phù thuỷ, cổ áo trắng rộng, đèn lồng. */
const inquisitor: Outfit = {
  front: () => (
    <>
      <path d="M44 53 L47 31 L73 31 L76 53 Z" fill={BLACK} {...OUTLINE} />
      <rect x={45} y={45} width={30} height={6} fill="#3A3550" stroke={PALETTE.ink} strokeWidth={1.8} />
      <rect x={54} y={43} width={12} height={10} rx={1.5} fill="none" stroke={STEEL} strokeWidth={2.6} />
      <Brim fill={BLACK} rx={30} cy={54} ry={4.5} />
      <path d="M32 95 C42 110 56 106 60 100 C64 106 78 110 88 95 C76 92 44 92 32 95 Z" fill={PALETTE.white} {...OUTLINE} />
      <path d="M95 124 L102 98" stroke={PALETTE.ink} strokeWidth={2.4} />
      <circle cx={104} cy={108} r={13} fill={FLAME} opacity={0.22} />
      <path d="M98 100 L110 100 L108 96 L100 96 Z" fill={BLACK} {...OUTLINE} strokeWidth={2.2} />
      <rect x={98} y={100} width={12} height={16} rx={1.5} fill="#FFE08A" {...OUTLINE} strokeWidth={2.5} />
      <path d="M104 101 L104 115 M98 108 L110 108" stroke={PALETTE.ink} strokeWidth={1.6} />
      <rect x={97} y={115} width={14} height={4} rx={1} fill={BLACK} stroke={PALETTE.ink} strokeWidth={2} />
      <Grip y={124} angle={-75} />
    </>
  ),
};

/** Pháp y: mũ chóp cao băng tím có dải rủ, nơ đen, cầm hoa huệ trắng. */
const mortician: Outfit = {
  front: () => (
    <>
      <path d="M45 42 C38 46 36 54 32 60 C38 58 42 54 46 50 Z" fill="#5B3A86" {...OUTLINE} strokeWidth={2.2} />
      <path d="M47 54 L48 30 L72 30 L73 54 Z" fill={BLACK} {...OUTLINE} />
      <rect x={47.4} y={44} width={25.2} height={7} fill="#5B3A86" stroke={PALETTE.ink} strokeWidth={1.8} />
      <Brim fill={BLACK} rx={21} ry={3.8} />
      <path d="M48 93 L60 99 L72 93 L72 105 L60 99 L48 105 Z" fill={BLACK} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={60} cy={99} r={2.6} fill={BLACK} stroke={PALETTE.ink} strokeWidth={1.5} />
      <path d="M96 126 Q100 112 106 98" fill="none" stroke={PALETTE.ink} strokeWidth={5} strokeLinecap="round" />
      <path d="M96 126 Q100 112 106 98" fill="none" stroke={LEAF} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M100 114 C94 110 92 104 96 102 C100 106 101 110 100 114 Z" fill={LEAF} stroke={PALETTE.ink} strokeWidth={1.8} />
      <path d={starPath(107, 93, 9, 3.2, 6)} fill={PALETTE.white} {...OUTLINE} strokeWidth={2.2} />
      <circle cx={107} cy={93} r={2.2} fill={PALETTE.gold} />
      <Grip angle={-70} />
    </>
  ),
};

/** Kẻ đeo bám: mũ trùm áo hoodie, dây rút, máy ảnh ống kính dài. */
const stalker: Outfit = {
  front: () => (
    <>
      <path d="M31 78 C29 50 42 34 60 34 C78 34 91 50 89 78 C85 62 76 48 60 48 C44 48 35 62 31 78 Z" fill="#3B3F52" {...OUTLINE} />
      <path d="M36 70 C38 58 46 51 60 51 C74 51 82 58 84 70" fill="none" stroke={PALETTE.ink} strokeWidth={1.4} opacity={0.4} />
      <path d="M46 96 L44 114 M74 96 L76 114" stroke={PALETTE.wing} strokeWidth={2.4} strokeLinecap="round" />
      <circle cx={44} cy={116} r={2.4} fill={PALETTE.wing} stroke={PALETTE.ink} strokeWidth={1.4} />
      <circle cx={76} cy={116} r={2.4} fill={PALETTE.wing} stroke={PALETTE.ink} strokeWidth={1.4} />
      <rect x={90} y={104} width={20} height={14} rx={3} fill={BLACK} {...OUTLINE} />
      <rect x={109} y={106} width={9} height={10} rx={2} fill={STEEL_DARK} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={118} cy={111} r={2.5} fill="#9FD8FF" />
      <rect x={94} y={100} width={6} height={4} rx={1} fill={STEEL} stroke={PALETTE.ink} strokeWidth={1.6} />
      <Grip y={122} angle={-15} />
    </>
  ),
};

/** Kẻ theo dấu: mũ sa mạc gắn kính bảo hộ, khăn bay trong gió, đuốc. */
const tracker: Outfit = {
  front: () => (
    <>
      <path d="M42 52 C42 42 48 38 60 38 C72 38 78 42 78 52 Z" fill="#C9A56B" {...OUTLINE} />
      <path d="M43 46 L77 46" stroke={WOOD_DARK} strokeWidth={3} />
      <circle cx={52} cy={45} r={5.2} fill="#FFB25B" {...OUTLINE} strokeWidth={2.5} />
      <circle cx={68} cy={45} r={5.2} fill="#FFB25B" {...OUTLINE} strokeWidth={2.5} />
      <circle cx={50.5} cy={43.5} r={1.4} fill={PALETTE.white} />
      <circle cx={66.5} cy={43.5} r={1.4} fill={PALETTE.white} />
      <Brim fill="#B08D52" rx={32} cy={54} ry={4.5} />
      <path d="M34 95 C46 104 74 104 86 95 L84 103 C72 111 48 111 36 103 Z" fill="#E3C99A" {...OUTLINE} />
      <path d="M38 100 C28 104 20 100 12 106 C20 110 30 110 38 105 Z" fill="#E3C99A" {...OUTLINE} strokeWidth={2.5} />
      <path d="M95 128 L105 98" stroke={PALETTE.ink} strokeWidth={6.5} strokeLinecap="round" />
      <path d="M95 128 L105 98" stroke={WOOD} strokeWidth={3.5} strokeLinecap="round" />
      <path d="M106 98 C98 92 102 84 106 78 C108 84 114 86 112 94 C111 97 109 98 106 98 Z" fill={FLAME} {...OUTLINE} strokeWidth={2.4} />
      <path d="M106.5 96 C103 92 105 88 107 85 C108 89 110 91 109 94 Z" fill="#FFF0A8" />
      <Grip angle={-72} />
    </>
  ),
};

/** Kỹ sư: mũ bảo hộ vàng, cờ lê lớn, đai dụng cụ. */
const engineer: Outfit = {
  front: () => (
    <>
      <path d="M38 54 C38 42 47 36 60 36 C73 36 82 42 82 54 Z" fill="#FFC83D" {...OUTLINE} />
      <path d="M60 36.5 L60 54" stroke={PALETTE.ink} strokeWidth={1.6} opacity={0.45} />
      <path d="M53 37.5 C52 44 52 50 53 54 M67 37.5 C68 44 68 50 67 54" fill="none" stroke="#E0A21A" strokeWidth={3} />
      <rect x={33} y={52} width={54} height={6} rx={3} fill="#FFC83D" {...OUTLINE} />
      <path d="M24 128 C40 138 80 138 96 128 L96 135 C80 145 40 145 24 135 Z" fill="#7A4A26" {...OUTLINE} />
      <rect x={55} y={133} width={10} height={8} rx={1.5} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.8} />
      <rect x={32} y={134} width={11} height={10} rx={2} fill="#5E3A1A" stroke={PALETTE.ink} strokeWidth={2} />
      <path d="M96 126 L110 96" stroke={PALETTE.ink} strokeWidth={8} strokeLinecap="round" />
      <path d="M96 126 L110 96" stroke={STEEL} strokeWidth={4.5} strokeLinecap="round" />
      <path d="M104 92 C102 84 110 80 114 82 L110 88 L114 92 L120 88 C122 94 116 100 110 98 Z" fill={STEEL} {...OUTLINE} strokeWidth={2.5} />
      <Grip angle={-64} />
    </>
  ),
};

/** Thợ khoá: mũ len xanh rêu, ổ khoá đeo ngực, chùm chìa khoá. */
const locksmith: Outfit = {
  front: () => (
    <>
      <path d="M39 54 C39 42 47 37 60 37 C73 37 81 42 81 54 Z" fill="#3E7A5C" {...OUTLINE} />
      <path d="M38 50 C46 47 74 47 82 50 L82 56 C74 53 46 53 38 56 Z" fill="#2E5E46" {...OUTLINE} strokeWidth={2.5} />
      <path d="M55 109 C55 102 65 102 65 109" fill="none" stroke={PALETTE.ink} strokeWidth={5} />
      <path d="M55 109 C55 102 65 102 65 109" fill="none" stroke={STEEL} strokeWidth={2.4} />
      <rect x={52} y={108} width={16} height={13} rx={2.5} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={60} cy={113.5} r={1.8} fill={PALETTE['gold-ink']} />
      <path d="M60 114 L60 118" stroke={PALETTE['gold-ink']} strokeWidth={1.6} />
      <circle cx={104} cy={108} r={8} fill="none" stroke={PALETTE.ink} strokeWidth={5} />
      <circle cx={104} cy={108} r={8} fill="none" stroke={PALETTE.gold} strokeWidth={2.4} />
      {([[98, 114, -25, PALETTE.gold], [104, 116, 0, STEEL], [110, 114, 25, '#C98A4B']] as const).map(([x, y, a, c]) => (
        <g key={x} transform={`rotate(${a} ${x} ${y})`}>
          <circle cx={x} cy={y + 2} r={3.4} fill={c} stroke={PALETTE.ink} strokeWidth={1.8} />
          <path d={`M${x} ${y + 5} L${x} ${y + 16} M${x} ${y + 12} l3 0 M${x} ${y + 15} l2.4 0`} stroke={PALETTE.ink} strokeWidth={4} strokeLinecap="round" />
          <path d={`M${x} ${y + 5} L${x} ${y + 16} M${x} ${y + 12} l3 0 M${x} ${y + 15} l2.4 0`} stroke={c} strokeWidth={1.8} strokeLinecap="round" />
        </g>
      ))}
      <Grip x={97} y={104} angle={-30} />
    </>
  ),
};

/** Nhà khoa học: tóc dựng, kính bảo hộ đẩy lên trán, cổ áo blouse, bình thí nghiệm sủi bọt. */
const scientist: Outfit = {
  front: () => (
    <>
      <path d="M42 46 L38 36 L48 40 L50 30 L56 39 L62 30 L65 39 L72 31 L73 41 L82 37 L78 47 Z" fill="#E6E2F0" {...OUTLINE} strokeWidth={2.4} />
      <path d="M36 52 C44 48 76 48 84 52" fill="none" stroke={PALETTE.ink} strokeWidth={4} />
      <circle cx={50} cy={50} r={6.5} fill="#7CF29A" fillOpacity={0.55} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={70} cy={50} r={6.5} fill="#7CF29A" fillOpacity={0.55} {...OUTLINE} strokeWidth={2.5} />
      <path d="M48 47.5 L51 46.5 M68 47.5 L71 46.5" stroke={PALETTE.white} strokeWidth={1.6} strokeLinecap="round" />
      <path d="M34 96 L52 116 L56 100 Z M86 96 L68 116 L64 100 Z" fill={PALETTE.white} {...OUTLINE} strokeWidth={2.5} />
      <path d="M101 88 L101 98 L94 116 C93 120 95 122 98 122 L112 122 C115 122 117 120 116 116 L109 98 L109 88 Z" fill="#E8F6FF" {...OUTLINE} strokeWidth={2.5} />
      <path d="M97 108 L113 108 L116 116 C117 120 115 122 112 122 L98 122 C95 122 93 120 94 116 Z" fill="#5FE08A" />
      <rect x={99} y={85} width={12} height={4} rx={1.5} fill={STEEL_DARK} stroke={PALETTE.ink} strokeWidth={1.8} />
      <circle cx={103} cy={114} r={1.8} fill={PALETTE.white} />
      <circle cx={108} cy={117} r={1.3} fill={PALETTE.white} />
      <circle cx={106} cy={80} r={2.2} fill="#7CF29A" className="aura-twinkle" />
      <circle cx={110} cy={74} r={1.6} fill="#7CF29A" className="aura-twinkle" style={{ animationDelay: '-1.2s' }} />
      <Grip y={126} angle={-10} />
    </>
  ),
};

/** Cảm biến: tai nghe chụp, ăng-ten đèn nháy, màn radar cầm tay. */
const sensor: Outfit = {
  front: () => (
    <>
      <path d="M33 66 C30 40 90 40 87 66" fill="none" stroke={PALETTE.ink} strokeWidth={7} strokeLinecap="round" />
      <path d="M33 66 C30 40 90 40 87 66" fill="none" stroke={STEEL_DARK} strokeWidth={3.5} strokeLinecap="round" />
      <path d="M60 45 L60 33" stroke={PALETTE.ink} strokeWidth={2.4} />
      <circle cx={60} cy={32} r={3.2} fill="#FF5A5F" stroke={PALETTE.ink} strokeWidth={1.8} className="aura-twinkle" />
      <rect x={27} y={60} width={10} height={16} rx={4} fill={BLACK} {...OUTLINE} strokeWidth={2.5} />
      <rect x={83} y={60} width={10} height={16} rx={4} fill={BLACK} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={104} cy={108} r={12} fill="#173D2B" {...OUTLINE} />
      <circle cx={104} cy={108} r={7.5} fill="none" stroke={PALETTE.ok} strokeWidth={1} opacity={0.6} />
      <circle cx={104} cy={108} r={3.5} fill="none" stroke={PALETTE.ok} strokeWidth={1} opacity={0.6} />
      <path d="M104 108 L112 102" stroke={PALETTE.ok} strokeWidth={1.8} strokeLinecap="round" />
      <circle cx={98} cy={104} r={1.8} fill="#FF5A5F" className="aura-twinkle" style={{ animationDelay: '-0.7s' }} />
      <Grip y={124} angle={-30} />
    </>
  ),
};

/** Nhà thám hiểm: mũ phớt lõm đỉnh, khăn cổ, la bàn vàng (ba lô của bộ chung vẫn sau lưng). */
const adventurer: Outfit = {
  front: () => (
    <>
      <path d="M42 52 C42 40 50 36 60 40 C70 36 78 40 78 52 Z" fill="#8B5A2B" {...OUTLINE} />
      <rect x={42.5} y={46} width={35} height={6} fill="#3E2511" stroke={PALETTE.ink} strokeWidth={1.8} />
      <path d="M26 53 C34 60 86 60 94 53 C86 50 34 50 26 53 Z" fill="#7C4E24" {...OUTLINE} />
      <Neckerchief fill="#C9353A" />
      <circle cx={104} cy={108} r={10} fill={PALETTE.gold} {...OUTLINE} />
      <circle cx={104} cy={108} r={6.8} fill="#FFF6DA" />
      <path d="M104 102 L106 108 L104 114 L102 108 Z" fill="#E5484D" />
      <path d="M104 114 L102 108 L104 108 Z" fill={STEEL_DARK} />
      <circle cx={104} cy={97} r={2.2} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.6} />
      <Grip y={122} angle={-30} />
    </>
  ),
};

/** Bụi đời: mũ lưỡi trai vải lệch, miếng dán trên má, ná cao su. */
const streetUrchin: Outfit = {
  front: () => (
    <>
      <path d="M39 54 C36 40 52 34 66 36 C80 38 86 46 84 54 Z" fill="#6F7890" {...OUTLINE} />
      <path d="M40 50 C34 52 28 56 26 58 C34 60 42 58 50 54 Z" fill="#4E556A" {...OUTLINE} strokeWidth={2.5} />
      <rect x={68} y={42} width={8} height={7} fill="#B7925F" stroke={PALETTE.ink} strokeWidth={1.4} transform="rotate(12 72 45)" />
      <circle cx={62} cy={36.5} r={2.4} fill="#4E556A" stroke={PALETTE.ink} strokeWidth={1.6} />
      <rect x={78} y={74} width={10} height={5} rx={2} fill="#F2C9A0" stroke={PALETTE.ink} strokeWidth={1.4} transform="rotate(-30 83 76)" />
      <path d="M95 126 L102 106 L96 92 M102 106 L112 94" fill="none" stroke={PALETTE.ink} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M95 126 L102 106 L96 92 M102 106 L112 94" fill="none" stroke={WOOD} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M96 92 Q100 102 112 94" fill="none" stroke="#E5484D" strokeWidth={1.8} />
      <Grip angle={-70} />
    </>
  ),
};

/** Người sống sót: khăn rằn ri buộc đầu, rìu cầm tay (ba lô của bộ chung vẫn sau lưng). */
const survivalist: Outfit = {
  front: () => (
    <>
      <Headband fill="#5A6B3A" />
      <path d="M44 50 l4 2 M56 49 l3 2 M68 49 l4 2 M78 50 l3 2" stroke="#2F3A1C" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M95 128 L106 96" stroke={PALETTE.ink} strokeWidth={7} strokeLinecap="round" />
      <path d="M95 128 L106 96" stroke={WOOD} strokeWidth={3.8} strokeLinecap="round" />
      <path d="M102 98 C102 88 108 84 116 84 C118 92 116 100 108 102 Z" fill={STEEL} {...OUTLINE} />
      <path d="M115 86 C117 92 116 98 110 101" fill="none" stroke={PALETTE.white} strokeWidth={1.6} opacity={0.8} />
      <Grip angle={-70} />
    </>
  ),
};

/** Thánh: hào quang toả tia, chuỗi hạt, nến thắp; cánh thiên thần sau lưng. */
const saint: Outfit = {
  front: () => (
    <>
      <g stroke={PALETTE.gold} strokeWidth={1.6} strokeLinecap="round" opacity={0.8}>
        <path d="M36 32 L40 35 M84 32 L80 35 M60 29 L60 30.5 M46 30 L48 32 M74 30 L72 32" />
      </g>
      <ellipse cx={60} cy={36} rx={25} ry={7} fill={PALETTE.gold} opacity={0.25} />
      <ellipse cx={60} cy={36} rx={19} ry={3.5} fill="none" stroke={PALETTE.ink} strokeWidth={7} />
      <ellipse cx={60} cy={36} rx={19} ry={3.5} fill="none" stroke={PALETTE.gold} strokeWidth={3.5} />
      <path d="M38 96 C44 116 76 116 82 96" fill="none" stroke={WOOD_DARK} strokeWidth={2} strokeDasharray="0.1 4.5" strokeLinecap="round" />
      <path d="M38 96 C44 116 76 116 82 96" fill="none" stroke={WOOD} strokeWidth={4} strokeDasharray="0.1 4.5" strokeLinecap="round" />
      <path d="M60 113 L60 125 M55 118 L65 118" stroke={PALETTE.gold} strokeWidth={3} strokeLinecap="round" />
      <circle cx={104} cy={100} r={9} fill={FLAME} opacity={0.25} />
      <rect x={100} y={102} width={8} height={20} rx={1.5} fill="#FFF6DA" {...OUTLINE} strokeWidth={2.5} />
      <path d="M104 101 C101 97 103 93 104 90 C105 93 107 97 104 101 Z" fill={FLAME} stroke={PALETTE.ink} strokeWidth={1.6} />
      <Grip y={122} angle={-10} />
    </>
  ),
  back: () => {
    const left = 'M34 92 C22 74 6 70 2 82 C8 82 9 88 4 94 C11 92 15 96 10 104 C18 102 22 106 19 114 C26 110 31 104 34 98 Z';
    return (
      <>
        <path d={left} fill={PALETTE.white} {...OUTLINE} />
        <path d={left} fill={PALETTE.white} transform="translate(120 0) scale(-1 1)" {...OUTLINE} />
        <path d="M6 84 C10 84 12 88 9 92 M114 84 C110 84 108 88 111 92" fill="none" stroke={PALETTE.gold} strokeWidth={2} strokeLinecap="round" />
      </>
    );
  },
};

/** Tình nhân (ngỗng): vòng hoa trên đầu, má hồng, cầm hoa hồng (cánh của bộ chung vẫn sau lưng). */
const loverGoose: Outfit = {
  front: () => (
    <>
      <path d="M38 50 C46 42 74 42 82 50" fill="none" stroke={LEAF} strokeWidth={3.5} strokeLinecap="round" />
      {([[40, 49, '#FF7EB6'], [49, 44, PALETTE.white], [60, 42, '#EF476F'], [71, 44, PALETTE.white], [80, 49, '#FF7EB6']] as const).map(([x, y, c]) => (
        <g key={x}>
          <path d={starPath(x, y, 5.5, 3, 5)} fill={c} stroke={PALETTE.ink} strokeWidth={1.8} strokeLinejoin="round" />
          <circle cx={x} cy={y} r={1.8} fill={PALETTE.gold} />
        </g>
      ))}
      <ellipse cx={40} cy={80} rx={5} ry={3} fill="#FF7EB6" opacity={0.6} />
      <ellipse cx={80} cy={80} rx={5} ry={3} fill="#FF7EB6" opacity={0.6} />
      <path d="M60 130 C50 123 46 116 48 110 C50 105 57 105 60 110 C63 105 70 105 72 110 C74 116 70 123 60 130 Z" fill="#EF476F" {...OUTLINE} />
      <ellipse cx={53} cy={112} rx={2.6} ry={1.8} transform="rotate(-35 53 112)" fill={PALETTE.white} opacity={0.85} />
      <path d="M96 126 Q100 112 104 100" fill="none" stroke={PALETTE.ink} strokeWidth={5} strokeLinecap="round" />
      <path d="M96 126 Q100 112 104 100" fill="none" stroke={LEAF} strokeWidth={2.4} strokeLinecap="round" />
      <circle cx={105} cy={95} r={6.5} fill="#E5484D" {...OUTLINE} strokeWidth={2.5} />
      <path d="M102 95 C102 91 108 91 108 95 C108 97 104 98 104 95" fill="none" stroke="#8F2226" strokeWidth={1.4} />
      <Grip angle={-70} />
    </>
  ),
};

/** Người báo thù: băng đầu đỏ bay, vết sẹo, dao găm; áo choàng đỏ thẫm sau lưng. */
const avenger: Outfit = {
  front: () => (
    <>
      <Headband fill="#C9353A" />
      <path d="M77 58 L72 66 M75 59 L78 60 M73 63 L76 64" stroke={PALETTE.ink} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M100 116 L112 86 L114 88 L104 118 Z" fill={STEEL} {...OUTLINE} strokeWidth={2.5} />
      <path d="M96 114 L108 120" stroke={PALETTE.ink} strokeWidth={5} strokeLinecap="round" />
      <path d="M96 114 L108 120" stroke={PALETTE.gold} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M100 118 L96 128" stroke={PALETTE.ink} strokeWidth={6} strokeLinecap="round" />
      <path d="M100 118 L96 128" stroke={WOOD_DARK} strokeWidth={3} strokeLinecap="round" />
      <Grip angle={-68} />
    </>
  ),
  back: () => (
    <>
      <path d="M34 84 C18 104 10 130 12 150 C36 156 84 156 108 150 C110 130 102 104 86 84 Z" fill="#8F2226" {...OUTLINE} />
      <path d="M20 148 L26 138 L32 150 M90 150 L96 138 L102 148" fill="none" stroke={PALETTE.ink} strokeWidth={1.6} opacity={0.4} />
    </>
  ),
};

/** Vệ sĩ: kính đen, tai nghe dây xoắn, khiên chống bạo động. */
const bodyguard: Outfit = {
  front: () => (
    <>
      <rect x={39} y={62} width={19} height={12} rx={4} fill={BLACK} {...OUTLINE} strokeWidth={2.5} />
      <rect x={62} y={62} width={19} height={12} rx={4} fill={BLACK} {...OUTLINE} strokeWidth={2.5} />
      <path d="M58 66 L62 66" stroke={PALETTE.ink} strokeWidth={2.5} />
      <path d="M42 65 L48 64 M65 65 L71 64" stroke={PALETTE.white} strokeWidth={1.6} strokeLinecap="round" opacity={0.6} />
      <circle cx={86} cy={70} r={2.6} fill={BLACK} stroke={PALETTE.ink} strokeWidth={1.4} />
      <path d="M86 72 c3 2 -3 4 0 6 c3 2 -3 4 0 6 c3 2 -3 4 0 6" fill="none" stroke={STEEL_DARK} strokeWidth={1.6} />
      <path d="M94 92 L116 92 L116 112 C116 124 106 132 105 133 C104 132 94 124 94 112 Z" fill="#5B6B8C" {...OUTLINE} />
      <path d="M98 96 L112 96 L112 111 C112 119 106 126 105 127 C104 126 98 119 98 111 Z" fill="none" stroke={PALETTE['goose-soft']} strokeWidth={1.8} />
      <path d={starPath(105, 109, 6, 2.6)} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.6} />
      <Grip x={95} y={124} angle={-15} />
    </>
  ),
};

/** Thợ săn quỷ: mũ rộng vành khoá bạc, mặt dây thánh giá, nỏ. */
const demonHunter: Outfit = {
  front: () => (
    <>
      <path d="M44 52 C44 42 50 38 60 38 C70 38 76 42 76 52 Z" fill="#3A2A22" {...OUTLINE} />
      <rect x={44.5} y={46} width={31} height={5.5} fill="#1E1612" stroke={PALETTE.ink} strokeWidth={1.8} />
      <rect x={55} y={45} width={10} height={7.5} rx={1} fill="none" stroke={STEEL} strokeWidth={2.2} />
      <path d="M22 52 C30 60 90 60 98 52 C90 49 30 49 22 52 Z" fill="#2E211A" {...OUTLINE} />
      <path d="M48 95 L60 110 L72 95" fill="none" stroke={STEEL_DARK} strokeWidth={1.6} />
      <path d="M60 108 L60 124 M54 113 L66 113" stroke={PALETTE.ink} strokeWidth={5.5} strokeLinecap="round" />
      <path d="M60 108 L60 124 M54 113 L66 113" stroke={STEEL} strokeWidth={2.8} strokeLinecap="round" />
      <path d="M86 122 L116 110" stroke={PALETTE.ink} strokeWidth={7} strokeLinecap="round" />
      <path d="M86 122 L116 110" stroke={WOOD} strokeWidth={3.8} strokeLinecap="round" />
      <path d="M104 96 Q118 110 112 128" fill="none" stroke={PALETTE.ink} strokeWidth={5.5} strokeLinecap="round" />
      <path d="M104 96 Q118 110 112 128" fill="none" stroke={STEEL} strokeWidth={2.6} strokeLinecap="round" />
      <path d="M104 96 L100 114 L112 128" fill="none" stroke={PALETTE.wing} strokeWidth={1.2} />
      <path d="M100 114 L118 107" stroke={PALETTE.ink} strokeWidth={2} />
      <path d="M118 107 l-4 -2 l1 5 Z" fill={STEEL} stroke={PALETTE.ink} strokeWidth={1.2} />
      <Grip x={94} y={122} angle={-20} />
    </>
  ),
};

/** Cảnh sát trưởng: mũ cao bồi, sao sáu cánh trên ngực, súng lục. */
const sheriff: Outfit = {
  front: () => (
    <>
      <path d="M44 51 C43 38 51 35 55 40 C57 36 63 36 65 40 C69 35 77 38 76 51 Z" fill="#C8955A" {...OUTLINE} />
      <rect x={44} y={46} width={32} height={5} fill="#5A3818" stroke={PALETTE.ink} strokeWidth={1.8} />
      <path d="M24 46 C28 58 92 58 96 46 C90 53 78 54 60 54 C42 54 30 53 24 46 Z" fill="#B07E45" {...OUTLINE} />
      <path d={starPath(60, 116, 12, 6, 6)} fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.5} />
      {Array.from({ length: 6 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        return <circle key={i} cx={60 + 12 * Math.cos(a)} cy={116 + 12 * Math.sin(a)} r={1.8} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.2} />;
      })}
      <circle cx={60} cy={116} r={3} fill="none" stroke={PALETTE['gold-ink']} strokeWidth={1.4} />
      <path d="M94 124 L99 112 L117 104 L119 110 L103 117 L101 127 Z" fill={STEEL_DARK} {...OUTLINE} strokeWidth={2.5} />
      <path d="M94 124 L99 112 L103 117 L101 127 Z" fill={WOOD} stroke={PALETTE.ink} strokeWidth={2} />
      <Grip angle={-25} />
    </>
  ),
};

/** Binh lính: mũ sắt rằn ri, thẻ bài, huân chương, súng trường. */
const soldier: Outfit = {
  front: () => (
    <>
      <path d="M37 56 C37 41 46 35 60 35 C74 35 83 41 83 56 Z" fill="#5A6B3A" {...OUTLINE} />
      <path d="M44 44 C48 42 52 46 56 43 M64 40 C68 42 72 39 76 44 M48 51 C52 49 56 52 60 50" fill="none" stroke="#3B4724" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M32 56 C40 52 80 52 88 56 L86 61 C78 57 42 57 34 61 Z" fill="#4A5A2E" {...OUTLINE} strokeWidth={2.5} />
      <path d="M44 95 L56 116 M76 95 L64 116" stroke={STEEL_DARK} strokeWidth={1.6} strokeDasharray="1.5 1.5" />
      <rect x={52} y={114} width={7} height={10} rx={2} fill={STEEL} stroke={PALETTE.ink} strokeWidth={1.6} />
      <rect x={60} y={115} width={7} height={10} rx={2} fill={STEEL} stroke={PALETTE.ink} strokeWidth={1.6} />
      <rect x={36} y={102} width={9} height={7} fill="#C9353A" stroke={PALETTE.ink} strokeWidth={1.6} />
      <path d={starPath(40.5, 114, 5, 2.2)} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.4} />
      <path d="M88 136 L116 90" stroke={PALETTE.ink} strokeWidth={8} strokeLinecap="round" />
      <path d="M88 136 L116 90" stroke={BLACK} strokeWidth={4.5} strokeLinecap="round" />
      <path d="M86 140 L92 128 L98 131 L92 143 Z" fill={WOOD} {...OUTLINE} strokeWidth={2.4} />
      <Grip angle={-58} />
    </>
  ),
};

/** Dân phòng: mặt nạ che mắt kiểu hiệp sĩ đêm, khăn quàng đỏ, súng hoả mai một phát. */
const vigilante: Outfit = {
  front: () => (
    <>
      <path
        data-part="mask"
        d="M33 62 C44 57 76 57 87 62 L86 75 C76 79 44 79 34 75 Z M42.5 69 a7.5 7 0 1 0 15 0 a7.5 7 0 1 0 -15 0 Z M62.5 69 a7.5 7 0 1 0 15 0 a7.5 7 0 1 0 -15 0 Z"
        fillRule="evenodd"
        fill={BLACK}
        {...OUTLINE}
        strokeWidth={2.5}
      />
      <path d="M34 64 C26 60 20 62 14 58 C18 66 26 68 34 70 Z" fill={BLACK} {...OUTLINE} strokeWidth={2.2} />
      <Neckerchief fill="#C9353A" />
      <path d="M94 124 L100 112 L118 100 L120 104 L104 116 L100 126 Z" fill={WOOD} {...OUTLINE} strokeWidth={2.5} />
      <path d="M100 112 L118 100" stroke={STEEL_DARK} strokeWidth={3} strokeLinecap="round" />
      <path d="M103 110 L106 104" stroke={PALETTE.ink} strokeWidth={2.4} strokeLinecap="round" />
      <Grip angle={-25} />
    </>
  ),
};

const SPIRIT = '#B9A2FF';

/** Tinh linh: con mắt thứ ba trên trán, lửa hồn lơ lửng; hồn mờ tách khỏi thân phía sau. */
const astral: Outfit = {
  front: () => (
    <>
      <path d="M50 49 C55 42 65 42 70 49 C65 56 55 56 50 49 Z" fill={PALETTE.white} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={60} cy={49} r={3.8} fill={PALETTE.third} />
      <circle cx={60} cy={49} r={1.6} fill={PALETTE.ink} />
      <path d="M60 40 L60 37 M53 41.5 L51.5 39 M67 41.5 L68.5 39" stroke={SPIRIT} strokeWidth={1.8} strokeLinecap="round" />
      <path className="aura-twinkle" d="M98 70 C92 64 96 56 100 52 C101 58 106 60 104 66 C103 69 101 70 98 70 Z" fill={SPIRIT} opacity={0.85} stroke={PALETTE.ink} strokeWidth={1.6} />
      <path className="aura-twinkle" style={{ animationDelay: '-1.1s' }} d="M20 84 C15 79 18 73 21 70 C22 75 26 76 24 81 C23 83 22 84 20 84 Z" fill={SPIRIT} opacity={0.85} stroke={PALETTE.ink} strokeWidth={1.6} />
      <circle className="aura-twinkle" style={{ animationDelay: '-0.5s' }} cx={104} cy={98} r={3} fill={PALETTE.white} />
      <Neckerchief fill={PALETTE.third} stripe={SPIRIT} />
    </>
  ),
  back: () => (
    <g transform="translate(-12 -8)" opacity={0.35}>
      <path
        d="M60 38 C79 38 86 56 86 74 C86 87 100 96 100 118 C100 139 82 148 60 148 C38 148 20 139 20 118 C20 96 34 87 34 74 C34 56 41 38 60 38 Z"
        fill={SPIRIT}
        stroke={PALETTE.third}
        strokeWidth={2}
      />
    </g>
  ),
};

/** Thầy bói: khăn trùm đầu tím viền đồng xu, quạt bài tarot. */
const fortuneTeller: Outfit = {
  front: () => (
    <>
      <path d="M37 76 C30 66 30 50 36 44 C30 58 34 68 40 74 Z" fill="#6A2FA0" {...OUTLINE} strokeWidth={2.2} />
      <path d="M36 57 C33 42 46 34 60 34 C74 34 87 42 84 57 C76 51 44 51 36 57 Z" fill="#7B3FB8" {...OUTLINE} />
      <path d="M44 40 C52 46 68 46 76 40" fill="none" stroke="#5A2890" strokeWidth={2} />
      {[42, 48, 54, 60, 66, 72, 78].map((x, i) => (
        <circle key={x} cx={x} cy={56 - (i === 0 || i === 6 ? 1.5 : i === 1 || i === 5 ? 0.5 : 0) + 2} r={2.3} fill={PALETTE.gold} stroke={PALETTE.ink} strokeWidth={1.2} />
      ))}
      {([[-22, '#2E2A5C'], [0, '#7B3FB8'], [22, '#2E2A5C']] as const).map(([a, c]) => (
        <g key={a} transform={`rotate(${a} 100 124)`}>
          <rect x={93} y={96} width={14} height={22} rx={2} fill={c} {...OUTLINE} strokeWidth={2.2} />
          <rect x={95.5} y={98.5} width={9} height={17} rx={1} fill="none" stroke={PALETTE.gold} strokeWidth={1} />
        </g>
      ))}
      <path d={starPath(100, 107, 4, 1.6)} fill={PALETTE.gold} />
      <Grip y={124} angle={-10} />
    </>
  ),
};

/** Kẻ điều khiển giấc mơ: mũ ngủ sọc rủ chỏm bông, mí mắt lim dim, chữ "Z" bay, gối ôm. */
const lucidDreamer: Outfit = {
  front: () => (
    <>
      <path d="M38 54 C38 42 48 36 62 36 C78 36 94 42 102 58 C94 52 86 50 82 52 L82 54 Z" fill="#3E5BB8" {...OUTLINE} />
      <path d="M52 37.5 C56 42 58 48 58 54 M70 37 C74 42 76 48 76 54 M86 41 C90 44 92 48 94 52" fill="none" stroke="#9FC2FF" strokeWidth={3} />
      <circle cx={102} cy={60} r={5} fill={PALETTE.white} {...OUTLINE} strokeWidth={2.5} />
      <rect x={35} y={50} width={50} height={8} rx={4} fill={PALETTE.white} {...OUTLINE} />
      <path d="M41.4 68.5 C41.4 57.6 58.6 57.6 58.6 68.5 Z M61.4 68.5 C61.4 57.6 78.6 57.6 78.6 68.5 Z" fill={PALETTE.white} stroke={PALETTE.ink} strokeWidth={2.2} strokeLinejoin="round" />
      <g fill="none" stroke={PALETTE['goose-soft']} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path className="aura-twinkle" d="M92 30 h6 l-6 7 h6" />
        <path className="aura-twinkle" style={{ animationDelay: '-0.9s' }} d="M104 38 h4 l-4 5 h4" />
      </g>
      <rect x={92} y={108} width={24} height={17} rx={7} fill="#CFE0FF" {...OUTLINE} transform="rotate(-12 104 116)" />
      <path d="M98 112 L110 110" stroke="#9FB7E8" strokeWidth={1.6} strokeLinecap="round" transform="rotate(-12 104 116)" />
      <Grip y={124} angle={-15} />
    </>
  ),
};

/** Thầy đồng: khăn xếp đính ngọc cắm lông, cầu pha lê toả sáng. */
const medium: Outfit = {
  front: () => (
    <>
      <path d="M36 56 C32 40 46 33 60 33 C74 33 88 40 84 56 C76 50 44 50 36 56 Z" fill="#2BA59A" {...OUTLINE} />
      <path d="M40 46 C50 40 70 40 80 46 M38 52 C50 45 70 45 82 52" fill="none" stroke="#1C7A72" strokeWidth={2} />
      <path d="M62 44 C62 36 66 32 70 30 C70 36 68 42 64 46 Z" fill={PALETTE['third-soft']} {...OUTLINE} strokeWidth={2} />
      <path d="M60 40 L65 46 L60 52 L55 46 Z" fill="#E5484D" {...OUTLINE} strokeWidth={2.2} />
      <circle cx={104} cy={104} r={16} fill={PALETTE.third} opacity={0.22} />
      <path d="M95 122 L113 122 L110 114 L98 114 Z" fill={PALETTE.gold} {...OUTLINE} strokeWidth={2.5} />
      <circle cx={104} cy={104} r={11} fill="#9FC9FF" fillOpacity={0.75} {...OUTLINE} />
      <path d="M98 106 C100 100 106 108 110 101" fill="none" stroke={PALETTE.third} strokeWidth={2} strokeLinecap="round" />
      <circle cx={100} cy={99} r={2.2} fill={PALETTE.white} opacity={0.9} />
      <path className="aura-twinkle" d={starPath(116, 92, 3, 1, 4)} fill={PALETTE.white} />
      <Grip y={124} angle={-10} />
    </>
  ),
};

const OUTFITS: Partial<Record<string, Outfit>> = {
  goose,
  gravy,
  canadian,
  mimic,
  seamstress,
  villager,
  celebrity,
  lobbyist,
  politician,
  birdwatcher,
  coroner,
  detective,
  inquisitor,
  mortician,
  stalker,
  tracker,
  engineer,
  locksmith,
  scientist,
  sensor,
  adventurer,
  street_urchin: streetUrchin,
  survivalist,
  saint,
  lover_goose: loverGoose,
  avenger,
  bodyguard,
  demon_hunter: demonHunter,
  sheriff,
  soldier,
  vigilante,
  astral,
  fortune_teller: fortuneTeller,
  lucid_dreamer: lucidDreamer,
  medium,
};

/** Bộ đồ riêng của role phe Ngỗng (`undefined` → mặc bộ chung của kit). */
export function gooseOutfit(role: { key: string; faction: string }): Outfit | undefined {
  return role.faction === 'goose' ? OUTFITS[role.key] : undefined;
}
