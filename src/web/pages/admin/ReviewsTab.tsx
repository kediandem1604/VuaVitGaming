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
 * Báo cáo người chơi (spec điểm role §6): lần khai trong hàng chờ kèm báo cáo đang hiện
 * (`accusation`) có khung "Báo cáo: {người} ({role}) bắn {người bị bắn} — phe {phe}" và ba nút:
 * "Duyệt" → `{approve: true, accusation: 'approve'}` (duyệt cả hai), "Duyệt, bỏ báo cáo" → form
 * lý do rồi `{approve: true, accusation: 'reject', reason}`, "Từ chối" → `{approve: false, reason,
 * accusation: 'reject'}`. Không có khung (không báo cáo, hoặc báo cáo trùng bị ẩn —
 * `accusationDuplicate`, hàng chờ không ghi gì) thì thân gửi như cũ, không có `accusation`. Báo cáo
 * trùng còn chờ báo cáo sớm hơn của vụ (`accusationWaitingFor`): ghi chú "Báo cáo trùng — chờ quyết
 * báo cáo sớm hơn của {tên}" và nút Duyệt bị khoá (server cũng chặn 409) — Từ chối vẫn được. Duyệt
 * xong một lần khai có quyết định về báo cáo (hoặc nhận `VALIDATION`) thì tải lại hàng chờ: báo cáo
 * trùng kế tiếp có thể vừa hiện lên.
 * "Đã duyệt gần đây" ghi khung kèm kết quả báo cáo (đúng / bị bác kèm lý do); mục trừ điểm do
 * bị báo cáo (`source = 'accusation'`) mang chip "Bị trừ điểm" và đọc "Bị báo cáo: bắn {tên}
 * ({phe}) − {điểm} điểm" (`lib/accusations.ts`), huỷ duyệt riêng được như mọi dòng.
 *
 * Giao diện Sảnh đêm (spec §6 Quản trị): hai danh sách kiểu bảng (một panel, hàng kẻ
 * `night-700`, chữ 14px); Xác nhận từ chối / Xác nhận huỷ duyệt là `btn-danger` (xác nhận
 * duyệt-bỏ-báo-cáo vẫn là duyệt nên `btn-primary`). Lần khai có highlight kèm link "Xem
 * highlight" (tin Discord, tab mới) để mod xem trước khi duyệt. Dòng giá trị đọc qua
 * `formatReportValue`: role có chỉ số phụ ra "4 mạng đã giết + 2 lần ám sát trong cuộc họp"
 * (spec chỉ số phụ §7).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import type { AccusationDto, ReportDto, ReviewedReportDto } from '../../../shared/api-types';
import { formatReportValue } from '../../../shared/metric';
import { ApiError, apiGet, apiSend, errorMessage } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { HighlightLink } from '../../components/HighlightLink';
import { QueryState } from '../../components/QueryState';
import { PENALISED_CHIP, accusationStatusText, formatAccusationLine, formatPenaltyLine } from '../../lib/accusations';
import { cx } from '../../lib/cx';
import { useStaggerOnce } from '../../lib/motion';
import { formatDateLabel, formatTime } from '../../lib/format';
import { APPROVED_REPORTS_KEY, LEADERBOARD_TOTALS_KEY, MY_REPORTS_KEY, PENDING_REPORTS_KEY, TITLES_QUERY_KEY } from '../../lib/queryKeys';

/**
 * Cache đọc điểm đã duyệt — làm mới sau khi huỷ duyệt (khớp tiền tố: mọi role, mùa, thành viên),
 * kèm danh hiệu ở Hồ sơ và danh sách lần khai của chính mình (admin huỷ lần khai của chính mình —
 * mod không tự huỷ được, `SELF_REVIEW`).
 */
const SCORE_QUERY_KEYS = [['leaderboard'], ['leaderboard-factions'], LEADERBOARD_TOTALS_KEY, ['hall'], ['member'], TITLES_QUERY_KEY, MY_REPORTS_KEY] as const;
/** Mã 409 cho biết danh sách "Đã duyệt gần đây" đang xem đã cũ (người khác vừa huỷ, hoặc mùa vừa chốt). */
const STALE_APPROVED_CODES = new Set(['NOT_APPROVED', 'SEASON_CLOSED']);
/** Mã lỗi cho biết hàng chờ đang xem đã cũ (người khác vừa duyệt / người khai vừa sửa / khung báo cáo đã đổi). */
const STALE_PENDING_CODES = new Set(['NOT_PENDING', 'VALIDATION']);
const REASON_MAX = 200;

