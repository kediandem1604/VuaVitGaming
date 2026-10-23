/**
 * Mọi định dạng ngày giờ hiển thị trên web nằm ở đây, đều qua `Intl.DateTimeFormat`
 * với múi giờ Việt Nam — web không tự làm toán múi giờ (đó là việc của
 * `src/server/lib/time.ts`) và không bao giờ tự tính "hôm nay" để gửi lên API:
 * bỏ tham số `date` thì server trả về ngày hôm nay của Việt Nam.
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

/** Ngày VN `YYYY-MM-DD` → `22/10/2026`. */
export function formatDateLabel(date: string): string {
  const { day, month, year } = parts(dateFormat, vnDateToInstant(date));
  return `${day}/${month}/${year}`;
}
