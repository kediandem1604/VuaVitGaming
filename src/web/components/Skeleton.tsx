/**
 * Khung xương (spec §4.5): khối bo góc `night-700` có ánh sáng chạy ngang 1.2s (lớp `skeleton`
 * trong `styles.css`, tắt khi giảm chuyển động) và vài mẫu ghép sẵn: dòng danh sách, thẻ,
 * trang. Mọi khung đều `aria-hidden`: trình đọc màn hình không cần "nghe" chỗ giữ; trạng thái
 * tải được báo bằng `aria-busy` ở khối bọc (`QueryState`).
 *
 * `Delayed` chỉ hiện con sau 150ms: dữ liệu/chunk về nhanh hơn thì không nháy khung xương.
 */

import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx';

/** Khung xương chỉ hiện sau khoảng này; tải nhanh hơn thì không thấy gì. */
export const SKELETON_DELAY_MS = 150;

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/** Một khối giữ chỗ; kích cỡ qua `className` (`h-4 w-32`…). */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return <div aria-hidden="true" className={cx('skeleton', className)} {...rest} />;
}

/** Dòng danh sách: avatar tròn + hai dòng chữ, kẻ như bảng xếp hạng. Mặc định của `QueryState`. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden="true" data-skeleton="rows" className={cx('panel flex flex-col divide-y divide-night-700 p-0', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5 max-w-40" />
            <Skeleton className="h-3 w-1/4 max-w-24" />
          </div>
          <Skeleton className="h-4 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Lưới thẻ (thẻ role, buổi chơi, huy hiệu): mỗi thẻ một panel có khối hình và hai dòng chữ. */
export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden="true" data-skeleton="cards" className={cx('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel flex flex-col gap-2">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Cả trang khi chunk chưa về: tiêu đề, dòng phụ, rồi một bảng dòng. */
export function PageSkeleton() {
  return (
    <div aria-hidden="true" data-skeleton="page" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-36 max-w-full" />
      </div>
      <SkeletonRows rows={6} />
    </div>
  );
}

/** Hiện `children` sau `delay` ms (mặc định 150); unmount sớm hơn thì không hiện gì. */
export function Delayed({ children, delay = SKELETON_DELAY_MS }: { children: ReactNode; delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return show ? <>{children}</> : null;
}
