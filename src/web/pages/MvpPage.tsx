/**
 * Trang Tri ân (spec §6): lịch sử MVP theo ngày — vote vẫn ở Discord, đây chỉ xem kết quả.
 * Dãy chip ngày (`/api/mvp/dates`: 30 ngày gần nhất có kết quả, mới nhất trước; ngày đang
 * xem nền vàng), ô chọn ngày bất kỳ trong quá khứ (tới hôm nay) cho những ngày cũ hơn, và
 * Sảnh tri ân của ngày đang chọn (`DailyHall`, cùng giao diện trang Hôm nay). Ngày chọn nằm
 * trong `?ngay=YYYY-MM-DD` để chia sẻ được; không có, sai dạng hay không có thật trên lịch
 * (`2026-13-45`) thì coi như chưa chọn — lấy ngày mới nhất, không gọi API với ngày sai.
 */

import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useSearchParams } from 'react-router';
import type { HallOfDayDto } from '../../shared/api-types';
import { apiGet, errorMessage } from '../api';
import { DailyHall } from '../components/DailyHall';
import { EmptyState } from '../components/EmptyState';
import { cx } from '../lib/cx';
import { formatDateLabel, formatDayLabel, isIsoDate, vnTodayIso } from '../lib/format';

const DATE_PARAM = 'ngay';

export function MvpPage() {
  const [params, setParams] = useSearchParams();
  const dates = useQuery({ queryKey: ['mvp', 'dates'], queryFn: () => apiGet<string[]>('/api/mvp/dates') });

  const requested = params.get(DATE_PARAM);
  const selected = requested !== null && isIsoDate(requested) ? requested : (dates.data?.[0] ?? null);
  const today = vnTodayIso();
  const pickerId = useId();

  const hall = useQuery({
    queryKey: ['mvp', 'day', selected],
    queryFn: () => apiGet<HallOfDayDto>(`/api/mvp/day?date=${selected}`),
    enabled: selected !== null,
  });

  const select = (date: string) => setParams({ [DATE_PARAM]: date });

  return (
    <div className="flex flex-col gap-6">
      {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
      <h1 className="text-raised text-3xl leading-none font-extrabold text-white">Tri ân</h1>

      {dates.isPending && <p className="text-night-300">Đang tải…</p>}
      {dates.isError && <LoadError message={errorMessage(dates.error)} onRetry={() => void dates.refetch()} />}

      {dates.data && dates.data.length === 0 && selected === null && (
        <EmptyState>
          <p>Chưa có kết quả tri ân nào</p>
        </EmptyState>
      )}

      {dates.data && dates.data.length > 0 && (
        // Dải chip cuộn ngang trong chính nó (không cuộn cả trang); `-mx-4 px-4` cho dải chạm mép màn hình nhỏ.
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
                className={cx('chip shrink-0 px-4 py-1.5 text-base tabular-nums', active ? 'bg-gold text-gold-ink' : 'hover:brightness-110')}
                onClick={() => select(date)}
              >
                {formatDateLabel(date)}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={pickerId} className="text-sm font-bold text-night-300">
          Chọn ngày khác
        </label>
        <input
          id={pickerId}
          type="date"
          max={today}
          className="field max-w-48 tabular-nums"
          value={selected ?? ''}
          onChange={(event) => {
            const date = event.target.value;
            // Ô bị xoá, ngày chưa nhập xong hay ngày tương lai: giữ nguyên ngày đang xem.
            if (isIsoDate(date) && date <= today) select(date);
          }}
        />
      </div>

      {selected !== null && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl leading-tight font-extrabold text-white">{formatDayLabel(selected)}</h2>
          {hall.data ? (
            <DailyHall data={hall.data} emptyMessage="Ngày này chưa có kết quả vote" />
          ) : hall.isError ? (
            <LoadError message={errorMessage(hall.error)} onRetry={() => void hall.refetch()} />
          ) : (
            <p className="text-night-300">Đang tải…</p>
          )}
        </section>
      )}
    </div>
  );
}

/** Lỗi tải kèm nút Thử lại, cùng kiểu panel viền `duck-soft` của `QueryState`. */
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="panel flex flex-col items-start gap-3 border-duck-soft">
      <p role="alert" className="font-bold text-duck-soft">
        {message}
      </p>
      <button type="button" className="btn-secondary" onClick={onRetry}>
        Thử lại
      </button>
    </div>
  );
}
