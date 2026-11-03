/**
 * Chủ đề Giáng sinh. `ChristmasDecor` là lớp trang trí nền (`ThemeDecor` chỉ gắn khi chủ đề bật):
 * ngôi sao sáng thay mặt trăng, tuyết rơi, xe trượt tuyết kèm tuần lộc bay ngang trời, người
 * tuyết và cây thông mờ ở hai góc dưới. `ChristmasLights` là dây đèn nháy treo dưới thanh trên
 * (`Layout`), chỉ hiện khi chủ đề bật (`.xm-lights` trong styles.css).
 *
 * Cố định sau nội dung, không bắt sự kiện trỏ, chỉ chạy `transform`/`opacity` (styles.css,
 * `.xm-*`); máy giảm chuyển động thì tuyết đứng yên rải rác, đèn sáng đều.
 */

import type { CSSProperties } from 'react';
import { cx } from '../lib/cx';

const SNOW = '#F2FFF8';
const INK = '#06140F';
const RED = '#D7263D';
const GOLD = '#FFC94A';
const PINE = '#1F6B47';

/**
 * Bông tuyết: vị trí ngang `x` (%), chỗ đứng khi không chạy hoạt ảnh `y` (vh — hoạt ảnh rơi tính
 * từ đó, `translateY` theo % thì lại theo cỡ bông tuyết), cỡ (px), tốc độ
 * (nhân `--dur-snow`, nhỏ hơn là rơi nhanh hơn) và pha (phần chu kỳ đã trôi) để không rơi cùng lúc.
 */
const FLAKES: { x: number; y: number; size: number; speed: number; phase: number; star: boolean }[] = [
  { x: 4, y: 22, size: 14, speed: 1.1, phase: 0.1, star: true },
  { x: 11, y: 64, size: 6, speed: 0.8, phase: 0.55, star: false },
  { x: 18, y: 38, size: 10, speed: 1.3, phase: 0.8, star: true },
  { x: 26, y: 82, size: 5, speed: 0.9, phase: 0.3, star: false },
  { x: 33, y: 12, size: 8, speed: 1.2, phase: 0.65, star: false },
  { x: 41, y: 52, size: 16, speed: 1.5, phase: 0.2, star: true },
  { x: 49, y: 74, size: 6, speed: 0.85, phase: 0.9, star: false },
  { x: 57, y: 30, size: 11, speed: 1.25, phase: 0.45, star: true },
  { x: 64, y: 88, size: 5, speed: 0.95, phase: 0.05, star: false },
  { x: 71, y: 46, size: 9, speed: 1.05, phase: 0.7, star: false },
  { x: 78, y: 18, size: 13, speed: 1.4, phase: 0.35, star: true },
  { x: 85, y: 68, size: 6, speed: 0.9, phase: 0.6, star: false },
  { x: 91, y: 36, size: 10, speed: 1.15, phase: 0.95, star: true },
  { x: 97, y: 80, size: 5, speed: 1, phase: 0.25, star: false },
];

function Flake({ star }: { star: boolean }) {
  if (!star) return <circle cx="12" cy="12" r="6" fill={SNOW} />;
  return (
    <g stroke={SNOW} strokeWidth={2.2} strokeLinecap="round">
      <path d="M12 2 V22 M3.3 7 L20.7 17 M3.3 17 L20.7 7" />
      <path d="M9 4.5 L12 7 L15 4.5 M9 19.5 L12 17 L15 19.5" fill="none" strokeWidth={1.6} />
    </g>
  );
}

function Sleigh() {
  return (
    <svg viewBox="0 0 160 48" className="xm-sleigh">
      <g fill={SNOW}>
        {/* Hai con tuần lộc: thân, chân phi, gạc. */}
        {[0, 34].map((dx) => (
          <g key={dx} transform={`translate(${dx} 0)`}>
            <ellipse cx="22" cy="24" rx="11" ry="5.5" />
            <path d="M31 21 L36 13 L39 14 L35 23 Z" />
            <circle cx="38" cy="12.5" r="3.6" />
            <path d="M14 27 L8 35 M18 28 L15 37 M27 28 L31 36 M30 26 L36 33" stroke={SNOW} strokeWidth={2} strokeLinecap="round" />
            <path d="M37 9 L35 3 M35 5 L32 3 M39 9 L42 3 M41 5 L44 4" stroke={SNOW} strokeWidth={1.5} strokeLinecap="round" />
          </g>
        ))}
        {/* Mũi đỏ của con dẫn đầu. */}
        <circle className="xm-nose" cx="75.5" cy="13" r="2.4" fill={RED} />
        {/* Dây cương nối xe. */}
        <path d="M44 22 Q60 26 70 22 M10 23 Q2 26 0 26" stroke={SNOW} strokeWidth={1} fill="none" opacity={0.8} />
        {/* Xe trượt: thân, thanh trượt cong, ông già Noel và bao quà. */}
        <path d="M96 20 L136 20 Q142 20 142 28 L142 34 L102 34 Q96 34 96 28 Z" />
        <path d="M94 40 L146 40 Q154 40 156 32" stroke={SNOW} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        <path d="M104 34 L104 40 M134 34 L134 40" stroke={SNOW} strokeWidth={2} />
        <circle cx="122" cy="10" r="5" />
        <path d="M115 20 Q122 12 129 20 Z" />
        <path d="M118 7 L126 4 L130 9 Z" fill={RED} />
        <ellipse cx="108" cy="16" rx="7" ry="6" />
      </g>
    </svg>
  );
}

