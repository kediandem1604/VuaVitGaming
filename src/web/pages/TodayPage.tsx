/**
 * Trang Hôm nay: nhãn ngày (chữ nổi), số người tham gia (đếm người khác nhau trên các buổi
 * chưa huỷ), các buổi chơi theo giờ vẽ như phòng chờ (`SessionCard`, hai cột từ `lg`),
 * rồi Sảnh tri ân hôm nay (trống thì Sảnh tri ân gần nhất — xem `HallSection`). "Hôm nay"
 * là của server (ngày VN): hai API đều gọi không kèm `date`.
 *
 * Dòng nhắc giờ trên mỗi thẻ lấy kênh nhắc từ hồ sơ người đang đăng nhập (`useCurrentMember`).
 *
 * Treo thưởng (spec treo thưởng §6): buổi chưa huỷ có mục áp dụng (hoặc mình đã có lần nhận) thì thẻ
 * "Treo thưởng" (`BountyCard`) đứng ngay sau thẻ buổi trong cùng lưới — từ `lg` thẻ buổi ép về cột
 * trái (`lg:col-start-1`) và thẻ treo thưởng nằm cột phải, màn nhỏ thì xếp dưới. Buổi không có mục
 * thì không vẽ thẻ, các thẻ buổi xếp hai cột như cũ. Hỏi treo thưởng lỗi thì lặng lẽ không vẽ thẻ
 * (phần phụ, không chắn trang). Nhận xong: chèn lần nhận vào cache của thẻ, làm mới hàng chờ duyệt
 * và "Treo thưởng của tôi"; lỗi thì hiện dưới mục đó và tải lại thẻ. Điểm danh xong cũng tải lại thẻ
 * (`attended` đổi).
 *
 * Điểm danh: cập nhật lạc quan (ghế đổi ngay khi bấm, xem `TodaySession`), rồi thay đúng
 * buổi đó trong cache bằng DTO trả về; lỗi thì trả lại như cũ, hiện thông báo ngay dưới thẻ
 * và tải lại danh sách để thẻ phản ánh trạng thái thật (đã đủ người, đã huỷ…).
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import type { BountyClaimDto, HallOfDayDto, MeDto, SessionBountiesDto, SessionDto } from '../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../api';
import { BountyCard, hasBountyRows } from '../components/BountyCard';
import { DailyHall } from '../components/DailyHall';
import { EmptyState } from '../components/EmptyState';
import { QueryState } from '../components/QueryState';
import { SessionCard } from '../components/SessionCard';
import { SkeletonCards } from '../components/Skeleton';
import { useCurrentMember } from '../hooks/useMe';
import { formatDayLabel, formatDayMonth } from '../lib/format';
import { mvpDatesQuery, sessionBountiesQuery } from '../lib/queries';
import { MY_BOUNTY_CLAIMS_KEY, PENDING_BOUNTY_CLAIMS_KEY } from '../lib/queryKeys';
import { reminderChannels, type ReminderChannels } from '../lib/reminders';

export const SESSIONS_TODAY_KEY = ['sessions', 'today'] as const;
export const HALL_TODAY_KEY = ['mvp', 'day', 'today'] as const;
/** Cùng khoá với trang Tri ân: dùng chung cache. */

