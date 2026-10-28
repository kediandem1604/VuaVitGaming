import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { errorMessage } from '../api';
import { LoadingFallback, SkeletonRows } from './Skeleton';

/** Khung thật nhận `aria-busy` thay cho `.query-block` (`display: contents`, có thể bị bỏ khỏi cây truy cập). */
const BUSY_HOST = 'section, [role="tabpanel"], [role="region"], article, main';

/** Số khối đang bận trong mỗi khung: hai `QueryState` chung một khung thì khung còn bận tới khi cả hai xong. */
const busyCounts = new WeakMap<Element, number>();

function markBusy(host: Element): () => void {
  busyCounts.set(host, (busyCounts.get(host) ?? 0) + 1);
  host.setAttribute('aria-busy', 'true');
  return () => {
    const left = (busyCounts.get(host) ?? 1) - 1;
    busyCounts.set(host, left);
    if (left <= 0) host.removeAttribute('aria-busy');
  };
}

/**
 * Phần kết quả truy vấn mà khối này cần. Kết quả của `useQuery` lẫn `useInfiniteQuery` đều
 * thoả (kiểu `refetch` của hai hook khác nhau nên không dùng thẳng `UseQueryResult`).
 */
interface QueryLike<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
  /** `true` khi `data` là dữ liệu cũ giữ lại (`placeholderData: keepPreviousData`) trong lúc tải tham số mới. */
  isPlaceholderData?: boolean;
}

interface QueryStateProps<T> {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  /** Khung xương hiện trong lúc chờ (sau 150ms); mặc định khung dòng danh sách. */
  skeleton?: ReactNode;
}

/**
 * Đang tải (khung xương, chỉ sau 150ms — spec §4.5) / lỗi (panel viền `duck-soft`, chữ lỗi và nút
 * Thử lại) / có dữ liệu. Có dữ liệu cũ thì vẫn hiện dữ liệu khi tải lại lỗi.
 *
 * Có dữ liệu: bọc trong `.query-block` (`display: contents`, không đổi bố cục của cha) mang
 * `data-busy` — khi dữ liệu là bản cũ giữ lại lúc đổi mùa/role/bộ lọc thì con mờ còn 60%
 * (CSS `.query-block[data-busy="true"] > *`), bố cục đứng yên, không nháy trống (spec §4.4).
 * `aria-busy` đặt ở khung thật gần nhất (`section`, tabpanel… — `BUSY_HOST`, không có thì cha
 * trực tiếp): phần tử `display: contents` có thể bị trình duyệt bỏ khỏi cây truy cập.
 */
export function QueryState<T>({ query, children, skeleton }: QueryStateProps<T>) {
  const block = useRef<HTMLDivElement>(null);
  const busy = query.data !== undefined && query.isPlaceholderData === true;

  useLayoutEffect(() => {
    const parent = block.current?.parentElement;
    if (!busy || !parent) return;
    return markBusy(parent.closest(BUSY_HOST) ?? parent);
  }, [busy]);

  if (query.data !== undefined) {
    return (
      <div ref={block} className="query-block" data-busy={busy}>
        {children(query.data)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="panel flex flex-col items-start gap-3 border-duck-soft">
        <p role="alert" className="font-bold text-duck-soft">
          {errorMessage(query.error)}
        </p>
        <button type="button" className="btn-secondary" onClick={() => void query.refetch()}>
          Thử lại
        </button>
      </div>
    );
  }
  return <LoadingFallback>{skeleton ?? <SkeletonRows />}</LoadingFallback>;
}
