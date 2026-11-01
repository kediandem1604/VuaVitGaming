/**
 * Tab Khai điểm từ mùa luật ván (spec ván §5 "Trang Khai điểm"): thay form khai theo ngày bằng danh
 * sách buổi trong 3 ngày gần đây (hôm nay lùi 3 ngày, giờ VN), mới nhất trước — buổi mặc định theo
 * mốc 6:00 (`pickDefaultSession`) đứng đầu. Chỉ các buổi đã bắt đầu (cộng buổi mặc định), không bị
 * huỷ, thuộc mùa luật ván. Mỗi buổi: các ván (ảnh nhỏ dẫn sang `/buoi/:id#van-{n}`, chip phe thắng,
 * "Đã khai: {role}" hoặc nút "Khai" mở form ngay dưới ván); buổi chưa có ván → "Buổi này chưa có ảnh
 * ván, chờ mod up".
 *
 * Danh sách buổi dùng cùng khoá `['sessions', 'date', ngày]` với ô Buổi chơi của form theo ngày.
 */

import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { RoleDto, RoundDto, SessionDto } from '../../shared/api-types';
import { pickDefaultSession } from '../../shared/report-day';
import { apiGet, errorMessage } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PrefetchLink } from '../components/PrefetchLink';
import { QueryState } from '../components/QueryState';
import { WinnerChip } from '../components/WinnerChip';
import { addDaysIso, vnTodayIso } from '../lib/format';
import { ROUND_WINDOW_DAYS, sessionPath, sessionRoundsQuery, sessionShortLabel, sessionTakesRoundReports } from '../lib/rounds';
import { HINT_CLASS } from './reportFields';
import { RoundReportForm } from './RoundReportForm';

/**
 * Buổi hiện trong danh sách, theo thứ tự: buổi mặc định trước, rồi các buổi đã bắt đầu mới nhất trước.
 * Bỏ buổi huỷ, buổi chưa tới giờ (trừ buổi mặc định) và buổi ngoài cửa sổ/mùa cũ.
 */
export function roundSessionsToShow(sessions: readonly SessionDto[], now: Date): SessionDto[] {
  const open = sessions.filter((session) => sessionTakesRoundReports(session, now));
  const preferred = pickDefaultSession(open, now);
  const started = open.filter((session) => session !== preferred && new Date(session.startsAt).getTime() <= now.getTime());
  started.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  return preferred ? [preferred, ...started] : started;
}

export function RoundSessions({ roles }: { roles: RoleDto[] }) {
  const now = new Date();
  const today = vnTodayIso(now);
  const days = Array.from({ length: ROUND_WINDOW_DAYS + 1 }, (_, i) => addDaysIso(today, -i));
  const lists = useQueries({
    queries: days.map((day) => ({ queryKey: ['sessions', 'date', day], queryFn: () => apiGet<SessionDto[]>(`/api/sessions?date=${day}`) })),
  });

  const failed = lists.find((list) => list.isError);
  if (failed) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="font-bold text-duck-soft">
          {errorMessage(failed.error)}
        </p>
        <button type="button" className="btn-secondary" onClick={() => lists.forEach((list) => void list.refetch())}>
          Thử lại
        </button>
      </div>
    );
  }
  if (lists.some((list) => list.data === undefined)) return <p className={HINT_CLASS}>Đang tải buổi chơi…</p>;

  const shown = roundSessionsToShow(
    lists.flatMap((list) => list.data ?? []),
    now,
  );
  if (shown.length === 0) {
    return (
      <EmptyState>
        <p>Chưa có buổi chơi nào trong 3 ngày gần đây</p>
      </EmptyState>
    );
  }
  return (
    <ul aria-label="Buổi chơi gần đây" className="flex flex-col gap-4">
      {shown.map((session) => (
        <li key={session.id}>
          <RoundSessionBlock session={session} roles={roles} />
        </li>
      ))}
    </ul>
  );
}

function RoundSessionBlock({ session, roles }: { session: SessionDto; roles: RoleDto[] }) {
  const rounds = useQuery(sessionRoundsQuery(session.id));
  const label = sessionShortLabel(session.startsAt);

  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-lg leading-tight font-extrabold text-white tabular-nums">{label}</h3>
        <span className="text-sm text-night-300">{session.modeName}</span>
        <PrefetchLink to={sessionPath(session.id)} className="ml-auto text-sm font-bold text-gold underline underline-offset-2">
          Xem buổi
        </PrefetchLink>
      </div>
      <QueryState query={rounds}>
        {(data) =>
          data.rounds.length === 0 ? (
            <p className={HINT_CLASS}>Buổi này chưa có ảnh ván, chờ mod up</p>
          ) : (
            <ul aria-label={`Các ván ${label}`} className="flex flex-col gap-2">
              {data.rounds.map((round) => (
                <RoundRow key={round.id} round={round} roles={roles} />
              ))}
            </ul>
          )
        }
      </QueryState>
    </section>
  );
}

/** Một ván trong danh sách: ảnh nhỏ (dẫn sang trang buổi), "Ván n", phe thắng, "Đã khai: …" hoặc nút "Khai". */
function RoundRow({ round, roles }: { round: RoundDto; roles: RoleDto[] }) {
  const [open, setOpen] = useState(false);
  const mine = round.reports.find((report) => report.mine !== null) ?? null;

  return (
    <li className="panel-inset flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <PrefetchLink to={sessionPath(round.sessionId, round.number)} aria-label={`Xem ván ${round.number}`} className="shrink-0 overflow-hidden rounded-lg border-2 border-night-700 hover:border-gold">
          <img src={round.imageUrl} alt="" loading="lazy" className="aspect-video w-20 object-cover" />
        </PrefetchLink>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="font-bold text-white">Ván {round.number}</span>
          <WinnerChip faction={round.winnerFaction} />
          {mine ? (
            <span className="text-sm break-words text-night-200">
              Đã khai:{' '}
              <span className="font-bold text-white">
                {mine.role.icon} {mine.role.nameVi}
              </span>
            </span>
          ) : (
            !open && (
              <button type="button" className="btn-primary" aria-label={`Khai ván ${round.number}`} onClick={() => setOpen(true)}>
                Khai
              </button>
            )
          )}
        </div>
      </div>
      {open && !mine && <RoundReportForm round={round} roles={roles} onDone={() => setOpen(false)} />}
    </li>
  );
}
