/**
 * Thẻ một danh hiệu đã trao (spec huy hiệu §9): panel với icon emoji lớn bên trái, tên danh
 * hiệu (chữ đóng băng lúc trao, đã kèm tháng với danh hiệu tháng), `detail`, rồi tuỳ trang:
 * avatar + tên người nhận là link tới trang thành viên (tường vinh danh), hoặc ngày trao
 * (trang thành viên — ở đó tên đã là tiêu đề trang). Dùng chung tường Huy hiệu, trang thành
 * viên và mục "Danh hiệu của tôi" ở Hồ sơ.
 */

import type { BadgeDto } from '../../shared/api-types';
import { cx } from '../lib/cx';
import { formatDateLabel } from '../lib/format';
import { memberPath } from '../lib/links';
import { Avatar } from './Avatar';
import { PrefetchLink } from './PrefetchLink';

interface BadgeCardProps {
  badge: BadgeDto;
  /** Hiện avatar + tên người nhận (link tới trang thành viên). */
  showMember?: boolean;
  /** Hiện ngày trao (giờ Việt Nam) — cho trang của một người, nơi không có tiêu đề tháng. */
  showDate?: boolean;
  className?: string;
}

export function BadgeCard({ badge, showMember = false, showDate = false, className }: BadgeCardProps) {
  return (
    <div className={cx('panel flex items-start gap-3 p-3', className)}>
      {/* Emoji chỉ trang trí: tên danh hiệu viết ngay bên cạnh. `w-10` giữ cột icon đều nhau giữa các thẻ. */}
      <span aria-hidden="true" className="w-10 shrink-0 pt-0.5 text-center text-3xl leading-none">
        {badge.icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Tên danh hiệu có thể dài ("Chiến thần phe Ngỗng tháng 10/2026"): xuống dòng, không tràn ở 320px. */}
        <p className="leading-tight font-extrabold break-words text-white">{badge.title}</p>
        <p className="text-sm leading-tight break-words text-night-300">{badge.detail}</p>
        {showMember && (
          // Link bọc cả avatar: avatar không nhãn nên tên link vẫn chỉ là tên người.
          <PrefetchLink to={memberPath(badge.member.id)} className="mt-1 flex max-w-full items-center gap-2 self-start rounded-full">
            <Avatar name={badge.member.displayName} url={badge.member.avatarUrl} className="size-7 text-xs" />
            <span className="min-w-0 truncate font-bold text-gold hover:underline">{badge.member.displayName}</span>
          </PrefetchLink>
        )}
        {showDate && (
          <p className="text-xs text-night-300">
            Trao ngày <time dateTime={badge.awardedAt}>{formatDateLabel(new Date(badge.awardedAt))}</time>
          </p>
        )}
      </div>
    </div>
  );
}
