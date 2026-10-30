/**
 * Logo đầu ngỗng trắng kiểu game (spec §4.4) cạnh chữ "GGD Hub" ở thanh trên: đầu tròn
 * trắng viền `ink` đậm, mắt đen to có đốm sáng, mỏ cam `beak`. Mắt thỉnh thoảng chớp
 * (`goose-eyes` trong styles.css). Cùng hình với `public/favicon.svg` — sửa một bên thì
 * sửa cả bên kia. Chỉ trang trí: tên link vẫn là chữ "GGD Hub".
 */

import { PALETTE } from '../lib/palette';

export function DuckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} overflow="visible">
      <path
        d="M16 3 C23 3 28 9 28 16 C28 23.5 22.5 29 16 29 C9.5 29 4 23.5 4 16 C4 9 9 3 16 3 Z"
        fill={PALETTE.white}
        stroke={PALETTE.ink}
        strokeWidth={2}
      />
      <g className="goose-eyes">
        <circle cx="11.4" cy="13.5" r="3" fill={PALETTE.ink} />
        <circle cx="20.6" cy="13.5" r="3" fill={PALETTE.ink} />
        <circle cx="12.3" cy="12.5" r="1" fill={PALETTE.white} />
        <circle cx="21.5" cy="12.5" r="1" fill={PALETTE.white} />
      </g>
      <path
        d="M8.5 20.5 C8.5 17 23.5 17 23.5 20.5 C23.5 25 19.5 27.5 16 27.5 C12.5 27.5 8.5 25 8.5 20.5 Z"
        fill={PALETTE.beak}
        stroke={PALETTE.ink}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      {/* Mũ phù thuỷ chỉ hiện khi bật chủ đề Halloween (`hw-only`). */}
      <g className="hw-only">
        <path d="M5 8 C10 6 14 0 22 -6 C20 -1 21 3 25 8 Z" fill="#432A5C" stroke={PALETTE.ink} strokeWidth={1.6} strokeLinejoin="round" />
        <rect x="9" y="4.6" width="14" height="2.6" fill="#FF9A2E" />
        <ellipse cx="15.5" cy="8" rx="13" ry="2.4" fill="#432A5C" stroke={PALETTE.ink} strokeWidth={1.6} />
      </g>
    </svg>
  );
}