function Snowman() {
  return (
    <svg viewBox="0 0 60 90" className="xm-snowman">
      <circle cx="30" cy="66" r="20" fill={SNOW} />
      <circle cx="30" cy="34" r="14" fill={SNOW} />
      <rect x="20" y="6" width="20" height="14" rx="2" fill={INK} />
      <rect x="15" y="18" width="30" height="4" rx="2" fill={INK} />
      <path d="M17 44 Q30 50 43 44 L41 50 Q30 53 19 50 Z" fill={RED} />
      <circle cx="25" cy="31" r="1.8" fill={INK} />
      <circle cx="35" cy="31" r="1.8" fill={INK} />
      <path d="M30 35 L40 37 L30 38 Z" fill="#FF9F1C" />
      <circle cx="30" cy="60" r="2" fill={INK} />
      <circle cx="30" cy="70" r="2" fill={INK} />
    </svg>
  );
}

function Tree() {
  return (
    <svg viewBox="0 0 80 100" className="xm-tree">
      <rect x="35" y="84" width="10" height="14" fill="#5A3A22" />
      <path d="M40 8 L66 44 H52 L72 70 H56 L76 88 H4 L24 70 H8 L28 44 H14 Z" fill={PINE} />
      <path className="xm-tree-star" d="M40 0 L43 7 L50 7.5 L44.5 12 L46.5 19 L40 15 L33.5 19 L35.5 12 L30 7.5 L37 7 Z" fill={GOLD} />
      <circle cx="34" cy="40" r="3" fill={RED} />
      <circle cx="48" cy="56" r="3" fill={GOLD} />
      <circle cx="28" cy="72" r="3" fill={SNOW} />
      <circle cx="54" cy="78" r="3" fill={RED} />
    </svg>
  );
}

export function ChristmasDecor() {
  return (
    <div className="xm-decor" aria-hidden="true">
      <svg viewBox="0 0 100 100" className="xm-star">
        <path d="M50 4 L61 37 L96 38 L68 59 L78 93 L50 73 L22 93 L32 59 L4 38 L39 37 Z" fill="#FFE7A3" />
        <path d="M50 22 L56 41 L76 42 L60 54 L66 74 L50 62 L34 74 L40 54 L24 42 L44 41 Z" fill="#FFF6D6" />
      </svg>
      {FLAKES.map((flake, i) => (
        <div
          key={i}
          className="xm-flake"
          style={{ '--x': `${flake.x}%`, '--y': `${flake.y}vh`, '--speed': flake.speed, '--phase': flake.phase } as CSSProperties}
        >
          <svg viewBox="0 0 24 24" className="xm-flake-sway" width={flake.size} height={flake.size}>
            <Flake star={flake.star} />
          </svg>
        </div>
      ))}
      <Sleigh />
      <Snowman />
      <Tree />
    </div>
  );
}

/** Dây đèn: một dải dài (2400 đơn vị) cắt theo bề rộng màn hình, bóng to nhỏ đúng cỡ ở mọi máy. */
const SCALLOP = 60;
const BULB_COLOURS = [RED, GOLD, '#3DDC84', '#5AB2FF', SNOW] as const;

export function ChristmasLights({ className }: { className?: string }) {
  const bulbs = Array.from({ length: 2400 / SCALLOP }, (_, i) => i);
  const wire = bulbs.map((i) => `Q${i * SCALLOP + SCALLOP / 2} 16 ${(i + 1) * SCALLOP} 2`).join(' ');
  return (
    <svg viewBox="0 0 2400 30" preserveAspectRatio="xMidYMin slice" className={cx('xm-lights', className)} aria-hidden="true">
      <path d={`M0 2 ${wire}`} fill="none" stroke="#0A2018" strokeWidth={1.6} />
      {bulbs.map((i) => (
        <g key={i} transform={`translate(${i * SCALLOP + SCALLOP / 2} 9)`}>
          <rect x="-2" y="0" width="4" height="4" rx="1" fill="#0A2018" />
          <ellipse
            className={`xm-bulb xm-bulb-${i % 4}`}
            cx="0"
            cy="10"
            rx="4"
            ry="6"
            fill={BULB_COLOURS[i % BULB_COLOURS.length]}
          />
        </g>
      ))}
    </svg>
  );
}
