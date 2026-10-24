/**
 * Ngỗng nhỏ trang trí cho trạng thái "đang tải" (`QueryState`) và "chưa có gì" (`EmptyState`):
 * `GooseBody` trong khung của nó cắt bỏ khoảng trống bảng tên phía trên (y < 36) nên vừa khít
 * một ô 3:4; nhún nhẹ bằng `goose-idle` (styles.css, tự đứng yên khi máy bật giảm chuyển động).
 * Chỉ trang trí: `aria-hidden`, chữ đi kèm nằm ngoài.
 */

import { cx } from '../../lib/cx';
import { GooseBody } from './GooseBody';

export function MiniGoose({ className }: { className?: string }) {
  return (
    <svg viewBox="12 32 96 128" aria-hidden="true" className={cx('shrink-0 overflow-visible', className)}>
      <g className="goose-idle">
        <GooseBody />
      </g>
    </svg>
  );
}
