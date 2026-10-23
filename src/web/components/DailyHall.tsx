/**
 * Sảnh tri ân một ngày: mỗi buổi đã đóng vote là một khối (nhãn `{chế độ} {HH:mm}`),
 * trong đó mỗi hạng mục liệt kê người thắng (hoà thì tất cả) kèm số phiếu, hoặc
 * "Không ai được vote". Dùng chung cho trang Hôm nay và trang Tri ân.
 */

import type { HallAwardDto, HallOfDayDto } from '../../shared/api-types';
import { Avatar } from './Avatar';

interface DailyHallProps {
  data: HallOfDayDto;
  /** Câu hiện khi ngày đó chưa có buổi nào đóng vote. */
  emptyMessage?: string;
}

export function DailyHall({ data, emptyMessage = 'Chưa có kết quả vote' }: DailyHallProps) {
  if (data.sessions.length === 0) {
    return <p className="text-slate-600 dark:text-slate-400">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {data.sessions.map((session) => (
        <section key={session.sessionId} className="card flex flex-col gap-3">
          <h3 className="text-lg font-semibold">{session.label}</h3>
          <ul className="flex flex-col gap-3">
            {/* Thứ tự hạng mục do server cố định; tên hạng mục do admin đặt nên không chắc duy nhất. */}
            {session.awards.map((award, index) => (
              <li key={index} className="flex flex-col gap-1.5">
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
      <p className="text-sm font-semibold text-third">{award.categoryName}</p>
      {award.winners.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Không ai được vote</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {award.winners.map((winner) => (
            <li key={winner.memberId} className="flex items-center gap-2">
              <Avatar name={winner.displayName} url={winner.avatarUrl} label={winner.displayName} className="size-8 text-sm" />
              <span className="min-w-0 flex-1 truncate font-medium">{winner.displayName}</span>
              <span className="shrink-0 text-sm text-slate-600 tabular-nums dark:text-slate-400">{winner.voteCount} phiếu</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
