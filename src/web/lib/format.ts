/**
 * Mọi định dạng ngày giờ hiển thị trên web nằm ở đây, đều qua `Intl.DateTimeFormat`
 * với múi giờ Việt Nam — web không tự làm toán múi giờ (đó là việc của
 * `src/server/lib/time.ts`). Các trang danh sách không tự tính "hôm nay" để gửi lên
 * API: bỏ tham số `date` thì server trả về ngày hôm nay của Việt Nam. Chỉ ô chọn
 * ngày của form (giá trị mặc định, khoảng cho chọn) cần "hôm nay" phía client —
 * `vnTodayIso` lấy nó từ `Intl` (ruling R34b); server vẫn là nơi quyết định cuối.
 *
 * Chuỗi được lắp từ `formatToParts` thay vì lấy nguyên `format()`, để hình dạng
 * (`HH:mm`, `Thứ Năm, 22/10`, `22/10/2026`) không phụ thuộc dấu câu của từng engine.
 */

const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VN_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  // `hourCycle: 'h23'` (không phải `hour12: false`): một số engine in nửa đêm là "24:00".
  hourCycle: 'h23',
});

const dayFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VN_TIME_ZONE,
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VN_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function parts(format: Intl.DateTimeFormat, date: Date): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of format.formatToParts(date)) {
    if (part.type !== 'literal') result[part.type] = part.value;
  }
  return result;
}

/** `YYYY-MM-DD` (ngày VN) → mốc nửa đêm Việt Nam của ngày đó. */
function vnDateToInstant(date: string): Date {
  return new Date(`${date}T00:00:00+07:00`);
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase('vi-VN') + text.slice(1);
}

/** Giờ Việt Nam `HH:mm` của một mốc ISO 8601 (UTC). */
export function formatTime(iso: string): string {
  const { hour, minute } = parts(timeFormat, new Date(iso));
  return `${hour}:${minute}`;
}

/**
 * Nhãn ngày kiểu `Thứ Năm, 22/10` (Chủ Nhật cho ngày cuối tuần). Nhận ngày VN
 * `YYYY-MM-DD` từ API, hoặc một `Date` (lấy ngày Việt Nam của mốc đó).
 */
export function formatDayLabel(date: string | Date): string {
  const instant = typeof date === 'string' ? vnDateToInstant(date) : date;
  const { weekday, day, month } = parts(dayFormat, instant);
  return `${capitalise(weekday ?? '')}, ${day}/${month}`;
}

/** `22/10/2026` của một ngày VN `YYYY-MM-DD`, hoặc của một mốc thời gian (lấy ngày Việt Nam của mốc đó). */
export function formatDateLabel(date: string | Date): string {
  const instant = typeof date === 'string' ? vnDateToInstant(date) : date;
  const { day, month, year } = parts(dateFormat, instant);
  return `${day}/${month}/${year}`;
}

/** `22/10` của một ngày VN `YYYY-MM-DD`. */
export function formatDayMonth(date: string): string {
  const { day, month } = parts(dateFormat, vnDateToInstant(date));
  return `${day}/${month}`;
}

/**
 * Chuỗi `YYYY-MM-DD` là một ngày có thật trên lịch (`2026-02-30`, `2026-13-45` thì không).
 * Thuần số học lịch, không dính múi giờ.
 */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Mã mùa `YYYY-MM` → `Tháng 10/2026` (tháng không đệm số 0). */
export function formatSeasonLabel(seasonId: string): string {
  const [year = '', month = ''] = seasonId.split('-');
  return `Tháng ${Number(month)}/${year}`;
}

/** Ngày hôm nay theo giờ Việt Nam, dạng `YYYY-MM-DD` — cho giá trị mặc định / giới hạn của ô chọn ngày. */
export function vnTodayIso(now: Date = new Date()): string {
  const { day, month, year } = parts(dateFormat, now);
  return `${year}-${month}-${day}`;
}

/**
 * Cộng `n` ngày (âm để lùi) vào một ngày `YYYY-MM-DD`. Thuần số học lịch (qua
 * `Date.UTC`, không dính múi giờ): `addDaysIso('2026-11-01', -3) === '2026-10-29'`.
 */
export function addDaysIso(iso: string, n: number): string {
  const [year = 0, month = 0, day = 0] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + n));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
