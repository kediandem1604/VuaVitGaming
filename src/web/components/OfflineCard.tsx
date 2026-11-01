/**
 * Thẻ "🎉 Offline: {tên}" trên trang Hôm nay (spec offline): `{Thứ}, {dd/mm} lúc {HH:mm}` · `📍 {địa
 * điểm}` · mô tả; hai nút "Mình đi được" / "Không đi được" (`aria-pressed`, nút đã chọn nền vàng; bấm
 * nút kia để đổi); "{n} người đi được" + hàng avatar (tối đa `AVATAR_MAX`, thừa thì "+k"). Bấm số mở
 * hộp thoại liệt kê tên cả hai nhóm. Hết hạn vote hoặc đã đóng (`open = false`) → ẩn nút, ghi "Đã
 * chốt danh sách".
 *
 * Thẻ không tự gọi API: trang cha truyền `onVote`, trạng thái đang gửi và lỗi của lần bấm gần nhất.
 * `applyMyVote` dựng bản lạc quan của thẻ (trang cha dùng cho cache trước khi server trả lời).
 */

import { useId, useState } from 'react';
import type { MeDto, OfflineEventDto, OfflinePersonDto } from '../../shared/api-types';
import { cx } from '../lib/cx';
import { formatDayTimeLabel } from '../lib/format';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { Presence } from './Presence';

/** Số avatar tối đa trên hàng người đi được. */
export const AVATAR_MAX = 12;

/** Thẻ theo ý vừa bấm: bỏ mình khỏi cả hai nhóm, thêm vào cuối nhóm vừa chọn. Chỉ dùng cho cache lạc quan. */
export function applyMyVote(event: OfflineEventDto, me: Pick<MeDto, 'id' | 'displayName' | 'avatarUrl'>, going: boolean): OfflineEventDto {
  const self: OfflinePersonDto = { memberId: me.id, displayName: me.displayName, avatarUrl: me.avatarUrl };
  const without = (list: OfflinePersonDto[]) => list.filter((p) => p.memberId !== me.id);
  return {
    ...event,
    going: going ? [...without(event.going), self] : without(event.going),
    notGoing: going ? without(event.notGoing) : [...without(event.notGoing), self],
    myVote: going,
  };
}

interface OfflineCardProps {
  event: OfflineEventDto;
  onVote: (going: boolean) => void;
  /** Đang chờ server trả lời (nút vẫn bấm được — đổi ý lần nữa cũng chỉ là một lần vote mới). */
  pending: boolean;
  error: string | null;
  className?: string;
}

const CHOICE_CLASS = 'btn-secondary';
const CHOSEN_CLASS = 'btn-primary';

export function OfflineCard({ event, onVote, pending, error, className }: OfflineCardProps) {
  const headingId = useId();
  const dialogTitleId = useId();
  const [listOpen, setListOpen] = useState(false);
  const shown = event.going.slice(0, AVATAR_MAX);
  const extra = event.going.length - shown.length;

  return (
    <section aria-labelledby={headingId} aria-busy={pending || undefined} className={cx('panel flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-xl leading-tight font-extrabold break-words text-white">
          {`🎉 Offline: ${event.title}`}
        </h2>
        <p className="font-bold text-gold tabular-nums">{formatDayTimeLabel(event.startsAt)}</p>
        <p className="break-words text-night-200">{`📍 ${event.place}`}</p>
        {event.description && <p className="text-sm break-words whitespace-pre-line text-night-300">{event.description}</p>}
      </div>

      {event.open ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={event.myVote === true} className={event.myVote === true ? CHOSEN_CLASS : CHOICE_CLASS} onClick={() => event.myVote !== true && onVote(true)}>
            Mình đi được
          </button>
          <button type="button" aria-pressed={event.myVote === false} className={event.myVote === false ? CHOSEN_CLASS : CHOICE_CLASS} onClick={() => event.myVote !== false && onVote(false)}>
            Không đi được
          </button>
        </div>
      ) : (
        <p className="text-sm font-bold text-night-200">Đã chốt danh sách</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          className="text-left font-bold text-white underline decoration-night-500 underline-offset-4 hover:decoration-gold"
          aria-haspopup="dialog"
          onClick={() => setListOpen(true)}
        >
          {`${event.going.length} người đi được`}
        </button>
        {shown.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center -space-x-2">
            {shown.map((p) => (
              <Avatar key={p.memberId} name={p.displayName} url={p.avatarUrl} label={p.displayName} className="size-8 text-sm" />
            ))}
            {extra > 0 && (
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-night-950 bg-night-700 text-xs font-bold text-white tabular-nums">
                {`+${extra}`}
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm font-bold text-duck-soft">
          {error}
        </p>
      )}

      <Presence present={listOpen}>
        <Modal titleId={dialogTitleId} onClose={() => setListOpen(false)}>
          <h2 id={dialogTitleId} className="text-xl leading-tight font-extrabold break-words text-white">
            {event.title}
          </h2>
          <PeopleList title={`Đi được (${event.going.length})`} people={event.going} />
          <PeopleList title={`Không đi được (${event.notGoing.length})`} people={event.notGoing} />
          <button type="button" className="btn-secondary self-end" onClick={() => setListOpen(false)}>
            Đóng
          </button>
        </Modal>
      </Presence>
    </section>
  );
}

function PeopleList({ title, people }: { title: string; people: OfflinePersonDto[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-night-200">{title}</h3>
      {people.length === 0 ? (
        <p className="text-sm text-night-300">Chưa có ai</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {people.map((p) => (
            <li key={p.memberId} className="flex min-w-0 items-center gap-2">
              <Avatar name={p.displayName} url={p.avatarUrl} className="size-7 text-xs" />
              <span className="min-w-0 break-words text-white">{p.displayName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
