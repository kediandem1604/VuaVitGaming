/**
 * Hai ô bật/tắt dùng chung cho các tab quản trị: `Switch` — công tắc có hiệu lực ngay
 * (`role="switch"`, cùng hình với công tắc ở trang Hồ sơ) và `Checkbox` — ô tick trong
 * form, chỉ gửi khi bấm Lưu. Cả hai vẽ lại bằng CSS vì ô tick mặc định của trình duyệt
 * không bảo đảm viền ≥ 3:1 trên panel tối: máng/ô khi tắt viền `night-600` (3.31:1 trên
 * `night-800`), khi bật nền `gold`. `<input>` thật vẫn nhận tiêu điểm và lấy tên từ
 * `<label>` bao ngoài; viền focus `gold` 3px hiện quanh hình thay thế.
 */

import type { ChangeEvent, ReactNode } from 'react';
import { cx } from '../../lib/cx';

interface ToggleProps {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Chữ của nhãn — thành tên đọc của ô. */
  children: ReactNode;
  /** Lớp thêm cho `<label>` bao ngoài (vị trí trong hàng, khoảng cách). */
  className?: string;
}

/**
 * Máng công tắc (như `ProfilePage`): tắt `night-700` viền `night-600`, bật `gold` viền cũng
 * vàng; viền là box-shadow nên không đẩy núm định vị tuyệt đối. Trượt chỉ khi máy không
 * giảm chuyển động (`motion-safe`).
 */
const TRACK_CLASS =
  'relative h-7 w-12 rounded-full bg-night-700 ring-2 ring-night-600 after:absolute after:top-0.5 after:left-0.5 after:size-6 after:rounded-full after:border-2 after:border-night-950 after:bg-white peer-checked:bg-gold peer-checked:ring-gold peer-checked:after:translate-x-5 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold peer-disabled:opacity-50 motion-safe:transition motion-safe:after:transition duration-(--dur-fast) ease-(--ease-out) after:duration-(--dur-fast) after:ease-(--ease-out)';

export function Switch({ id, checked, disabled, onChange, children, className }: ToggleProps) {
  return (
    <label htmlFor={id} className={cx('flex cursor-pointer items-center gap-2 text-sm font-bold text-night-200', className)}>
      {children}
      <span className="relative inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={onChange} />
        <span aria-hidden="true" className={TRACK_CLASS} />
      </span>
    </label>
  );
}

/** Ô tick 20px: viền `night-600`, tick `gold-ink` trên nền `gold` khi chọn; mờ đi khi `disabled`. */
export function Checkbox({ id, checked, disabled, onChange, children, className }: ToggleProps) {
  return (
    <label htmlFor={id} className={cx('flex cursor-pointer items-center gap-2', className)}>
      <span className="relative inline-flex shrink-0 has-[:disabled]:opacity-50">
        <input
          id={id}
          type="checkbox"
          className="peer size-5 appearance-none rounded-md border-2 border-night-600 bg-night-900 checked:border-gold checked:bg-gold"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
        <svg aria-hidden="true" viewBox="0 0 12 12" className="pointer-events-none absolute inset-0 m-auto size-3.5 opacity-0 peer-checked:opacity-100">
          <path d="M2 6.2 4.8 9 10 3.4" fill="none" stroke="var(--color-gold-ink)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {children}
    </label>
  );
}
