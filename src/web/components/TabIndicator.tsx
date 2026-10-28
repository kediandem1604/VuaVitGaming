/**
 * Vạch chỉ báo dưới dải tab (spec §5.3): một thanh 3px nằm tuyệt đối trong tablist (tablist phải
 * `relative`), trượt sang tab đang chọn bằng `transform` (`translateX` tới mép trái của tab và
 * `scaleX` theo bề rộng — không animate `left`/`width`), `--dur-base` `--ease-out` trong CSS
 * `.tab-indicator`; máy giảm chuyển động thì nhảy thẳng. Đo lại khi tab đổi và khi dải tab/tab đổi
 * cỡ (phông chữ về muộn, xoay màn hình). Chỉ trang trí: tab đang chọn đã có `aria-selected`.
 *
 * Tìm tab theo `id` và tablist qua `closest('[role="tablist"]')` ngay trong layout effect — không
 * nhận ref của tablist vì ref của cha chỉ được gắn sau layout effect của con (lần đo đầu sẽ trượt).
 *
 * Lần đo đầu chưa có `data-ready` nên CSS không chuyển động: vạch đứng ngay dưới tab, không mọc ra
 * từ mép trái lúc tải trang. Một khung hình sau mới bật `data-ready` để các lần đổi tab sau trượt.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import { cx } from '../lib/cx';

interface TabIndicatorProps {
  /** `id` của tab đang chọn (nằm trong tablist `position: relative` là `offsetParent` của nó). */
  selectedId: string;
  /** Màu vạch (mặc định vàng); vd màu phe ở "Tổng điểm theo phe". */
  className?: string;
}

interface Box {
  x: number;
  w: number;
}

export function TabIndicator({ selectedId, className }: TabIndicatorProps) {
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const measured = box !== null;

  // Đã đặt vị trí đầu tiên → khung hình sau mới cho trượt.
  useEffect(() => {
    if (!measured || ready) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [measured, ready]);

  useLayoutEffect(() => {
    const tab = document.getElementById(selectedId);
    const list = tab?.closest<HTMLElement>('[role="tablist"]');
    if (!tab || !list) {
      setBox(null);
      return;
    }
    const measure = () => setBox({ x: tab.offsetLeft, w: tab.offsetWidth });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    observer.observe(tab);
    return () => observer.disconnect();
  }, [selectedId]);

  return (
    <span
      aria-hidden="true"
      data-tab-indicator=""
      data-for={selectedId}
      data-ready={ready ? '' : undefined}
      className={cx('tab-indicator pointer-events-none absolute bottom-0 left-0 h-[3px] w-px bg-gold', className)}
      // Chưa đo được (tab chưa có trong DOM) thì ẩn, không để vạch 1px nằm ở góc.
      style={box ? { transform: `translateX(${box.x}px) scaleX(${box.w})` } : { opacity: 0 }}
    />
  );
}
