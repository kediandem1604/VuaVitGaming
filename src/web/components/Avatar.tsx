import { cx } from '../lib/cx';

interface AvatarProps {
  name: string;
  url: string | null;
  /** Kích thước và cỡ chữ, vd `size-8 text-sm`. */
  className?: string;
  /**
   * Có nhãn thì avatar tự mang tên người (ảnh có `alt`, chữ cái đầu có `aria-label`)
   * — dùng khi tên không được viết ra bên cạnh (hàng avatar người tham gia).
   * Không có thì avatar chỉ là trang trí.
   */
  label?: string;
}

/** Ảnh đại diện; không có ảnh thì hiện chữ cái đầu trên nền màu Ngỗng. */
export function Avatar({ name, url, className, label }: AvatarProps) {
  if (url) {
    return (
      <img
        src={url}
        alt={label ?? ''}
        title={label}
        className={cx('shrink-0 rounded-full bg-slate-200 object-cover', className)}
      />
    );
  }
  return (
    <span
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label, title: label })}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-goose font-semibold text-white',
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
