/**
 * Nhóm năm con vịt đứng cạnh nhau ở trang đăng nhập, mỗi con một kiểu: ninja đen, ngỗng
 * thám tử (xanh phe Ngỗng), đại ca trắng khoanh cánh ở giữa, quý ông tím (phe thứ 3) nhấp
 * trà, vịt đỏ (phe Vịt) giấu dao. Vẽ mới theo phong cách game, không chép art chính thức.
 *
 * Chỉ để trang trí: cả khối `aria-hidden`. Hoạt ảnh nằm trong styles.css (tự tắt khi máy
 * bật giảm chuyển động); rê chuột hoặc chạm vào một con thì con đó nhảy lên một cái.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { DuckBody, INK, STROKE } from './DuckBody';

/** Cùng giá trị với `--goose/--duck/--neutral` trong styles.css. */
const GOOSE_BLUE = '#2F80ED';
const DUCK_RED = '#E5484D';
const NEUTRAL_PURPLE = '#8E4EC6';
const NINJA = '#3F4656';
const NINJA_HOOD = '#1F2430';
const WHITE = '#F5F2EB';
const GOLD = '#D4A72C';
const STEEL = '#E5E7EB';

interface Member {
  key: string;
  x: number;
  scale: number;
  /** Lệch nhịp hoạt ảnh để cả nhóm không nhún cùng lúc. */
  delay: string;
  blink: string;
  art: ReactNode;
}

/** Thứ tự vẽ = thứ tự chồng: hai con ngoài cùng nằm sau, đại ca ở giữa nằm trên cùng. */
const MEMBERS: Member[] = [
  { key: 'ninja', x: 8, scale: 1, delay: '-0.4s', blink: '5.3s', art: <NinjaDuck /> },
  { key: 'red', x: 412, scale: 1, delay: '-1.9s', blink: '4.1s', art: <RedDuck /> },
  { key: 'detective', x: 102, scale: 1, delay: '-1.1s', blink: '4.7s', art: <DetectiveGoose /> },
  { key: 'dandy', x: 318, scale: 1, delay: '-2.6s', blink: '6.1s', art: <DandyDuck /> },
  { key: 'boss', x: 206, scale: 1.08, delay: '0s', blink: '5.7s', art: <BossGoose /> },
];

const GROUND_Y = 40;

export function DuckSquad({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 230" aria-hidden="true" className={cx('overflow-visible', className)}>
      {MEMBERS.map((member) => (
        <SquadMember key={member.key} member={member} />
      ))}
    </svg>
  );
}

