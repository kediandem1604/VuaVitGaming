/**
 * Sảnh tri ân một ngày (spec §6): mỗi buổi đã đóng vote là một panel tiêu đề vàng
 * (nhãn `{chế độ} {HH:mm}`), trong đó mỗi hạng mục là một dòng `panel-inset` có icon cúp,
 * tên hạng mục, rồi người thắng (avatar + tên vàng; hoà thì tất cả) kèm số phiếu, hoặc
 * "Không ai được vote". Dùng chung cho trang Hôm nay và trang Tri ân.
 */

import { Trophy } from 'lucide-react';
import type { HallAwardDto, HallOfDayDto } from '../../shared/api-types';
import { Avatar } from './Avatar';
import { EmptyState } from './EmptyState';

interface DailyHallProps {
  data: HallOfDayDto;
  /** Câu hiện khi ngày đó chưa có buổi nào đóng vote. */
  emptyMessage?: string;
}

export function DailyHall({ data, emptyMessage = 'Chưa có kết quả vote' }: DailyHallProps) {
  if (data.sessions.length === 0) {
    return (
      <EmptyState>
        <p>{emptyMessage}</p>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data.sessions.map((session) => (
        <section key={session.sessionId} className="panel flex flex-col gap-3">
          {/* Tiêu đề 20px ≥ 18px nên dùng được chữ nổi `text-raised`. */}
          <h3 className="text-raised text-xl leading-tight font-extrabold text-gold">{session.label}</h3>
          <ul className="flex flex-col gap-2">
            {/* Thứ tự hạng mục do server cố định; tên hạng mục do admin đặt nên không chắc duy nhất. */}
            {session.awards.map((award, index) => (
              <li key={index} className="panel-inset flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <Award award={award} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Award({ award }: { award: HallAwardDto }) {
  return (
    <>
      <p className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-night-200">
        <Trophy aria-hidden="true" className="size-4 shrink-0 text-gold" />
        <span>{award.categoryName}</span>
      </p>
      {award.winners.length === 0 ? (
        <p className="text-sm text-night-300">Không ai được vote</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {award.winners.map((winner) => (
            <li key={winner.memberId} className="flex min-w-0 items-center gap-2">
              <Avatar name={winner.displayName} url={winner.avatarUrl} label={winner.displayName} className="size-8 text-sm" />
              <span className="min-w-0 flex-1 truncate font-bold text-gold">{winner.displayName}</span>
              <span className="shrink-0 text-sm text-night-300 tabular-nums">{winner.voteCount} phiếu</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
