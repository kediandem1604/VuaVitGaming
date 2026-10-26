import type { ReactNode } from 'react';
import { errorMessage } from '../api';
import { MiniGoose } from './goose/MiniGoose';

/**
 * Phần kết quả truy vấn mà khối này cần. Kết quả của `useQuery` lẫn `useInfiniteQuery` đều
 * thoả (kiểu `refetch` của hai hook khác nhau nên không dùng thẳng `UseQueryResult`).
 */
interface QueryLike<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

interface QueryStateProps<T> {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
}

/**
 * Đang tải (ngỗng nhỏ nhún + "Đang tải…") / lỗi (panel viền `duck-soft`, chữ lỗi và nút
 * Thử lại) / có dữ liệu. Có dữ liệu cũ thì vẫn hiện dữ liệu khi tải lại lỗi.
 */
export function QueryState<T>({ query, children }: QueryStateProps<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
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
  return (
    <div className="flex items-center gap-3 text-night-300">
      <MiniGoose className="h-12 w-9" />
      <p>Đang tải…</p>
    </div>
  );
}
