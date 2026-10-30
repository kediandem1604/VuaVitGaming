/**
 * Ngày chơi và buổi mặc định khi khai điểm / gửi báo cáo người chơi (spec ngày chơi mặc định §A) —
 * dùng chung cho web (chọn sẵn trong form) và bot (`/baocao` không nhập `ngay`).
 *
 * Ngày chơi mặc định = ngày VN của (bây giờ − 6 giờ): từ 00:00 đến 05:59 giờ VN vẫn là ngày hôm
 * trước (trận khuya), từ 06:00 là hôm nay. Giờ VN = UTC+7 cố định nên chỉ cần cộng/trừ trên epoch
 * (không phụ thuộc múi giờ của máy chạy). File này không import gì của server.
 */

const HOUR_MS = 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * HOUR_MS;

/** Giờ VN mà "ngày chơi" mặc định chuyển sang hôm nay. */
export const REPORT_DAY_START_HOUR = 6;

/** Ngày VN `YYYY-MM-DD` của một mốc thời gian. */
function vnDateOf(d: Date): string {
  const t = new Date(d.getTime() + VN_OFFSET_MS);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Ngày chơi mặc định (`YYYY-MM-DD`, giờ VN) lúc `now`: ngày VN của `now − 6 giờ`. */
export function defaultPlayedOn(now: Date): string {
  return vnDateOf(new Date(now.getTime() - REPORT_DAY_START_HOUR * HOUR_MS));
}

/** Phần buổi chơi mà `pickDefaultSession` cần; `startsAt` ISO 8601 hoặc `Date`. */
export interface SessionLike {
  startsAt: string | Date;
  status: string;
}

/**
 * Buổi mặc định trong `sessions` cho ngày `playedOn` (mặc định `defaultPlayedOn(now)`): trong các buổi
 * không bị huỷ bắt đầu đúng ngày VN đó, buổi có giờ bắt đầu muộn nhất mà đã bắt đầu (≤ `now`); chưa
 * buổi nào bắt đầu → buổi sớm nhất của ngày; không có buổi → `null`. Thứ tự đầu vào không quan trọng.
 */
export function pickDefaultSession<T extends SessionLike>(sessions: readonly T[], now: Date, playedOn: string = defaultPlayedOn(now)): T | null {
  const sameDay = sessions
    .map((s) => ({ s, at: new Date(s.startsAt).getTime() }))
    .filter(({ s, at }) => s.status !== 'cancelled' && !Number.isNaN(at) && vnDateOf(new Date(at)) === playedOn)
    .sort((x, y) => x.at - y.at);
  if (sameDay.length === 0) return null;
  const started = sameDay.filter(({ at }) => at <= now.getTime());
  return (started.at(-1) ?? sameDay[0]!).s;
}
