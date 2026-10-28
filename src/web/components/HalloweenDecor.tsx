/**
 * Nút bật/tắt chủ đề Halloween (thanh trên) và lớp trang trí nền khi chủ đề đang bật: trăng
 * tròn, mạng nhện góc trái, bốn con dơi bay ngang, hai bóng ma lơ lửng. Lớp trang trí cố định
 * sau nội dung, chỉ chạy `transform` (styles.css, `.hw-*`), đứng yên khi máy giảm chuyển động
 * và chỉ được gắn vào DOM khi chủ đề bật — tắt chủ đề là không còn hoạt ảnh nào chạy.
 */

import { Ghost } from 'lucide-react';
import { cx } from '../lib/cx';
import { setTheme, useTheme } from '../lib/theme';

export function ThemeToggle({ className }: { className?: string }) {
  const on = useTheme() === 'halloween';
  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? 'Tắt chủ đề Halloween' : 'Bật chủ đề Halloween'}
      onClick={() => setTheme(on ? 'night' : 'halloween')}
      className={cx('theme-toggle btn-secondary px-2 py-1', className)}
    >
      <Ghost aria-hidden="true" className="size-4" strokeWidth={2.5} />
      <span className="sr-only">Chủ đề Halloween</span>
    </button>
  );
}

const INK = '#0D0714';

function Bat({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 64 32" className={cx('hw-bat', className)}>
      <g className="hw-bat-wings" fill={INK}>
        <path d="M32 12 C26 2 14 0 0 6 C8 8 10 12 10 16 C14 13 18 14 20 18 C23 15 27 15 32 20 Z" />
        <path d="M32 12 C38 2 50 0 64 6 C56 8 54 12 54 16 C50 13 46 14 44 18 C41 15 37 15 32 20 Z" />
      </g>
      <ellipse cx="32" cy="16" rx="5" ry="7" fill={INK} />
      <path d="M28 10 L29 5 L31 9 M36 10 L35 5 L33 9" fill={INK} stroke={INK} strokeWidth={1.5} />
      <circle cx="30" cy="13" r="1" fill="#FF9A2E" />
      <circle cx="34" cy="13" r="1" fill="#FF9A2E" />
    </svg>
  );
}

function GhostShape({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 40 48" className={cx('hw-ghost', className)}>
      <path d="M4 20 C4 8 12 2 20 2 C28 2 36 8 36 20 L36 46 L30 41 L25 46 L20 41 L15 46 L10 41 L4 46 Z" fill="#F0E4FF" />
      <ellipse cx="14" cy="20" rx="3" ry="4" fill={INK} />
      <ellipse cx="26" cy="20" rx="3" ry="4" fill={INK} />
      <ellipse cx="20" cy="30" rx="3" ry="2.5" fill={INK} />
    </svg>
  );
}

export function HalloweenDecor() {
  if (useTheme() !== 'halloween') return null;
  return (
    <div className="hw-decor" aria-hidden="true">
      <svg viewBox="0 0 100 100" className="hw-moon">
        <circle cx="50" cy="50" r="46" fill="#FFE7B0" />
        <circle cx="34" cy="38" r="8" fill="#F2C97A" opacity="0.6" />
        <circle cx="62" cy="62" r="11" fill="#F2C97A" opacity="0.5" />
        <circle cx="66" cy="30" r="5" fill="#F2C97A" opacity="0.6" />
      </svg>
      <svg viewBox="0 0 100 100" className="hw-web" fill="none" stroke="#F0E4FF" strokeWidth="0.8">
        <path d="M0 0 L100 30 M0 0 L80 80 M0 0 L30 100" />
        <path d="M30 9 Q24 24 24 24 Q9 24 9 30" />
        <path d="M60 18 Q48 48 48 48 Q18 48 18 60" />
        <path d="M90 27 Q72 72 72 72 Q27 72 27 90" />
      </svg>
      <Bat className="hw-bat-1" />
      <Bat className="hw-bat-2" />
      <Bat className="hw-bat-3" />
      <Bat className="hw-bat-4" />
      <GhostShape className="hw-ghost-1" />
      <GhostShape className="hw-ghost-2" />
    </div>
  );
}
