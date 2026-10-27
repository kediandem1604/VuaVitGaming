/**
 * Tab Duyệt điểm (spec §4.6): hàng chờ (cũ nhất trước, thứ tự của server) với nút Duyệt
 * và Từ chối (bắt buộc lý do ≤ 200 ký tự, kiểm tra tại chỗ trước khi gửi). Lần khai
 * đã xử lý rời hàng chờ ngay (sửa cache). `NOT_PENDING` (người khác vừa duyệt, hoặc
 * người khai vừa sửa — server nhắn "hãy xem lại") → hiện lời nhắn và tải lại hàng chờ.
 *
 * Dưới hàng chờ là mục "Đã duyệt gần đây" (spec huỷ duyệt §6): lần khai `approved` của
 * các mùa chưa chốt, mới duyệt trước, tối đa 50 — mỗi dòng ghi "Duyệt bởi {tên} lúc {giờ}
 * {ngày}" và có nút Huỷ duyệt mở form lý do cùng khuôn với form từ chối (`ReasonForm`).
 * Huỷ xong, dòng rời danh sách ngay (sửa cache) và bảng xếp hạng, Top 3 mỗi phe, Đại sảnh,
 * trang thành viên, danh hiệu ở Hồ sơ, danh sách lần khai của mình được làm mới; `NOT_APPROVED`
 * (người khác vừa huỷ) hay `SEASON_CLOSED` (mùa vừa chốt) → hiện lời nhắn và tải lại danh sách.
 * Đóng form lý do (Huỷ / Thôi) cũng xoá lỗi của lần gửi hỏng. Duyệt một lần khai ở hàng chờ
 * cũng làm mới mục này.
 *
 * Giao diện Sảnh đêm (spec §6 Quản trị): hai danh sách kiểu bảng (một panel, hàng kẻ
 * `night-700`, chữ 14px); Xác nhận từ chối / Xác nhận huỷ duyệt là `btn-danger`. Lần khai
 * có highlight kèm link "Xem highlight" (tin Discord, tab mới) để mod xem trước khi duyệt.
 * Dòng giá trị đọc qua `formatReportValue`: role có chỉ số phụ ra "4 mạng đã giết + 2 lần
 * ám sát trong cuộc họp" (spec chỉ số phụ §7).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import type { ReportDto, ReviewedReportDto } from '../../../shared/api-types';
import { formatReportValue } from '../../../shared/metric';
import { ApiError, apiGet, apiSend, errorMessage } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { HighlightLink } from '../../components/HighlightLink';
import { QueryState } from '../../components/QueryState';
import { cx } from '../../lib/cx';
import { formatDateLabel, formatTime } from '../../lib/format';
import { TITLES_QUERY_KEY } from '../ProfilePage';
import { MY_REPORTS_KEY } from '../ReportPage';

export const PENDING_REPORTS_KEY = ['admin', 'reports', 'pending'] as const;
export const APPROVED_REPORTS_KEY = ['admin', 'reports', 'approved'] as const;
/**
 * Cache đọc điểm đã duyệt — làm mới sau khi huỷ duyệt (khớp tiền tố: mọi role, mùa, thành viên),
 * kèm danh hiệu ở Hồ sơ và danh sách lần khai của chính mình (mod tự huỷ lần khai của mình).
 */
const SCORE_QUERY_KEYS = [['leaderboard'], ['leaderboard-factions'], ['hall'], ['member'], TITLES_QUERY_KEY, MY_REPORTS_KEY] as const;
/** Mã 409 cho biết danh sách "Đã duyệt gần đây" đang xem đã cũ (người khác vừa huỷ, hoặc mùa vừa chốt). */
const STALE_APPROVED_CODES = new Set(['NOT_APPROVED', 'SEASON_CLOSED']);
const REASON_MAX = 200;

const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';

type ReviewBody = { approve: true } | { approve: false; reason: string };

export function ReviewsTab() {
  // Hai mục xếp dọc; khoảng cách giữa chúng do tabpanel của trang Quản trị (`gap-4`) quyết định.
  return (
    <>
      <PendingQueue />
      <RecentlyApproved />
    </>
  );
}

