/**
 * Trang Hôm nay: nhãn ngày, số người tham gia (đếm người khác nhau trên các buổi
 * chưa huỷ), các buổi chơi theo giờ với nút Tham gia / Huỷ tham gia, rồi Sảnh tri
 * ân hôm nay. "Hôm nay" là của server (ngày VN): hai API đều gọi không kèm `date`.
 *
 * Điểm danh: không cập nhật lạc quan — sức chứa do server quyết — mà thay đúng
 * buổi đó trong cache bằng DTO trả về; lỗi thì hiện thông báo ngay dưới thẻ và tải
 * lại danh sách để thẻ phản ánh trạng thái thật (đã đủ người, đã huỷ…).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HallOfDayDto, SessionDto } from '../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../api';
import { DailyHall } from '../components/DailyHall';
import { QueryState } from '../components/QueryState';
import { SessionCard } from '../components/SessionCard';
import { formatDayLabel } from '../lib/format';

export const SESSIONS_TODAY_KEY = ['sessions', 'today'] as const;
export const HALL_TODAY_KEY = ['mvp', 'day', 'today'] as const;

export function TodayPage() {
  const sessions = useQuery({ queryKey: SESSIONS_TODAY_KEY, queryFn: () => apiGet<SessionDto[]>('/api/sessions') });
  const hall = useQuery({ queryKey: HALL_TODAY_KEY, queryFn: () => apiGet<HallOfDayDto>('/api/mvp/day') });

  // Ngày của server khi đã có; trước đó tạm dùng giờ máy (chỉ lệch khi đồng hồ máy sai quanh nửa đêm).
  const dayLabel = formatDayLabel(hall.data?.date ?? new Date());
  const attendeeCount = sessions.data ? countDistinctAttendees(sessions.data) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{dayLabel}</h1>
        {attendeeCount !== null && (
          <p className="text-slate-600 dark:text-slate-400">{attendeeCount} người tham gia hôm nay</p>
        )}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Buổi chơi hôm nay</h2>
        <QueryState query={sessions}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400">Hôm nay chưa có buổi chơi nào</p>
            ) : (
              <div className="flex flex-col gap-3">
                {sortByStart(list).map((session) => (
                  <TodaySession key={session.id} session={session} />
                ))}
              </div>
            )
          }
        </QueryState>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sảnh tri ân hôm nay</h2>
        <QueryState query={hall}>{(data) => <DailyHall data={data} emptyMessage="Chưa có kết quả vote hôm nay" />}</QueryState>
      </section>
    </div>
  );
}

/** Một thẻ buổi chơi kèm mutation điểm danh riêng, nên `pending`/lỗi là của đúng thẻ đó. */
function TodaySession({ session }: { session: SessionDto }) {
  const queryClient = useQueryClient();
  const attendance = useMutation({
    mutationFn: (going: boolean) => apiSend<SessionDto>('POST', `/api/sessions/${session.id}/attendance`, { going }),
    onSuccess: (updated) => {
      queryClient.setQueryData<SessionDto[]>(SESSIONS_TODAY_KEY, (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)),
      );
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: SESSIONS_TODAY_KEY }),
  });

  return (
    <SessionCard
      session={session}
      pending={attendance.isPending}
      error={attendance.isError ? errorMessage(attendance.error) : null}
      onToggle={(going) => attendance.mutate(going)}
    />
  );
}

function sortByStart(list: SessionDto[]): SessionDto[] {
  return [...list].sort((x, y) => x.startsAt.localeCompare(y.startsAt));
}

/** Số người khác nhau đang tham gia các buổi chưa huỷ (một người đi hai buổi đếm một). */
function countDistinctAttendees(list: SessionDto[]): number {
  const ids = new Set<number>();
  for (const session of list) {
    if (session.status === 'cancelled') continue;
    for (const attendee of session.attendees) ids.add(attendee.memberId);
  }
  return ids.size;
}
