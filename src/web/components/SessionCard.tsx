/**
 * Một buổi chơi trên trang Hôm nay: giờ VN, chế độ, trạng thái, `n/sức chứa`,
 * hàng avatar người tham gia, ghi chú, mã phòng và nút Tham gia / Huỷ tham gia.
 * Thẻ không tự gọi API: trang cha truyền `onToggle(going)`, `pending` và `error`.
 */

import type { SessionDto } from '../../shared/api-types';
import { cx } from '../lib/cx';
import { formatTime } from '../lib/format';
import { Avatar } from './Avatar';

/** Số avatar hiện tối đa; phần còn lại gộp thành "+X". */
const MAX_AVATARS = 8;

interface SessionCardProps {
  session: SessionDto;
  /** `true` = tham gia, `false` = huỷ tham gia. */
  onToggle: (going: boolean) => void;
  /** Đang chờ server trả lời: nút bị tắt và ghi "Đang xử lý…". */
  pending: boolean;
  /** Thông báo lỗi của lần bấm gần nhất (vd "Đã đủ người"), hiện ngay dưới nút. */
  error?: string | null;
}

const STATUS_BADGE: Record<Exclude<SessionDto['status'], 'scheduled'>, { text: string; className: string }> = {
  cancelled: { text: 'Đã huỷ', className: 'bg-duck/10 text-duck' },
  ended: { text: 'Đã kết thúc', className: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
};

export function SessionCard({ session, onToggle, pending, error }: SessionCardProps) {
  const taken = session.attendees.length;
  const full = taken >= session.capacity;
  const going = session.myStatus === 'going';
  const shown = session.attendees.slice(0, MAX_AVATARS);
  const overflow = taken - shown.length;

  return (
    <article
      aria-label={`${formatTime(session.startsAt)} ${session.modeName}`}
      className={cx('card flex flex-col gap-3', session.status === 'cancelled' && 'opacity-70')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <time dateTime={session.startsAt} className="text-2xl font-bold tabular-nums">
          {formatTime(session.startsAt)}
        </time>
        <span className="text-lg font-semibold">{session.modeName}</span>
        {session.status !== 'scheduled' && (
          <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_BADGE[session.status].className)}>
            {STATUS_BADGE[session.status].text}
          </span>
        )}
        <span className="ml-auto text-sm text-slate-600 dark:text-slate-400">
          <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {taken}/{session.capacity}
          </span>{' '}
          người
        </span>
      </div>

      {taken > 0 && (
        <ul aria-label="Người tham gia" className="flex flex-wrap items-center gap-1">
          {shown.map((attendee) => (
            <li key={attendee.memberId} className="flex">
              <Avatar name={attendee.displayName} url={attendee.avatarUrl} label={attendee.displayName} className="size-8 text-sm" />
            </li>
          ))}
          {overflow > 0 && (
            <li className="inline-flex size-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              +{overflow}
            </li>
          )}
        </ul>
      )}

      {session.note && <p className="text-sm text-slate-700 dark:text-slate-300">{session.note}</p>}

      {session.roomCode && <p className="text-sm font-medium">{`Mã phòng: ${session.roomCode}`}</p>}

      {session.status === 'scheduled' && (
        <div className="flex flex-col gap-1">
          <ToggleButton going={going} full={full} pending={pending} onToggle={onToggle} />
          {error && (
            <p role="alert" className="text-sm text-duck">
              {error}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

interface ToggleButtonProps {
  going: boolean;
  full: boolean;
  pending: boolean;
  onToggle: (going: boolean) => void;
}

function ToggleButton({ going, full, pending, onToggle }: ToggleButtonProps) {
  if (going) {
    return (
      <button type="button" className="btn-secondary w-full sm:w-auto sm:self-start" disabled={pending} onClick={() => onToggle(false)}>
        {pending ? 'Đang xử lý…' : 'Huỷ tham gia'}
      </button>
    );
  }
  if (full) {
    return (
      <button type="button" className="btn-primary w-full sm:w-auto sm:self-start" disabled>
        Đã đủ người
      </button>
    );
  }
  return (
    <button type="button" className="btn-primary w-full sm:w-auto sm:self-start" disabled={pending} onClick={() => onToggle(true)}>
      {pending ? 'Đang xử lý…' : 'Tham gia'}
    </button>
  );
}
