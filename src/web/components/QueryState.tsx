import type { ReactNode } from 'react';
import { errorMessage } from '../api';
import { Delayed, SkeletonRows } from './Skeleton';

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
 * `aria-busy` — khi dữ liệu là bản cũ giữ lại lúc đổi mùa/role/bộ lọc thì con mờ còn 60%
 * (CSS `.query-block[aria-busy="true"] > *`), bố cục đứng yên, không nháy trống (spec §4.4).
 */
export function QueryState<T>({ query, children, skeleton }: QueryStateProps<T>) {
  if (query.data !== undefined) {
    return (
      <div className="query-block" aria-busy={query.isPlaceholderData === true}>
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
  return <Delayed>{skeleton ?? <SkeletonRows />}</Delayed>;
}