function PendingQueue() {
  const headingId = useId();
  const queue = useQuery({ queryKey: PENDING_REPORTS_KEY, queryFn: () => apiGet<ReportDto[]>('/api/admin/reports?status=pending') });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <ListHeading id={headingId} title="Hàng chờ duyệt" query={queue} />
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

function RecentlyApproved() {
  const headingId = useId();
  const approved = useQuery({ queryKey: APPROVED_REPORTS_KEY, queryFn: () => apiGet<ReviewedReportDto[]>('/api/admin/reports?status=approved') });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <ListHeading id={headingId} title="Đã duyệt gần đây" query={approved} />
      <QueryState query={approved}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState>
              <p>Chưa có lần khai nào được duyệt trong mùa đang mở</p>
            </EmptyState>
          ) : (
            <ul className="panel flex flex-col divide-y divide-night-700 p-0">
              {list.map((report) => (
                <ApprovedReport key={report.id} report={report} />
              ))}
            </ul>
          )
        }
      </QueryState>
    </section>
  );
}

interface ListHeadingProps {
  id: string;
  title: string;
  query: { data: readonly unknown[] | undefined; isFetching: boolean; refetch: () => Promise<unknown> };
}

/** Tiêu đề mục kèm số dòng (khi đã có dữ liệu) và nút Tải lại. */
function ListHeading({ id, title, query }: ListHeadingProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={id} className="text-xl leading-tight font-extrabold text-white">
        {title}
        {query.data ? ` (${query.data.length})` : ''}
      </h2>
      <button type="button" className="btn-secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>
        Tải lại
      </button>
    </div>
  );
}