export function TodayPage() {
  const sessions = useQuery({ queryKey: SESSIONS_TODAY_KEY, queryFn: () => apiGet<SessionDto[]>('/api/sessions') });
  const hall = useQuery({ queryKey: HALL_TODAY_KEY, queryFn: () => apiGet<HallOfDayDto>('/api/mvp/day') });
  const reminders = reminderChannels(useCurrentMember());

  // Ngày của server khi đã có; trước đó tạm dùng giờ máy (chỉ lệch khi đồng hồ máy sai quanh nửa đêm).
  const dayLabel = formatDayLabel(hall.data?.date ?? new Date());
  const attendeeCount = sessions.data ? countDistinctAttendees(sessions.data) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
        <h1 className="text-raised text-3xl leading-none font-extrabold text-white">{dayLabel}</h1>
        {attendeeCount !== null && (
          <p className="flex items-center gap-1.5 text-night-300">
            <Users aria-hidden="true" className="size-4 shrink-0" />
            {`${attendeeCount} người tham gia hôm nay`}
          </p>
        )}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl leading-tight font-extrabold text-white">Buổi chơi hôm nay</h2>
        <QueryState query={sessions} skeleton={<SkeletonCards count={2} className="grid-cols-1 sm:grid-cols-1 lg:grid-cols-2" />}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>
                <p>Hôm nay chưa có buổi chơi nào</p>
              </EmptyState>
            ) : (
              // Hai cột từ `lg`; `items-start` để thẻ ngắn (đã huỷ) không bị kéo cao bằng thẻ bên cạnh.
              // Mỗi buổi một hàng: thẻ buổi luôn ở cột 1, thẻ treo thưởng (nếu có) ở cột 2 ngay cạnh
              // (xem `TodaySession`) — tự xếp chỗ sẽ để lại ô trống khi chỉ vài buổi có treo thưởng.
              <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                {sortByStart(list).map((session) => (
                  <TodaySession key={session.id} session={session} reminders={reminders} />
                ))}
              </div>
            )
          }
        </QueryState>
      </section>

      <HallSection hall={hall} />
    </div>
  );
}

/**
 * Sảnh tri ân hôm nay; hôm nay chưa có kết quả thì hiện ngày gần nhất có kết quả
 * (`/api/mvp/dates`[0]) dưới tiêu đề "Sảnh tri ân gần nhất — dd/MM": vote buổi tối đóng
 * sáng hôm sau và được xếp vào ngày của buổi chơi, nên buổi sáng "hôm nay" thường trống.
 * Lịch sử chỉ được hỏi khi hôm nay trống; lỗi khi hỏi thì vẫn hiện sảnh hôm nay (trống).
 */
function HallSection({ hall }: { hall: UseQueryResult<HallOfDayDto> }) {
  const todayEmpty = hall.data !== undefined && hall.data.sessions.length === 0;
  const dates = useQuery({ ...mvpDatesQuery, enabled: todayEmpty });
  const latest = todayEmpty ? (dates.data?.find((date) => date !== hall.data?.date) ?? null) : null;
  const recent = useQuery({
    queryKey: ['mvp', 'day', latest],
    queryFn: () => apiGet<HallOfDayDto>(`/api/mvp/day?date=${latest}`),
    enabled: latest !== null,
  });

  if (latest !== null && recent.data && recent.data.sessions.length > 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-xl leading-tight font-extrabold text-white">Sảnh tri ân gần nhất — {formatDayMonth(latest)}</h2>
        <DailyHall data={recent.data} />
      </section>
    );
  }

  const lookingBack = todayEmpty && (dates.isPending || (latest !== null && recent.isPending));
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl leading-tight font-extrabold text-white">Sảnh tri ân hôm nay</h2>
      {lookingBack ? (
        <p className="text-night-300">Đang tải…</p>
      ) : (
        <QueryState query={hall}>{(data) => <DailyHall data={data} emptyMessage="Chưa có kết quả vote hôm nay" />}</QueryState>
      )}
    </section>
  );
}

/**
 * Ghế của mình trong một buổi, theo ý vừa bấm: Tham gia → thêm mình vào cuối hàng ghế (nếu chưa
 * có) và `myStatus = 'going'`; Huỷ → bỏ mình ra, `myStatus = null`. Chỉ dùng cho cache lạc quan.
 */
export function toggleMySeat(session: SessionDto, me: MeDto, going: boolean): SessionDto {
  const others = session.attendees.filter((attendee) => attendee.memberId !== me.id);
  const attendees = going ? [...others, { memberId: me.id, displayName: me.displayName, avatarUrl: me.avatarUrl }] : others;
  return { ...session, attendees, myStatus: going ? 'going' : null };
}

