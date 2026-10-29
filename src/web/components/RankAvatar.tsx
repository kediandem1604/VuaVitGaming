/**
 * Avatar có khung hạng cho Top 1-2-3 (Top 3 mỗi phe, Tổng điểm theo phe, bục và bảng xếp
 * hạng): vòng vàng/bạc/đồng toả sáng, số hạng nhỏ ở góc. Mỗi bảng một kiểu khung (`board`):
 * phe Ngỗng vòng nguyệt quế xanh, phe Vịt hai dao găm bắt chéo, phe thứ 3 quỹ đạo sao và trăng
 * khuyết, bảng "Cả 3 phe" đôi cánh vàng — hạng 1 đội vương miện riêng của bảng đó. Từ hạng 4
 * là `Avatar` thường. Khung chỉ trang trí (`aria-hidden`), hạng đã đọc ở cột hạng bên cạnh.
 */

import type { ReactNode } from 'react';
import type { TotalsScope } from '../../shared/api-types';
import { PALETTE } from '../lib/palette';
import { Avatar } from './Avatar';

/** Bảng chứa avatar: một phe, hoặc `all` (Cả 3 phe). */
export type RankBoard = TotalsScope;

interface RankAvatarProps {
  rank: number;
  name: string;
  url: string | null;
  /** Bảng đang hiện — quyết định kiểu khung và vương miện. Mặc định `all`. */
  board?: RankBoard;
  /** Kích thước và cỡ chữ của avatar bên trong, vd `size-8 text-sm`. */
  className?: string;
  /** Hiện số hạng nhỏ ở góc dưới (tắt khi hạng đã in to ngay bên cạnh). */
  pip?: boolean;
}

export function RankAvatar({ rank, name, url, board = 'all', className, pip = true }: RankAvatarProps) {
  if (rank < 1 || rank > 3) return <Avatar name={name} url={url} className={className} />;
  return (
    <span className="rank-frame" data-rank={rank} data-board={board}>
      <svg viewBox="0 0 100 100" aria-hidden="true" className="rank-deco">
        {DECOR[board]}
      </svg>
      <span aria-hidden="true" className="rank-ring" />
      <Avatar name={name} url={url} className={className} />
      {rank === 1 && (
        <svg viewBox="0 0 24 16" aria-hidden="true" className="rank-crown">
          {CROWN[board]}
        </svg>
      )}
      {pip && (
        <span aria-hidden="true" className="rank-pip">
          {rank}
        </span>
      )}
    </span>
  );
}

const INK = PALETTE.ink;

// Trang trí quanh khung, khung `0 0 100 100` phủ rộng hơn avatar (avatar là vòng tâm (50, 50)
// bán kính ≈ 32): chỉ phần nằm ngoài vòng đó lộ ra, phần giữa bị avatar che.

/** Một lá nguyệt quế nghiêng `angle` độ tại (x, y). */
function Leaf({ x, y, angle, fill }: { x: number; y: number; angle: number; fill: string }) {
  return <ellipse cx={x} cy={y} rx={6.5} ry={3} transform={`rotate(${angle} ${x} ${y})`} fill={fill} stroke={INK} strokeWidth={1.6} />;
}

/** Lá dọc cung bán kính 41 từ góc 105° tới 215° (bên trái, 0° = phải, chiều kim đồng hồ). */
const LAUREL = [105, 127, 149, 171, 193, 215].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: 50 + 41 * Math.cos(a), y: 50 + 41 * Math.sin(a), angle: deg + 90 + 28 };
});

function Dagger({ flip }: { flip?: boolean }) {
  return (
    <g transform={flip ? 'translate(100 0) scale(-1 1)' : undefined}>
      <path d="M86 8 L92 6 L90 12 L30 72 L26 68 Z" fill="#E6EAF2" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <path d="M20 62 L36 78" stroke={INK} strokeWidth={6} strokeLinecap="round" />
      <path d="M20 62 L36 78" stroke="#C9353A" strokeWidth={3} strokeLinecap="round" />
      <path d="M26 74 L14 86" stroke={INK} strokeWidth={6} strokeLinecap="round" />
      <path d="M26 74 L14 86" stroke="#3A2440" strokeWidth={3} strokeLinecap="round" />
      <circle cx={12.5} cy={87.5} r={3.2} fill="#E5484D" stroke={INK} strokeWidth={1.6} />
    </g>
  );
}

