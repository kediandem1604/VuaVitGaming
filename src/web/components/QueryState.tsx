import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { errorMessage } from '../api';

interface QueryStateProps<T> {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}

/** Đang tải / lỗi (kèm Thử lại) / có dữ liệu. Có dữ liệu cũ thì vẫn hiện dữ liệu khi tải lại lỗi. */
export function QueryState<T>({ query, children }: QueryStateProps<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-duck">
          {errorMessage(query.error)}
        </p>
        <button type="button" className="btn-secondary" onClick={() => void query.refetch()}>
          Thử lại
        </button>
      </div>
    );
  }
  return <p className="text-slate-500 dark:text-slate-400">Đang tải…</p>;
}
