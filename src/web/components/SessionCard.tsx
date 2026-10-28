/**
 * Một buổi chơi trên trang Hôm nay, vẽ như phòng chờ của game (spec §6 "Hôm nay"): giờ VN
 * lớn chữ nổi, tên chế độ, chip đếm ngược (tính ở trình duyệt từ `startsAt`, nhảy mỗi
 * phút; qua giờ là "Đang chơi"), chip mã phòng màu vàng nếu có, ghi chú; **hàng ghế** một
 * ô tròn cho mỗi chỗ (ô có người là avatar, ô trống viền nét đứt) với dòng
 * "8/12 ghế đã có người"; nút Tham gia / Huỷ tham gia to hết chiều ngang và dòng nhắc giờ.
 *
 * Dòng nhắc giờ nói đúng kênh của người đang xem (`reminders`, lấy từ hồ sơ — xem
 * `lib/reminders.ts`), không ghi số phút vì đó là cài đặt của admin; tắt hết thì mời sang
 * Hồ sơ để bật lại. Dòng này ẩn khi buổi đã tới giờ ("Đang chơi"): lời nhắc đã gửi xong.
 *
 * Buổi đã huỷ / đã kết thúc: chip trạng thái, không nút, không đếm ngược; panel "mờ" bằng
 * cách tối nền và đổi chữ tiêu đề sang `night-300` — không dùng `opacity` vì nó kéo chip
 * trạng thái (trắng trên `duck-strong`) xuống dưới 4.5:1.
 *
 * Thẻ không tự gọi API: trang cha truyền `onToggle(going)`, `pending` và `error`.
 */

import { Bell, BellOff, KeyRound, Play, Timer } from 'lucide-react';
import type { SessionDto } from '../../shared/api-types';
import { useNow } from '../hooks/useNow';
import { cx } from '../lib/cx';
import { formatCountdown, formatTime } from '../lib/format';
import { reminderText, type ReminderChannels } from '../lib/reminders';
import { Avatar } from './Avatar';
import { PrefetchLink } from './PrefetchLink';

interface SessionCardProps {
  session: SessionDto;
  /** `true` = tham gia, `false` = huỷ tham gia. */
  onToggle: (going: boolean) => void;
  /** Đang chờ server trả lời: nút bị tắt và ghi "Đang xử lý…". */
  pending: boolean;
  /** Thông báo lỗi của lần bấm gần nhất (vd "Đã đủ người"), hiện ngay dưới nút. */
  error?: string | null;
  /** Kênh nhắc giờ của người đang xem (`reminderChannels(me)`), cho dòng nhắc dưới nút. */
  reminders: ReminderChannels;
}

const STATUS_CHIP: Record<Exclude<SessionDto['status'], 'scheduled'>, { text: string; className: string }> = {
  cancelled: { text: 'Đã huỷ', className: 'bg-duck-strong' },
  ended: { text: 'Đã kết thúc', className: '' },
};

