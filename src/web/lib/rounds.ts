/**
 * Phần dùng chung của ván đấu trên web (spec ván §4, §5): truy vấn ván của một buổi, chữ phe thắng,
 * đường dẫn trang buổi, nhãn "Buổi {giờ} {dd/mm} · Ván {n}" và các khoá điểm cần làm mới khi phe
 * thắng của một ván đổi (điểm tính lại lúc đọc). Trang buổi, trang Khai điểm và tab Duyệt điểm
 * cùng đọc từ đây để chữ khớp nhau.
 */

import { queryOptions } from '@tanstack/react-query';
import type { Faction, SessionRoundsDto } from '../../shared/api-types';
import { isRoundSeason } from '../../shared/rounds';
import { apiGet } from '../api';
import { addDaysIso, formatDayMonth, formatTime, vnTodayIso } from './format';
import { APPROVED_REPORTS_KEY, LEADERBOARD_TOTALS_KEY, MY_REPORTS_KEY, PENDING_REPORTS_KEY, TITLES_QUERY_KEY } from './queryKeys';

/** Tiền tố khoá ván của từng buổi (`['session-rounds', id]`). */
export const SESSION_ROUNDS_KEY = ['session-rounds'] as const;

/** Buổi và các ván của nó kèm lần khai công khai — trang buổi, trang Khai điểm, "Lần khai của tôi". */
export const sessionRoundsQuery = (sessionId: number) =>
  queryOptions({ queryKey: [...SESSION_ROUNDS_KEY, sessionId] as const, queryFn: () => apiGet<SessionRoundsDto>(`/api/sessions/${sessionId}/rounds`) });

/**
 * Cache điểm làm mới khi phe thắng / người thắng của một ván đổi (điểm mọi lần khai của ván tính lại):
 * các bảng điểm mùa, Đại sảnh, trang thành viên, danh hiệu, lần khai của mình và hai danh sách Duyệt điểm.
 */
export const ROUND_SCORE_QUERY_KEYS = [
  ['leaderboard'],
  ['leaderboard-factions'],
  LEADERBOARD_TOTALS_KEY,
  ['hall'],
  ['member'],
  TITLES_QUERY_KEY,
  MY_REPORTS_KEY,
  PENDING_REPORTS_KEY,
  APPROVED_REPORTS_KEY,
] as const;

/** Chip phe thắng dưới ảnh ván (spec ván §5). */
export function winnerText(faction: Faction | null): string {
  switch (faction) {
    case 'goose':
      return '🦢 Ngỗng thắng';
    case 'duck':
      return '🦆 Vịt thắng';
    case 'neutral':
      return 'Phe thứ 3 thắng';
    case null:
      return 'Chưa chọn phe thắng';
  }
}

/** Màu chip phe thắng: nền `-strong`/`third` cho chữ trắng; chưa chọn → chip xám mặc định. */
export const WINNER_CHIP_CLASS: Record<Faction | 'none', string> = {
  goose: 'bg-goose-strong',
  duck: 'bg-duck-strong',
  neutral: 'bg-third',
  none: '',
};

/** Neo của một ván trên trang buổi (`#van-{n}`). */
export function roundAnchor(number: number): string {
  return `van-${number}`;
}

/** Trang buổi `/buoi/:id`, có `number` thì nhảy tới ván đó. */
export function sessionPath(sessionId: number, number?: number): string {
  return number === undefined ? `/buoi/${sessionId}` : `/buoi/${sessionId}#${roundAnchor(number)}`;
}

/**
 * Ảnh của một ván không kèm `?v=` — dùng khi chỉ có id ván (lần khai trong Duyệt điểm). Ảnh vừa đổi
 * có thể còn bản cũ trong cache trình duyệt tối đa 5 phút (`max-age=300`).
 */
export function roundImagePath(roundId: number): string {
  return `/api/rounds/${roundId}/image`;
}

/** Ngày VN `YYYY-MM-DD` của giờ bắt đầu một buổi. */
export function sessionVnDate(startsAt: string): string {
  return vnTodayIso(new Date(startsAt));
}

/** "Buổi {HH:mm} {dd/mm}" của một buổi (giờ, ngày VN). */
export function sessionShortLabel(startsAt: string): string {
  return `Buổi ${formatTime(startsAt)} ${formatDayMonth(sessionVnDate(startsAt))}`;
}

/**
 * Nhãn lần khai theo ván ở "Lần khai của tôi": "Buổi {HH:mm} {dd/mm} · Ván {n}". Chưa biết giờ buổi
 * (đang tải) thì "Buổi {dd/mm} · Ván {n}" theo ngày chơi (= ngày VN của buổi).
 */
export function roundReportLabel(number: number, playedOn: string, startsAt: string | undefined): string {
  const session = startsAt === undefined ? `Buổi ${formatDayMonth(playedOn)}` : sessionShortLabel(startsAt);
  return `${session} · Ván ${number}`;
}

/** Số ngày lùi tối đa của cửa sổ khai (khớp server). */
export const ROUND_WINDOW_DAYS = 3;

/**
 * Buổi còn nhận khai theo ván không (web chỉ để ẩn nút; server kiểm tra lại): không bị huỷ, ngày VN
 * trong [hôm nay − 3, hôm nay], và mùa của ngày đó dùng luật ván.
 */
export function sessionTakesRoundReports(session: { startsAt: string; status: string }, now: Date = new Date()): boolean {
  if (session.status === 'cancelled') return false;
  const day = sessionVnDate(session.startsAt);
  const today = vnTodayIso(now);
  return day >= addDaysIso(today, -ROUND_WINDOW_DAYS) && day <= today && isRoundSeason(day.slice(0, 7));
}