function SquadMember({ member }: { member: Member }) {
  const [hopping, setHopping] = useState(false);
  const hop = () => setHopping(true);
  const style = { '--duck-delay': member.delay, '--duck-blink': member.blink } as CSSProperties;

  // Vị trí đặt ở nhóm ngoài: transform của CSS (hoạt ảnh nhảy) sẽ đè thuộc tính transform của SVG.
  return (
    <g transform={`translate(${member.x} ${GROUND_Y + 172 * (1 - member.scale)}) scale(${member.scale})`}>
      <ellipse cx="50" cy="171" rx="34" ry="4" fill="currentColor" opacity={0.15} />
      <g
        className="duck"
        data-duck={member.key}
        data-hopping={hopping ? '' : undefined}
        style={style}
        onPointerEnter={hop}
        onPointerDown={hop}
        onAnimationEnd={() => setHopping(false)}
      >
        <g className="duck-sway">{member.art}</g>
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Nhân vật
// ---------------------------------------------------------------------------

function NinjaDuck() {
  return (
    <DuckBody
      colour={NINJA}
      lids="half"
      glance
      behind={
        // Áo choàng xẻ răng cưa sau lưng.
        <path
          d="M26 70 C12 108 6 146 4 166 L20 158 L34 168 L50 159 L66 168 L80 158 L96 166 C94 146 88 108 74 70 Z"
          fill={NINJA_HOOD}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
      }
      over={
        <>
          {/* Mũ trùm đầu với khe hở ở mắt. */}
          <path
            d="M50 12 C70 12 78 28 78 46 L78 72 L22 72 L22 46 C22 28 30 12 50 12 Z"
            fill={NINJA_HOOD}
            stroke={INK}
            strokeWidth={STROKE}
            strokeLinejoin="round"
          />
          <rect x="24" y="32" width="52" height="24" rx="12" fill={NINJA} stroke={INK} strokeWidth={2} />
          {/* Miếng giáp ngực với huy hiệu ổ khoá. */}
          <ellipse cx="50" cy="122" rx="22" ry="19" fill="#9AA3B2" stroke={INK} strokeWidth={2.5} />
          <circle cx="50" cy="119" r="8" fill={DUCK_RED} stroke={INK} strokeWidth={2} />
          <circle cx="50" cy="117" r="2.2" fill={INK} />
          <path d="M48.6 118 L51.4 118 L52.4 123.5 L47.6 123.5 Z" fill={INK} />
        </>
      }
    />
  );
}

function DetectiveGoose() {
  return (
    <DuckBody
      colour={GOOSE_BLUE}
      lids="open"
      glance
      front={
        <>
          {/* Mũ thám tử. */}
          <path d="M28 22 C28 3 72 3 72 22 Z" fill="#A0713F" stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
          <path d="M29 15 H71 V21 H29 Z" fill="#5C3A1E" />
          <ellipse cx="50" cy="23" rx="33" ry="6.5" fill="#8B5E34" stroke={INK} strokeWidth={STROKE} />
          {/* Cánh giơ kính lúp lên ngang mắt. */}
          <path d="M80 114 C94 106 97 94 91 87 C85 91 81 101 75 106 Z" fill={GOOSE_BLUE} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M91 92 L96 78" stroke={INK} strokeWidth={8} strokeLinecap="round" />
          <path d="M91 92 L96 78" stroke="#6B4423" strokeWidth={4.5} strokeLinecap="round" />
          <circle cx="98" cy="66" r="12.5" fill="#BFE3FF" fillOpacity={0.55} stroke={INK} strokeWidth={STROKE} />
          <circle cx="98" cy="66" r="9.5" fill="none" stroke={GOLD} strokeWidth={1.5} />
          <path className="duck-glint" d="M92 62 Q94.5 58 99 58" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
        </>
      }
    />
  );
}

function BossGoose() {
  return (
    <DuckBody
      colour={WHITE}
      lids="stern"
      behind={
        // Chỏm lông trên đỉnh đầu.
        <>
          <path d="M44 20 C40 8 48 2 56 6 C52 8 50 12 54 18 Z" fill={WHITE} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M54 18 C56 9 63 8 67 12 C63 13 61 16 61 21 Z" fill={WHITE} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        </>
      }
      front={
        // Hai cánh khoanh trước bụng.
        <>
          <path
            d="M15 108 C28 100 64 104 77 118 C70 126 60 128 50 126 C38 124 24 120 15 116 Z"
            fill={WHITE}
            stroke={INK}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <path
            d="M85 112 C72 104 36 108 23 122 C30 130 40 132 50 130 C62 128 76 124 85 120 Z"
            fill={WHITE}
            stroke={INK}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <path d="M34 124 L40 118 M42 127 L47 121" stroke={INK} strokeWidth={1.4} strokeLinecap="round" opacity={0.45} />
        </>
      }
    />
  );
}

function DandyDuck() {
  return (
    <DuckBody
      colour={NEUTRAL_PURPLE}
      lids="half"
      over={
        // Cổ áo trắng và nơ đen kiểu tuxedo.
        <>
          <path d="M40 84 L60 84 L50 104 Z" fill="#fff" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          <path d="M50 86 L39 80 L39 92 Z M50 86 L61 80 L61 92 Z" fill={INK} />
          <circle cx="50" cy="86" r="3" fill={INK} />
        </>
      }
      front={
        <>
          {/* Mũ chóp đội lệch. */}
          <g transform="rotate(-7 50 20)">
            <rect x="33" y="-16" width="34" height="37" rx="2" fill="#1A1D29" stroke={INK} strokeWidth={STROKE} />
            <rect x="37" y="-12" width="5" height="28" fill="#fff" opacity={0.12} />
            <rect x="33" y="10" width="34" height="7" fill={STEEL} stroke={INK} strokeWidth={2} />
            <ellipse cx="50" cy="21" rx="28" ry="5.5" fill="#1A1D29" stroke={INK} strokeWidth={STROKE} />
          </g>
          {/* Kính một mắt và dây xích. */}
          <circle cx="62" cy="44" r="13.5" fill="#fff" fillOpacity={0.15} stroke={GOLD} strokeWidth={2.5} />
          <path d="M75 49 Q83 66 73 84" fill="none" stroke={GOLD} strokeWidth={1.3} />
          {/* Cánh đỡ đĩa, tách trà nghiêng lên miệng theo nhịp. */}
          <path d="M80 114 C93 108 97 98 91 92 C85 94 81 102 74 106 Z" fill={NEUTRAL_PURPLE} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
          <g className="duck-tea">
            <path className="duck-steam" d="M78 72 C75 68 81 66 78 62 M84 72 C81 68 87 66 84 62" fill="none" stroke="#94A3B8" strokeWidth={1.6} strokeLinecap="round" />
            <path d="M89 79 C96 78 97 87 88 88" fill="none" stroke={INK} strokeWidth={2.2} />
            <path d="M69 76 H91 C91 86 87 92 80 92 C73 92 69 86 69 76 Z" fill="#fff" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
            <path d="M70 80 H90" stroke={NEUTRAL_PURPLE} strokeWidth={2} />
            <ellipse cx="80" cy="93" rx="13" ry="2.8" fill="#fff" stroke={INK} strokeWidth={2} />
          </g>
        </>
      }
    />
  );
}

function RedDuck() {
  return (
    <DuckBody
      colour={DUCK_RED}
      lids="stern"
      glance
      behind={
        // Con dao giấu sau lưng, chỉ lộ lưỡi phía trên cánh phải.
        <>
          <path d="M83 118 L101 74 Q106 70 106 77 L95 121 Z" fill={STEEL} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M90 116 L103 78" stroke="#9CA3AF" strokeWidth={1.4} strokeLinecap="round" />
          <path d="M79 116 L100 124" stroke={INK} strokeWidth={5} strokeLinecap="round" />
          <path
            className="duck-glint"
            d="M100 84 L101.3 88.2 L105.5 89.5 L101.3 90.8 L100 95 L98.7 90.8 L94.5 89.5 L98.7 88.2 Z"
            fill="#fff"
          />
        </>
      }
      front={
        // Băng đô đen, hai đuôi bay phần phật bên trái.
        <>
          <g className="duck-flutter">
            <path d="M24 33 C14 28 8 30 2 24 C6 34 12 38 22 38 Z" fill={NINJA_HOOD} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
            <path d="M23 37 C16 40 10 46 4 46 C10 50 18 46 24 41 Z" fill={NINJA_HOOD} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          </g>
          <path d="M23 29 Q50 21 77 29 L77 37 Q50 29 23 37 Z" fill={NINJA_HOOD} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
          <circle cx="24" cy="34" r="4" fill={NINJA_HOOD} stroke={INK} strokeWidth={2} />
        </>
      }
    />
  );
}