export function SessionCard({ session, onToggle, pending, error, reminders }: SessionCardProps) {
  const taken = session.attendees.length;
  const full = taken >= session.capacity;
  const going = session.myStatus === 'going';
  const open = session.status === 'scheduled';
  // Một đồng hồ cho cả thẻ: chip đếm ngược và dòng nhắc giờ đổi cùng một lần vẽ khi tới giờ.
  const now = useNow();
  const countdown = formatCountdown(session.startsAt, now);
  const live = countdown === 'Đang chơi';

  return (
    <article
      aria-label={`${formatTime(session.startsAt)} ${session.modeName}`}
      className={cx('panel flex flex-col gap-3', !open && 'border-night-700 bg-night-800/60')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Giờ 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
        <time
          dateTime={session.startsAt}
          className={cx('text-raised text-3xl leading-none font-extrabold tabular-nums', open ? 'text-gold' : 'text-night-300')}
        >
          {formatTime(session.startsAt)}
        </time>
        <span className={cx('text-lg leading-tight font-bold', open ? 'text-white' : 'text-night-300')}>{session.modeName}</span>
        <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
          {session.status === 'scheduled' ? (
            <CountdownChip text={countdown} live={live} />
          ) : (
            <span className={cx('chip', STATUS_CHIP[session.status].className)}>{STATUS_CHIP[session.status].text}</span>
          )}
          {session.roomCode && (
            <span className="chip bg-gold text-gold-ink">
              <KeyRound aria-hidden="true" className="size-4 shrink-0" />
              {`Mã phòng: ${session.roomCode}`}
            </span>
          )}
        </div>
      </div>

      {session.note && <p className="text-sm text-night-200">{session.note}</p>}

      <SeatRow session={session} />

      {open && (
        <div className="flex flex-col gap-1.5">
          <ToggleButton going={going} full={full} pending={pending} onToggle={onToggle} />
          {error && (
            <p role="alert" className="text-sm font-bold text-duck-soft">
              {error}
            </p>
          )}
          {!live && <ReminderLine channels={reminders} />}
        </div>
      )}
    </article>
  );
}

/** Chip đếm ngược: xanh `ok` khi còn chờ (có đồng hồ), nền xanh khi đã tới giờ ("Đang chơi"). */
function CountdownChip({ text, live }: { text: string; live: boolean }) {
  return (
    <span className={cx('chip', live ? 'bg-ok text-night-950' : 'text-ok')}>
      {live ? <Play aria-hidden="true" className="size-4 shrink-0" /> : <Timer aria-hidden="true" className="size-4 shrink-0" />}
      {text}
    </span>
  );
}

/**
 * Dòng nhắc giờ 14px dưới nút: kênh nhắc của người đang xem, hoặc — khi đã tắt cả hai — lời
 * mời sang Hồ sơ bật lại (link gạch chân vàng: không chỉ khác chữ quanh nó bằng màu).
 */
function ReminderLine({ channels }: { channels: ReminderChannels }) {
  const text = reminderText(channels);
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-1 text-center text-sm text-night-300">
      {text ? (
        <>
          <Bell aria-hidden="true" className="size-4 shrink-0" />
          {text}
        </>
      ) : (
        <>
          <BellOff aria-hidden="true" className="size-4 shrink-0" />
          <span>
            Bạn đã tắt nhắc giờ — đổi ở{' '}
            <PrefetchLink to="/ho-so" className="font-bold text-gold underline underline-offset-2">
              Hồ sơ
            </PrefetchLink>
          </span>
        </>
      )}
    </p>
  );
}

/**
 * Hàng ghế: `max(capacity, attendees)` ô 32px, tự xuống dòng ở màn hình hẹp (6 ô một hàng
 * ở 320px). Ghế có người là `Avatar` mang tên người đó; ghế trống là ô viền nét đứt
 * `night-600` (3.3:1 trên `night-800`) có nhãn "Ghế trống". Server chặn `capacity` ở 25,
 * nhưng nếu có nhiều người hơn ghế thì vẫn vẽ đủ người (và dòng đếm hiện "5/3").
 */
function SeatRow({ session }: { session: SessionDto }) {
  const taken = session.attendees.length;
  const seats = Math.max(session.capacity, taken);
  const empty = Array.from({ length: seats - taken }, (_, i) => i);

  return (
    <div className="flex flex-col gap-1.5">
      <ul aria-label="Hàng ghế" className="flex flex-wrap gap-1.5">
        {session.attendees.map((attendee) => (
          <li key={attendee.memberId} className="flex">
            <Avatar name={attendee.displayName} url={attendee.avatarUrl} label={attendee.displayName} className="size-8 text-sm" />
          </li>
        ))}
        {empty.map((i) => (
          <li key={`empty-${i}`} aria-label="Ghế trống" className="size-8 rounded-full border-2 border-dashed border-night-600" />
        ))}
      </ul>
      <p className="text-sm text-night-300 tabular-nums">{`${taken}/${session.capacity} ghế đã có người`}</p>
    </div>
  );
}

interface ToggleButtonProps {
  going: boolean;
  full: boolean;
  pending: boolean;
  onToggle: (going: boolean) => void;
}

/** Nút to hết chiều ngang (spec §6): Tham gia vàng, Huỷ tham gia `btn-secondary`, đủ người thì nút tắt. */
function ToggleButton({ going, full, pending, onToggle }: ToggleButtonProps) {
  if (going) {
    return (
      <button type="button" className="btn-secondary w-full py-3 text-lg" disabled={pending} onClick={() => onToggle(false)}>
        {pending ? 'Đang xử lý…' : 'Huỷ tham gia'}
      </button>
    );
  }
  if (full) {
    return (
      <button type="button" className="btn-primary w-full py-3 text-lg" disabled>
        Đã đủ người
      </button>
    );
  }
  return (
    <button type="button" className="btn-primary w-full py-3 text-lg" disabled={pending} onClick={() => onToggle(true)}>
      {pending ? 'Đang xử lý…' : 'Tham gia'}
    </button>
  );
}
