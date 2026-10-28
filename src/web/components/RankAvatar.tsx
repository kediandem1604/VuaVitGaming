/**
 * Avatar có khung hạng cho Top 1-2-3 (Top 3 mỗi phe, Tổng điểm theo phe, bục và bảng xếp
 * hạng): vòng vàng/bạc/đồng toả sáng, vương miện trên hạng 1, số hạng nhỏ ở góc. Từ hạng 4
 * là `Avatar` thường. Khung chỉ trang trí (`aria-hidden`), hạng đã đọc ở cột hạng bên cạnh.
 */

import { PALETTE } from '../lib/palette';
import { Avatar } from './Avatar';

interface RankAvatarProps {
  rank: number;
  name: string;
  url: string | null;
  /** Kích thước và cỡ chữ của avatar bên trong, vd `size-8 text-sm`. */
  className?: string;
  /** Hiện số hạng nhỏ ở góc dưới (tắt khi hạng đã in to ngay bên cạnh). */
  pip?: boolean;
}

export function RankAvatar({ rank, name, url, className, pip = true }: RankAvatarProps) {
  if (rank < 1 || rank > 3) return <Avatar name={name} url={url} className={className} />;
  return (
    <span className="rank-frame" data-rank={rank}>
      <span aria-hidden="true" className="rank-ring" />
      <Avatar name={name} url={url} className={className} />
      {rank === 1 && (
        <svg viewBox="0 0 24 16" aria-hidden="true" className="rank-crown">
          <path
            d="M2 14 L1 4 L7 8 L12 1 L17 8 L23 4 L22 14 Z"
            fill={PALETTE.gold}
            stroke={PALETTE.ink}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <circle cx="12" cy="10" r="1.6" fill={PALETTE.duck} />
          <circle cx="6.5" cy="11" r="1.1" fill={PALETTE['goose-soft']} />
          <circle cx="17.5" cy="11" r="1.1" fill={PALETTE['goose-soft']} />
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
