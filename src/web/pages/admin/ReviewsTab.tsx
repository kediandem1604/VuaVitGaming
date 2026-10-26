/**
 * Tab Duyệt điểm (spec §4.6): hàng chờ (cũ nhất trước, thứ tự của server) với nút Duyệt
 * và Từ chối (bắt buộc lý do ≤ 200 ký tự, kiểm tra tại chỗ trước khi gửi). Lần khai
 * đã xử lý rời hàng chờ ngay (sửa cache). `NOT_PENDING` (người khác vừa duyệt, hoặc
 * người khai vừa sửa — server nhắn "hãy xem lại") → hiện lời nhắn và tải lại hàng chờ.
 *
 * Giao diện Sảnh đêm (spec §6 Quản trị): hàng chờ là danh sách kiểu bảng (một panel,
 * hàng kẻ `night-700`, chữ 14px); Xác nhận từ chối là `btn-danger`. Lần khai có highlight
 * kèm link "Xem highlight" (tin Discord, tab mới) để mod xem trước khi duyệt. Dòng giá trị
 * đọc qua `formatReportValue`: role có chỉ số phụ ra "4 mạng đã giết + 2 lần ám sát trong
 * cuộc họp" (spec chỉ số phụ §7).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { ReportDto } from '../../../shared/api-types';
import { formatReportValue } from '../../../shared/metric';
import { ApiError, apiGet, apiSend, errorMessage } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { HighlightLink } from '../../components/HighlightLink';
import { QueryState } from '../../components/QueryState';
import { cx } from '../../lib/cx';
import { formatDateLabel, formatTime } from '../../lib/format';

export const PENDING_REPORTS_KEY = ['admin', 'reports', 'pending'] as const;
const REASON_MAX = 200;
const REASON_REQUIRED = 'Cần ghi lý do từ chối';

const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';

type ReviewBody = { approve: true } | { approve: false; reason: string };

export function ReviewsTab() {
  const queue = useQuery({ queryKey: PENDING_REPORTS_KEY, queryFn: () => apiGet<ReportDto[]>('/api/admin/reports?status=pending') });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl leading-tight font-extrabold text-white">Hàng chờ duyệt{queue.data ? ` (${queue.data.length})` : ''}</h2>
        <button type="button" className="btn-secondary" disabled={queue.isFetching} onClick={() => void queue.refetch()}>
          Tải lại
        </button>
      </div>
      <QueryState query={queue}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState>
              <p>Không có lần khai nào chờ duyệt</p>
            </EmptyState>
          ) : (
            <ul className="panel flex flex-col divide-y divide-night-700 p-0">
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
    <li className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-bold text-white">{report.member.displayName}</span>
        <span className="text-night-200">
          {report.role.icon} {report.role.nameVi}
        </span>
        <time dateTime={report.playedOn} className="ml-auto text-night-300 tabular-nums">
          {formatDateLabel(report.playedOn)}
        </time>
      </div>
      {/* `break-words`: "x + y" với hai nhãn dài phải xuống dòng ở 320px, không tràn ngang. */}
      <p className="text-lg leading-tight font-extrabold break-words text-white">{formatReportValue(report.value, report.extraValue, report.role)}</p>
      <p className="text-night-300">
        {report.sessionId !== null && <>Buổi #{report.sessionId} · </>}
        Khai lúc {formatTime(report.createdAt)} {formatDateLabel(new Date(report.createdAt))}
      </p>
      {report.note && <p className="text-night-200">{report.note}</p>}
      {report.highlightUrl && <HighlightLink href={report.highlightUrl} />}

      {rejecting ? (
        <form noValidate onSubmit={onReject} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={reasonId} className={LABEL_CLASS}>
              Lý do từ chối
            </label>
            <span className={cx(HINT_CLASS, 'tabular-nums')}>
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
            <button type="submit" className="btn-danger" disabled={review.isPending}>
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
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
    </li>
  );
}