function PendingReport({ report }: { report: ReportDto }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const reason = useReason('Cần ghi lý do từ chối');

  const review = useMutation({
    mutationFn: (body: ReviewBody) => apiSend<undefined>('POST', `/api/admin/reports/${report.id}/review`, body),
    onSuccess: (_, body) => {
      queryClient.setQueryData<ReportDto[]>(PENDING_REPORTS_KEY, (current) => current?.filter((item) => item.id !== report.id));
      // Vừa duyệt → lần khai này sang mục "Đã duyệt gần đây".
      if (body.approve) void queryClient.invalidateQueries({ queryKey: APPROVED_REPORTS_KEY });
    },
    onError: (error) => {
      // Đã có người xử lý, hoặc người khai vừa sửa: hàng chờ hiện tại đã cũ.
      if (error instanceof ApiError && error.code === 'NOT_PENDING') void queryClient.invalidateQueries({ queryKey: PENDING_REPORTS_KEY });
    },
  });

  const error = reason.localError ?? (review.isError ? errorMessage(review.error) : null);

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm">
      <ReportSummary
        report={report}
        meta={
          <>
            {report.sessionId !== null && <>Buổi #{report.sessionId} · </>}
            Khai lúc {formatTime(report.createdAt)} {formatDateLabel(new Date(report.createdAt))}
          </>
        }
      />

      {rejecting ? (
        <ReasonForm
          reason={reason}
          label="Lý do từ chối"
          submitLabel="Xác nhận từ chối"
          cancelLabel="Huỷ"
          pending={review.isPending}
          onSubmit={(trimmed) => review.mutate({ approve: false, reason: trimmed })}
          onCancel={() => {
            // Đóng form thì bỏ luôn lỗi của lần gửi hỏng, không để treo dưới dòng.
            review.reset();
            setRejecting(false);
          }}
        />
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
      <ReviewError message={error} />
    </li>
  );
}

function ApprovedReport({ report }: { report: ReviewedReportDto }) {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState(false);
  const reason = useReason('Cần ghi lý do huỷ duyệt');

  const revoke = useMutation({
    mutationFn: (trimmed: string) => apiSend<undefined>('POST', `/api/admin/reports/${report.id}/revoke`, { reason: trimmed }),
    onSuccess: () => {
      queryClient.setQueryData<ReviewedReportDto[]>(APPROVED_REPORTS_KEY, (current) => current?.filter((item) => item.id !== report.id));
      // Điểm mùa, Top 3 mỗi phe, Đại sảnh, trang thành viên, danh hiệu và lần khai của mình không còn tính lần khai này.
      for (const queryKey of SCORE_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      // Người khác vừa huỷ (lần khai không còn `approved`) hoặc mùa vừa chốt: danh sách hiện tại đã cũ.
      if (error instanceof ApiError && STALE_APPROVED_CODES.has(error.code)) void queryClient.invalidateQueries({ queryKey: APPROVED_REPORTS_KEY });
    },
  });

  const error = reason.localError ?? (revoke.isError ? errorMessage(revoke.error) : null);

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm">
      <ReportSummary
        report={report}
        meta={
          <>
            Duyệt bởi {report.reviewedBy?.displayName ?? '—'} lúc {formatTime(report.reviewedAt)} {formatDateLabel(new Date(report.reviewedAt))}
          </>
        }
      />

      {revoking ? (
        <ReasonForm
          reason={reason}
          label="Lý do huỷ duyệt"
          submitLabel="Xác nhận huỷ duyệt"
          cancelLabel="Thôi"
          pending={revoke.isPending}
          onSubmit={(trimmed) => revoke.mutate(trimmed)}
          onCancel={() => {
            // Đóng form thì bỏ luôn lỗi của lần gửi hỏng, không để treo dưới dòng.
            revoke.reset();
            setRevoking(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={revoke.isPending} onClick={() => setRevoking(true)}>
            Huỷ duyệt
          </button>
        </div>
      )}
      <ReviewError message={error} />
    </li>
  );
}

/**
 * Phần chung của một dòng (hàng chờ lẫn đã duyệt): tên người khai, `{icon} {role}`, ngày chơi,
 * giá trị, dòng phụ `meta` ("Khai lúc …" / "Duyệt bởi …"), ghi chú và link highlight.
 */
function ReportSummary({ report, meta }: { report: ReportDto; meta: ReactNode }) {
  return (
    <>
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
      <p className="text-night-300">{meta}</p>
      {report.note && <p className="text-night-200">{report.note}</p>}
      {report.highlightUrl && <HighlightLink href={report.highlightUrl} />}
    </>
  );
}

function ReviewError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className={ERROR_CLASS}>
      {message}
    </p>
  );
}

/**
 * Ô lý do (từ chối / huỷ duyệt): giá trị đang gõ, lỗi tại chỗ, và bước cắt khoảng trắng +
 * kiểm rỗng trước khi gửi. Lỗi tại chỗ xoá khi gõ tiếp.
 */
function useReason(requiredMessage: string) {
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  return {
    value,
    localError,
    change(next: string) {
      setValue(next);
      setLocalError(null);
    },
    /** Lý do đã cắt khoảng trắng; rỗng → báo lỗi tại chỗ và trả `null` (không gửi gì). */
    validate(): string | null {
      const trimmed = value.trim();
      if (trimmed === '') {
        setLocalError(requiredMessage);
        return null;
      }
      setLocalError(null);
      return trimmed;
    },
  };
}

interface ReasonFormProps {
  reason: ReturnType<typeof useReason>;
  label: string;
  submitLabel: string;
  cancelLabel: string;
  pending: boolean;
  /** Nhận lý do đã cắt khoảng trắng, chỉ khi không rỗng. */
  onSubmit: (trimmed: string) => void;
  onCancel: () => void;
}

/** Form lý do dùng chung cho Từ chối và Huỷ duyệt: nhãn, đếm ký tự /200, nút `btn-danger` xác nhận và nút đóng. */
function ReasonForm({ reason, label, submitLabel, cancelLabel, pending, onSubmit, onCancel }: ReasonFormProps) {
  const reasonId = useId();
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = reason.validate();
        if (trimmed !== null) onSubmit(trimmed);
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={reasonId} className={LABEL_CLASS}>
          {label}
        </label>
        <span className={cx(HINT_CLASS, 'tabular-nums')}>
          {reason.value.length}/{REASON_MAX}
        </span>
      </div>
      <textarea id={reasonId} className="field min-h-16" rows={2} maxLength={REASON_MAX} value={reason.value} onChange={(event) => reason.change(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-danger" disabled={pending}>
          {pending ? 'Đang gửi…' : submitLabel}
        </button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}