function Wing({ flip }: { flip?: boolean }) {
  return (
    <path
      d="M17 40 C8 38 2 44 0 50 C5 49 8 51 6 56 C10 54 13 56 12 61 C16 58 18 58 20 62 Z"
      transform={flip ? 'translate(100 0) scale(-1 1)' : undefined}
      fill={PALETTE.gold}
      stroke={INK}
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
  );
}

const DECOR: Record<RankBoard, ReactNode> = {
  goose: (
    <g>
      {LAUREL.map((leaf) => (
        <Leaf key={leaf.angle} {...leaf} fill={PALETTE['goose-soft']} />
      ))}
      {LAUREL.map((leaf) => (
        <Leaf key={`r${leaf.angle}`} x={100 - leaf.x} y={leaf.y} angle={180 - leaf.angle} fill={PALETTE['goose-soft']} />
      ))}
      <path d="M40 92 L50 87 L60 92 L57 97 L50 94 L43 97 Z" fill={PALETTE.goose} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
    </g>
  ),
  duck: (
    <g>
      <Dagger />
      <Dagger flip />
    </g>
  ),
  neutral: (
    <g>
      <g className="rank-orbit">
        <ellipse cx={50} cy={50} rx={47} ry={17} transform="rotate(-24 50 50)" fill="none" stroke={PALETTE['third-soft']} strokeWidth={1.6} strokeDasharray="3 3" />
        <circle cx={92} cy={32} r={4} fill={PALETTE['third-soft']} stroke={INK} strokeWidth={1.4} />
        <circle cx={8} cy={68} r={2.6} fill={PALETTE.white} stroke={INK} strokeWidth={1.2} />
      </g>
      <path d="M14 22 A13 13 0 1 0 30 6 A10 10 0 1 1 14 22 Z" fill="#F2E8FF" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
    </g>
  ),
  all: (
    <g>
      <Wing />
      <Wing flip />
    </g>
  ),
};

const CROWN_EDGE = { stroke: INK, strokeWidth: 1.6, strokeLinejoin: 'round' } as const;

const CROWN: Record<RankBoard, ReactNode> = {
  // Vương miện vàng ba ngọc, ngọc giữa xanh phe Ngỗng.
  goose: (
    <>
      <path d="M2 14 L1 4 L7 8 L12 1 L17 8 L23 4 L22 14 Z" fill={PALETTE.gold} {...CROWN_EDGE} />
      <circle cx="12" cy="10" r="1.8" fill={PALETTE.goose} />
      <circle cx="6.5" cy="11" r="1.1" fill={PALETTE.white} />
      <circle cx="17.5" cy="11" r="1.1" fill={PALETTE.white} />
    </>
  ),
  // Vương miện gai sắt đen, ngọc đỏ máu.
  duck: (
    <>
      <path d="M2 14 L0.5 2 L5.5 8 L8 0.5 L12 7 L16 0.5 L18.5 8 L23.5 2 L22 14 Z" fill="#3A2440" {...CROWN_EDGE} />
      <path d="M3 12 L21 12" stroke="#E5484D" strokeWidth={1.2} />
      <path d="M12 8 L14 10.5 L12 13 L10 10.5 Z" fill="#E5484D" />
    </>
  ),
  // Vương miện trăng khuyết bạc tím, ngôi sao ở giữa.
  neutral: (
    <>
      <path d="M2 13 C4 6 9 3 12 3 C15 3 20 6 22 13 C18 10 6 10 2 13 Z" fill="#E6D8FF" {...CROWN_EDGE} />
      <path d="M12 1 L13.3 4.6 L17 4.8 L14.1 7 L15.1 10.6 L12 8.6 L8.9 10.6 L9.9 7 L7 4.8 L10.7 4.6 Z" fill={PALETTE.third} {...CROWN_EDGE} strokeWidth={1.2} />
    </>
  ),
  // Vương miện vàng cổ điển, ngọc đỏ giữa.
  all: (
    <>
      <path d="M2 14 L1 4 L7 8 L12 1 L17 8 L23 4 L22 14 Z" fill={PALETTE.gold} {...CROWN_EDGE} />
      <circle cx="12" cy="10" r="1.6" fill={PALETTE.duck} />
      <circle cx="6.5" cy="11" r="1.1" fill={PALETTE['goose-soft']} />
      <circle cx="17.5" cy="11" r="1.1" fill={PALETTE['goose-soft']} />
    </>
  ),
};
