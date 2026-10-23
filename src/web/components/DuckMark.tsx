/**
 * Logo đầu ngỗng trắng cạnh chữ "GGD Hub" ở thanh trên, thỉnh thoảng chớp mắt
 * (`duck-mark-eyes` trong styles.css). Cùng hình với `public/favicon.svg` — sửa
 * một bên thì sửa cả bên kia. Chỉ trang trí: tên link vẫn là chữ "GGD Hub".
 */

import { INK, ORANGE } from './DuckBody';

const WHITE = '#F5F2EB';

export function DuckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M14 7 C12 2 17 0 19 3 C17 4 16 5 17 7 Z" fill={WHITE} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
      <path
        d="M16 5 C24 5 28 11 28 18 C28 25 22 30 16 30 C10 30 4 25 4 18 C4 11 8 5 16 5 Z"
        fill={WHITE}
        stroke={INK}
        strokeWidth={2}
      />
      <g className="duck-mark-eyes">
        <circle cx="11.5" cy="15.5" r="4" fill="#fff" stroke={INK} strokeWidth={1.5} />
        <circle cx="20.5" cy="15.5" r="4" fill="#fff" stroke={INK} strokeWidth={1.5} />
        <circle cx="12.2" cy="16.4" r="1.7" fill={INK} />
        <circle cx="21.2" cy="16.4" r="1.7" fill={INK} />
      </g>
      <path d="M7.5 10.5 L14 12.5 M24.5 10.5 L18 12.5" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <path
        d="M9 21 C9 18.5 23 18.5 23 21 C23 25 19.5 27.5 16 27.5 C12.5 27.5 9 25 9 21 Z"
        fill={ORANGE}
        stroke={INK}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
