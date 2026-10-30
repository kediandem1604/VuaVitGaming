/**
 * Vạch chỉ báo dưới dải tab (spec §5.3): một thanh 3px nằm tuyệt đối trong tablist (tablist phải
 * `relative`), trượt sang tab đang chọn bằng `transform` (`translate` tới mép dưới-trái của tab và
 * `scaleX` theo bề rộng — không animate `left`/`top`/`width`), `--dur-base` `--ease-out` trong CSS
 * `.tab-indicator`; máy giảm chuyển động thì nhảy thẳng. Chỉ trang trí: tab đang chọn đã có `aria-selected`.
 *
 * Đo bằng `getBoundingClientRect` của tab so với chính tablist (khối chứa của vạch), cộng phần đã
 * cuộn và trừ viền tablist — không dùng `offsetLeft`/`offsetWidth` (làm tròn số nguyên nên vạch
 * hụt nửa pixel ở màn hình phóng 125%, và chỉ có trục ngang). Vạch đặt ngay dưới tab chứ không dính
 * đáy tablist, nên khi dải tab xuống hai dòng vạch vẫn theo tab sang dòng hai. Vạch thụt đều hai
 * bên (`INDICATOR_INSET`) cho nằm giữa viên thuốc bo tròn thay vì lòi ra ở hai góc bo.
 *
 * Đo lại khi tab đổi, khi tablist hay bất kỳ tab nào đổi cỡ (tab trước co giãn làm tab chọn dời
 * chỗ), khi cửa sổ đổi cỡ và khi phông chữ về muộn.
 *
 * Tìm tab theo `id` và tablist qua `closest('[role="tablist"]')` ngay trong layout effect — không
 * nhận ref của tablist vì ref của cha chỉ được gắn sau layout effect của con (lần đo đầu sẽ trượt).
 *
 * Lần đo đầu chưa có `data-ready` nên CSS không chuyển động: vạch đứng ngay dưới tab, không mọc ra
 * từ mép trái lúc tải trang. Một khung hình sau mới bật `data-ready` để các lần đổi tab sau trượt.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import { cx } from '../lib/cx';

/** Thụt mỗi bên (px) so với mép tab, để vạch nằm giữa phần thẳng của viên thuốc bo tròn. */
export const INDICATOR_INSET = 12;
/** Khoảng hở (px) giữa mép dưới tab (gồm bóng đổ của chip) và vạch. */
export const INDICATOR_GAP = 2;

interface TabIndicatorProps {
  /** `id` của tab đang chọn (nằm trong tablist `position: relative` — khối chứa của vạch). */
  selectedId: string;
  /** Màu vạch (mặc định vàng); vd màu phe ở "Tổng điểm theo phe". */
  className?: string;
}

export interface IndicatorBox {
  x: number;
  y: number;
  w: number;
}

type Rect = Pick<DOMRect, 'left' | 'right' | 'bottom'>;
type Scroller = Pick<HTMLElement, 'scrollLeft' | 'scrollTop' | 'clientLeft' | 'clientTop'>;

/**
 * Vị trí vạch trong hệ toạ độ của tablist (gốc = góc trên-trái vùng đệm, cuộn cùng nội dung):
 * lệch rect của tab so với rect tablist, trừ viền, cộng phần đã cuộn; thụt đều hai bên.
 */
export function indicatorBox(tab: Rect, list: Rect & { top: number }, scroller: Scroller): IndicatorBox {
  const width = tab.right - tab.left;
  const inset = Math.min(INDICATOR_INSET, width / 4);
  return {
    x: tab.left - list.left - scroller.clientLeft + scroller.scrollLeft + inset,
    y: tab.bottom - list.top - scroller.clientTop + scroller.scrollTop + INDICATOR_GAP,
    w: Math.max(0, width - inset * 2),
  };
}

export function TabIndicator({ selectedId, className }: TabIndicatorProps) {
  const [box, setBox] = useState<IndicatorBox | null>(null);
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
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const next = indicatorBox(tab.getBoundingClientRect(), list.getBoundingClientRect(), list);
      // Bỏ qua khi không đổi để ResizeObserver không gây render thừa.
      setBox((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    // Phông chữ về muộn làm chữ trong tab rộng ra.
    void document.fonts?.ready.then(measure);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(list);
      for (const el of list.querySelectorAll('[role="tab"]')) observer.observe(el);
    }
    return () => {
      alive = false;
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [selectedId]);

  return (
    <span
      aria-hidden="true"
      data-tab-indicator=""
      data-for={selectedId}
      data-ready={ready ? '' : undefined}
      className={cx('tab-indicator pointer-events-none absolute top-0 left-0 h-[3px] w-px bg-gold', className)}
      // Chưa đo được (tab chưa có trong DOM) thì ẩn, không để vạch 1px nằm ở góc.
      style={box ? { transform: `translate(${box.x}px, ${box.y}px) scaleX(${box.w})` } : { opacity: 0 }}
    />
  );
}