/**
 * Một thẻ buổi chơi kèm mutation điểm danh riêng, nên `pending`/lỗi là của đúng thẻ đó.
 *
 * Cập nhật lạc quan (spec §4.6): bấm là ghế đổi ngay trong cache (`onMutate`, sau khi huỷ các
 * lần tải danh sách đang chạy để chúng không đè lên); server trả về thì thay bằng DTO thật (sức
 * chứa, thứ tự ghế do server quyết); lỗi (đã đủ người, đã đóng…) thì trả lại bản chụp trước đó,
 * hiện lỗi dưới thẻ như cũ và tải lại danh sách để thẻ phản ánh trạng thái thật.
 */
function TodaySession({ session, reminders }: { session: SessionDto; reminders: ReminderChannels }) {
  const queryClient = useQueryClient();
  const me = useCurrentMember();
  const bountiesQuery = sessionBountiesQuery(session.id);
  // Buổi đã huỷ không nhận thưởng được nữa: không hỏi, không vẽ thẻ.
  const bounties = useQuery({ ...bountiesQuery, enabled: session.status !== 'cancelled' });
  const showBounties = session.status !== 'cancelled' && hasBountyRows(bounties.data);
  const claim = useMutation({
    mutationFn: (bountyId: number) => apiSend<BountyClaimDto>('POST', `/api/sessions/${session.id}/bounties/${bountyId}/claim`, {}),
    onSuccess: (created) => {
      queryClient.setQueryData<SessionBountiesDto>(bountiesQuery.queryKey, (current) =>
        current ? { ...current, myClaims: [...current.myClaims.filter((item) => item.bounty.id !== created.bounty.id), created] } : current,
      );
      void queryClient.invalidateQueries({ queryKey: PENDING_BOUNTY_CLAIMS_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_BOUNTY_CLAIMS_KEY });
    },
    // Đã nhận rồi (web/Discord), quá hạn, mục vừa tắt…: thẻ đang xem đã cũ.
    onError: () => void queryClient.invalidateQueries({ queryKey: bountiesQuery.queryKey }),
  });
  const attendance = useMutation({
    mutationFn: (going: boolean) => apiSend<SessionDto>('POST', `/api/sessions/${session.id}/attendance`, { going }),
    onMutate: async (going) => {
      await queryClient.cancelQueries({ queryKey: SESSIONS_TODAY_KEY });
      const previous = queryClient.getQueryData<SessionDto[]>(SESSIONS_TODAY_KEY);
      queryClient.setQueryData<SessionDto[]>(SESSIONS_TODAY_KEY, (current) =>
        current?.map((item) => (item.id === session.id ? toggleMySeat(item, me, going) : item)),
      );
      return { previous };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<SessionDto[]>(SESSIONS_TODAY_KEY, (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)),
      );
      // Tham gia/huỷ đổi `attended` của thẻ treo thưởng.
      void queryClient.invalidateQueries({ queryKey: bountiesQuery.queryKey });
    },
    onError: (_error, _going, context) => {
      if (context?.previous) queryClient.setQueryData(SESSIONS_TODAY_KEY, context.previous);
      void queryClient.invalidateQueries({ queryKey: SESSIONS_TODAY_KEY });
    },
  });

  return (
    <>
      <SessionCard
        session={session}
        pending={attendance.isPending}
        error={attendance.isError ? errorMessage(attendance.error) : null}
        onToggle={(going) => attendance.mutate(going)}
        reminders={reminders}
        // Luôn cột 1 (kể cả khi chưa tải xong treo thưởng) để thẻ không nhảy chỗ khi thẻ treo thưởng hiện ra.
        className="lg:col-start-1"
      />
      {showBounties && bounties.data && (
        <BountyCard
          data={bounties.data}
          session={session}
          className="lg:col-start-2"
          onClaim={(bountyId) => claim.mutate(bountyId)}
          claimingId={claim.isPending ? (claim.variables ?? null) : null}
          error={claim.isError && claim.variables !== undefined ? { bountyId: claim.variables, message: errorMessage(claim.error) } : null}
        />
      )}
    </>
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