const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';

/**
 * Thân `POST /api/admin/reports/:id/review`: `accusation` chỉ gửi khi dòng có khung báo cáo
 * (server bắt buộc khi có khung, từ chối `NOT_PENDING` khi gửi mà không có khung).
 */
type ReviewBody = { approve: true; accusation?: 'approve' } | { approve: true; accusation: 'reject'; reason: string } | { approve: false; reason: string; accusation?: 'reject' };

/** Dòng hàng chờ đang hiện gì dưới ba nút: không gì / form lý do từ chối / form lý do bỏ báo cáo. */
type PendingMode = 'idle' | 'rejecting' | 'dropping';

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
  // Lần hiện đầu: 8 dòng đầu mờ + trượt so le (spec §5.4); duyệt/huỷ làm mới sau đó không chạy lại.
  const stagger = useStaggerOnce();

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
            <ul className={cx('panel flex flex-col divide-y divide-night-700 p-0', stagger)}>
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
  const [mode, setMode] = useState<PendingMode>('idle');
  const rejectReason = useReason('Cần ghi lý do từ chối');
  const dropReason = useReason('Cần ghi lý do bỏ báo cáo');
  /** Báo cáo đang hiện để mod quyết cùng lần khai; `null` = không có khung, thân gửi không có `accusation`. */
  const accusation = report.accusation;

  const review = useMutation({
    mutationFn: (body: ReviewBody) => apiSend<undefined>('POST', `/api/admin/reports/${report.id}/review`, body),
    onSuccess: (_, body) => {
      queryClient.setQueryData<ReportDto[]>(PENDING_REPORTS_KEY, (current) => current?.filter((item) => item.id !== report.id));
      // Vừa duyệt → lần khai này sang mục "Đã duyệt gần đây".
      if (body.approve) void queryClient.invalidateQueries({ queryKey: APPROVED_REPORTS_KEY });
      // Báo cáo vừa được quyết: báo cáo trùng của vụ có thể vừa hiện lên (bị bác) hoặc bị thay thế (đúng).
      if (body.accusation !== undefined) void queryClient.invalidateQueries({ queryKey: PENDING_REPORTS_KEY });
    },
    onError: (error) => {
      // Đã có người xử lý, người khai vừa sửa, hoặc khung báo cáo đã đổi (`VALIDATION`): hàng chờ hiện tại đã cũ.
      if (error instanceof ApiError && STALE_PENDING_CODES.has(error.code)) void queryClient.invalidateQueries({ queryKey: PENDING_REPORTS_KEY });
    },
  });

  // Lỗi tại chỗ chỉ của form đang mở.
  const localError = mode === 'rejecting' ? rejectReason.localError : mode === 'dropping' ? dropReason.localError : null;
  const error = localError ?? (review.isError ? errorMessage(review.error) : null);
  /** Báo cáo trùng còn chờ báo cáo sớm hơn của vụ: chưa duyệt được lần khai này. */
  const waitingNote = report.accusationWaitingFor ? `Báo cáo trùng — chờ quyết báo cáo sớm hơn của ${report.accusationWaitingFor.reporterName}` : null;
  const waitingNoteId = useId();

  // Đóng form lý do thì bỏ luôn lỗi của lần gửi hỏng và lỗi tại chỗ, không để treo dưới dòng.
  const closeForm = () => {
    review.reset();
    rejectReason.clearError();
    dropReason.clearError();
    setMode('idle');
  };

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
      {waitingNote && (
        <p id={waitingNoteId} className={HINT_CLASS}>
          {waitingNote}
        </p>
      )}

      {mode === 'rejecting' ? (
        <ReasonForm
          reason={rejectReason}
          label="Lý do từ chối"
          submitLabel="Xác nhận từ chối"
          cancelLabel="Huỷ"
          pending={review.isPending}
          // Lần khai bị từ chối thì báo cáo kèm theo cũng bị bác, cùng lý do.
          onSubmit={(trimmed) => review.mutate({ approve: false, reason: trimmed, ...(accusation ? { accusation: 'reject' } : {}) })}
          onCancel={closeForm}
        />
      ) : mode === 'dropping' ? (
        <ReasonForm
          reason={dropReason}
          label="Lý do bỏ báo cáo"
          submitLabel="Xác nhận duyệt, bỏ báo cáo"
          submitClassName="btn-primary"
          cancelLabel="Huỷ"
          pending={review.isPending}
          onSubmit={(trimmed) => review.mutate({ approve: true, accusation: 'reject', reason: trimmed })}
          onCancel={closeForm}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={review.isPending || waitingNote !== null}
            aria-describedby={waitingNote ? waitingNoteId : undefined}
            onClick={() => review.mutate({ approve: true, ...(accusation ? { accusation: 'approve' } : {}) })}
          >
            {review.isPending ? 'Đang gửi…' : 'Duyệt'}
          </button>
          {accusation && (
            <button type="button" className="btn-secondary" disabled={review.isPending} onClick={() => setMode('dropping')}>
              Duyệt, bỏ báo cáo
            </button>
          )}
          <button type="button" className="btn-secondary" disabled={review.isPending} onClick={() => setMode('rejecting')}>
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
      // Mục trừ điểm do báo cáo kèm lần khai này có thể vừa bị huỷ dây chuyền → tải lại danh sách.
      void queryClient.invalidateQueries({ queryKey: APPROVED_REPORTS_KEY });
      // Điểm mùa, Top 3 mỗi phe, Tổng điểm theo phe, Đại sảnh, trang thành viên, danh hiệu và lần khai của mình không còn tính lần khai này.
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
 * giá trị, dòng phụ `meta` ("Khai lúc …" / "Duyệt bởi …"), ghi chú, khung báo cáo kèm theo và
 * link highlight. Mục trừ điểm do bị báo cáo: chip "Bị trừ điểm", dòng giá trị đọc theo báo cáo
 * và không lặp ghi chú của server (cùng nội dung).
 */
function ReportSummary({ report, meta }: { report: ReportDto; meta: ReactNode }) {
  const penaltyOf = report.source === 'accusation' ? report.penaltyOf : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-bold text-white">{report.member.displayName}</span>
        <span className="text-night-200">
          {report.role.icon} {report.role.nameVi}
        </span>
        {report.source === 'accusation' && <span className="chip bg-duck-soft text-night-950">{PENALISED_CHIP}</span>}
        <time dateTime={report.playedOn} className="ml-auto text-night-300 tabular-nums">
          {formatDateLabel(report.playedOn)}
        </time>
      </div>
      {/* `break-words`: "x + y" với hai nhãn dài phải xuống dòng ở 320px, không tràn ngang. */}
      <p className="text-lg leading-tight font-extrabold break-words text-white">{penaltyOf ? formatPenaltyLine(penaltyOf) : formatReportValue(report, report.role)}</p>
      <p className="text-night-300">{meta}</p>
      {report.note && !penaltyOf && <p className="text-night-200">{report.note}</p>}
      {report.accusation && <AccusationBox accusation={report.accusation} />}
      {report.highlightUrl && <HighlightLink href={report.highlightUrl} />}
    </>
  );
}

/**
 * Khung báo cáo kèm lần khai: hàng chờ chỉ ghi dòng tóm tắt (mod quyết bằng ba nút bên dưới);
 * "Đã duyệt gần đây" ghi thêm kết quả (đúng / bị bác kèm lý do / đã có người báo cáo trước).
 */
function AccusationBox({ accusation }: { accusation: AccusationDto }) {
  return (
    <div className="panel-inset flex flex-col gap-1">
      <p className="font-bold break-words text-white">{formatAccusationLine(accusation)}</p>
      {accusation.status !== 'pending' && (
        <p className={accusation.status === 'approved' ? 'text-ok' : 'text-duck-soft'}>{accusationStatusText(accusation, 'mod')}</p>
      )}
    </div>
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
    /** Bỏ lỗi tại chỗ (khi đóng form). */
    clearError() {
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
  /** Lớp nút xác nhận; mặc định `btn-danger` (từ chối, huỷ duyệt), "Duyệt, bỏ báo cáo" dùng `btn-primary`. */
  submitClassName?: string;
  cancelLabel: string;
  pending: boolean;
  /** Nhận lý do đã cắt khoảng trắng, chỉ khi không rỗng. */
  onSubmit: (trimmed: string) => void;
  onCancel: () => void;
}

/** Form lý do dùng chung cho Từ chối, Huỷ duyệt và Duyệt-bỏ-báo-cáo: nhãn, đếm ký tự /200, nút xác nhận và nút đóng. */
function ReasonForm({ reason, label, submitLabel, submitClassName = 'btn-danger', cancelLabel, pending, onSubmit, onCancel }: ReasonFormProps) {
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
        <button type="submit" className={submitClassName} disabled={pending}>
          {pending ? 'Đang gửi…' : submitLabel}
        </button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}
