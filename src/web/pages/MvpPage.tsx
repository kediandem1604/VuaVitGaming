/**
 * Trang Tri ân: lịch sử MVP theo ngày. Hàng nút ngày (`/api/mvp/dates`, mới nhất
 * trước) và Sảnh tri ân của ngày đang chọn. Ngày chọn nằm trong `?ngay=YYYY-MM-DD`
 * để chia sẻ được; không có (hoặc sai dạng) thì lấy ngày mới nhất.
 */

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import type { HallOfDayDto } from '../../shared/api-types';
import { apiGet, errorMessage } from '../api';
import { DailyHall } from '../components/DailyHall';
import { cx } from '../lib/cx';
import { formatDateLabel, formatDayLabel } from '../lib/format';

const DATE_PARAM = 'ngay';
const VN_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function MvpPage() {
  const [params, setParams] = useSearchParams();
  const dates = useQuery({ queryKey: ['mvp', 'dates'], queryFn: () => apiGet<string[]>('/api/mvp/dates') });

  const requested = params.get(DATE_PARAM);
  const selected = requested !== null && VN_DATE.test(requested) ? requested : (dates.data?.[0] ?? null);

  const hall = useQuery({
    queryKey: ['mvp', 'day', selected],
    queryFn: () => apiGet<HallOfDayDto>(`/api/mvp/day?date=${selected}`),
    enabled: selected !== null,
  });

  const select = (date: string) => setParams({ [DATE_PARAM]: date });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Tri ân</h1>

      {dates.isPending && <p className="text-slate-500 dark:text-slate-400">Đang tải…</p>}
      {dates.isError && (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-duck">
            {errorMessage(dates.error)}
          </p>
          <button type="button" className="btn-secondary" onClick={() => void dates.refetch()}>
            Thử lại
          </button>
        </div>
      )}

      {dates.data && dates.data.length === 0 && selected === null && (
        <p className="text-slate-600 dark:text-slate-400">Chưa có kết quả tri ân nào</p>
      )}

      {dates.data && dates.data.length > 0 && (
        // Dải nút cuộn ngang trong chính nó (không cuộn cả trang); `-mx-4 px-4` cho dải chạm mép màn hình nhỏ.
        <div
          role="group"
          aria-label="Chọn ngày"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:thin]"
        >
          {dates.data.map((date) => {
            const active = date === selected;
            return (
              <button
                key={date}
                type="button"
                aria-pressed={active}
                className={cx(
                  'btn shrink-0 border whitespace-nowrap tabular-nums',
                  active
                    ? 'border-goose bg-goose text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
                onClick={() => select(date)}
              >
                {formatDateLabel(date)}
              </button>
            );
          })}
        </div>
      )}

      {selected !== null && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{formatDayLabel(selected)}</h2>
          {hall.data ? (
            <DailyHall data={hall.data} emptyMessage="Ngày này chưa có kết quả vote" />
          ) : hall.isError ? (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-duck">
                {errorMessage(hall.error)}
              </p>
              <button type="button" className="btn-secondary" onClick={() => void hall.refetch()}>
                Thử lại
              </button>
            </div>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">Đang tải…</p>
          )}
        </section>
      )}
    </div>
  );
}
