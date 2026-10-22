import { cx } from '../lib/cx';

interface AvatarProps {
  name: string;
  url: string | null;
  /** Kích thước và cỡ chữ, vd `size-8 text-sm`. */
  className?: string;
}

/** Ảnh đại diện; không có ảnh thì hiện chữ cái đầu trên nền màu Ngỗng. */
export function Avatar({ name, url, className }: AvatarProps) {
  if (url) {
    return <img src={url} alt="" className={cx('shrink-0 rounded-full bg-slate-200 object-cover', className)} />;
  }
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-goose font-semibold text-white',
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
