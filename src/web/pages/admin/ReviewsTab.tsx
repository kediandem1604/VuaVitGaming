/**
 * Tab Duyệt điểm (spec §4.6): hàng chờ (cũ nhất trước, thứ tự của server) với nút Duyệt
 * và Từ chối (bắt buộc lý do ≤ 200 ký tự, kiểm tra tại chỗ trước khi gửi). Lần khai
 * đã xử lý rời hàng chờ ngay (sửa cache). `NOT_PENDING` (người khác vừa duyệt, hoặc
 * người khai vừa sửa — server nhắn "hãy xem lại") → hiện lời nhắn và tải lại hàng chờ.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { ReportDto } from '../../../shared/api-types';
import { ApiError, apiGet, apiSend, errorMessage } from '../../api';
import { QueryState } from '../../components/QueryState';
import { formatDateLabel, formatTime } from '../../lib/format';

export const PENDING_REPORTS_KEY = ['admin', 'reports', 'pending'] as const;
const REASON_MAX = 200;
const REASON_REQUIRED = 'Cần ghi lý do từ chối';

type ReviewBody = { approve: true } | { approve: false; reason: string };

export function ReviewsTab() {
  const queue = useQuery({ queryKey: PENDING_REPORTS_KEY, queryFn: () => apiGet<ReportDto[]>('/api/admin/reports?status=pending') });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Hàng chờ duyệt{queue.data ? ` (${queue.data.length})` : ''}</h2>
        <button type="button" className="btn-secondary" disabled={queue.isFetching} onClick={() => void queue.refetch()}>
          Tải lại
        </button>
      </div>
      <QueryState query={queue}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-slate-600 dark:text-slate-400">Không có lần khai nào chờ duyệt</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((report) => (
                <PendingReport key={report.id} report={report} />
              ))}
            </ul>
          )
        }
      </QueryState>
    </section>
  );
}

function PendingReport({ report }: { report: ReportDto }) {
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: (body: ReviewBody) => apiSend<undefined>('POST', `/api/admin/reports/${report.id}/review`, body),
    onSuccess: () => {
      queryClient.setQueryData<ReportDto[]>(PENDING_REPORTS_KEY, (current) => current?.filter((item) => item.id !== report.id));
    },
    onError: (error) => {
      // Đã có người xử lý, hoặc người khai vừa sửa: hàng chờ hiện tại đã cũ.
      if (error instanceof ApiError && error.code === 'NOT_PENDING') void queryClient.invalidateQueries({ queryKey: PENDING_REPORTS_KEY });
    },
  });

  const onReject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed === '') {
      setLocalError(REASON_REQUIRED);
      return;
    }
    setLocalError(null);
    review.mutate({ approve: false, reason: trimmed });
  };

  const error = localError ?? (review.isError ? errorMessage(review.error) : null);

  return (
    <li className="card flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{report.member.displayName}</span>
        <span className="text-slate-700 dark:text-slate-300">
          {report.role.icon} {report.role.nameVi}
        </span>
        <time dateTime={report.playedOn} className="ml-auto text-sm text-slate-600 tabular-nums dark:text-slate-400">
          {formatDateLabel(report.playedOn)}
        </time>
      </div>
      <p className="text-lg">{`${report.value} ${report.role.metricLabel}`}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {report.sessionId !== null && <>Buổi #{report.sessionId} · </>}
        Khai lúc {formatTime(report.createdAt)} {formatDateLabel(new Date(report.createdAt))}
      </p>
      {report.note && <p className="text-sm text-slate-700 dark:text-slate-300">{report.note}</p>}

      {rejecting ? (
        <form noValidate onSubmit={onReject} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={reasonId} className="text-sm font-medium">
              Lý do từ chối
            </label>
            <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
              {reason.length}/{REASON_MAX}
            </span>
          </div>
          <textarea
            id={reasonId}
            className="field min-h-16"
            rows={2}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setLocalError(null);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn bg-duck text-white hover:bg-red-600" disabled={review.isPending}>
              {review.isPending ? 'Đang gửi…' : 'Xác nhận từ chối'}
            </button>
            <button type="button" className="btn-secondary" disabled={review.isPending} onClick={() => setRejecting(false)}>
              Huỷ
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={review.isPending} onClick={() => review.mutate({ approve: true })}>
            {review.isPending ? 'Đang gửi…' : 'Duyệt'}
          </button>
          <button type="button" className="btn-secondary" disabled={review.isPending} onClick={() => setRejecting(true)}>
            Từ chối
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-duck">
          {error}
        </p>
      )}
    </li>
  );
}
