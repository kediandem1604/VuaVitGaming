/**
 * Mọi phép toán múi giờ của ứng dụng nằm ở đây (xem global constraints).
 *
 * Giờ Việt Nam = UTC+7 cố định, không có giờ mùa hè, nên chỉ cần cộng/trừ
 * 7 giờ trên epoch milliseconds — không cần thư viện ngày giờ hay `Intl`.
 *
 * Quy ước chuỗi: ngày VN `YYYY-MM-DD`, giờ VN `HH:mm`, mùa `YYYY-MM`.
 * Mọi hàm nhận chuỗi đều kiểm tra định dạng và ném lỗi nếu sai.
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Ymd = { y: number; m: number; d: number }; // m = 1..12

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Lấy năm/tháng/ngày theo UTC của một mốc thời gian (đã dịch sang giờ VN nếu cần). */
function ymdUtc(d: Date): Ymd {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function formatYmd({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

function assertValidDate(d: Date): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error('Mốc thời gian không hợp lệ');
  }
}

/** Năm/tháng/ngày theo giờ VN của một mốc thời gian. */
function vnYmd(d: Date): Ymd {
  assertValidDate(d);
  return ymdUtc(new Date(d.getTime() + VN_OFFSET_MS));
}

/** Phân tích `YYYY-MM-DD`; từ chối cả ngày không tồn tại (vd 2026-02-30). */
function parseVnDate(vnDate: string): Ymd {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vnDate);
  if (!match) throw new Error(`Ngày không hợp lệ: "${vnDate}" (cần dạng YYYY-MM-DD)`);
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  // Date.UTC tự "cuộn" ngày thừa sang tháng sau; so lại chuỗi để bắt trường hợp đó.
  if (formatYmd(ymdUtc(new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)))) !== vnDate) {
    throw new Error(`Ngày không tồn tại: "${vnDate}"`);
  }
  return ymd;
}

/** Phân tích `HH:mm` (00:00 – 23:59). */
function parseHhmm(hhmm: string): { hh: number; mm: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Giờ không hợp lệ: "${hhmm}" (cần dạng HH:mm)`);
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) throw new Error(`Giờ không hợp lệ: "${hhmm}"`);
  return { hh, mm };
}

/** Phân tích mã mùa `YYYY-MM`. */
function parseSeasonId(seasonId: string): { y: number; m: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(seasonId);
  if (!match) throw new Error(`Mã mùa không hợp lệ: "${seasonId}" (cần dạng YYYY-MM)`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) throw new Error(`Mã mùa không hợp lệ: "${seasonId}"`);
  return { y, m };
}

function formatSeasonId(y: number, m: number): string {
  return `${String(y).padStart(4, '0')}-${pad2(m)}`;
}

/** Tháng kế tiếp của một mùa (cuộn năm khi qua tháng 12). */
function nextMonth({ y, m }: { y: number; m: number }): { y: number; m: number } {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

/** Mốc UTC của `y-m-d hh:mm` theo giờ Việt Nam. */
function vnWallClockToUtc(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - VN_OFFSET_MS);
}

// ---------------------------------------------------------------------------
// Ngày giờ Việt Nam
// ---------------------------------------------------------------------------

/** Ngày VN (`YYYY-MM-DD`) của một mốc thời gian. */
export function toVnDate(d: Date): string {
  return formatYmd(vnYmd(d));
}

/** Khoảng UTC [start, end) bao trọn một ngày VN. */
export function vnDayRange(vnDate: string): { start: Date; end: Date } {
  const { y, m, d } = parseVnDate(vnDate);
  const start = vnWallClockToUtc(y, m, d);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Mốc UTC của giờ `HH:mm` trong ngày VN `vnDate`. */
export function vnDateTimeToUtc(vnDate: string, hhmm: string): Date {
  const { y, m, d } = parseVnDate(vnDate);
  const { hh, mm } = parseHhmm(hhmm);
  return vnWallClockToUtc(y, m, d, hh, mm);
}

/**
 * Số ngày lịch VN từ `from` tới `to`: cùng một ngày VN → 0, qua nửa đêm VN → 1 (dù chỉ một
 * phút). Tính theo ngày Việt Nam, không theo ngày UTC. `to` trước `from` → 0, không âm.
 */
export function vnDaysBetween(from: Date, to: Date): number {
  const a = vnYmd(from);
  const b = vnYmd(to);
  const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
  return Math.max(0, days);
}

/** Cộng `n` ngày (âm để lùi) vào một ngày VN. */
export function addDaysVn(vnDate: string, n: number): string {
  const { y, m, d } = parseVnDate(vnDate);
  if (!Number.isInteger(n)) throw new Error(`Số ngày phải là số nguyên: ${n}`);
  return formatYmd(ymdUtc(new Date(Date.UTC(y, m - 1, d + n))));
}

// ---------------------------------------------------------------------------
// Mùa giải (theo tháng dương lịch, giờ VN)
// ---------------------------------------------------------------------------

/** Mã mùa (`YYYY-MM`) chứa ngày VN này. */
export function seasonIdOf(vnDate: string): string {
  const { y, m } = parseVnDate(vnDate);
  return formatSeasonId(y, m);
}

/** Ngày đầu và ngày cuối (bao gồm) của mùa, dạng `YYYY-MM-DD`. */
export function seasonDateRange(seasonId: string): { first: string; last: string } {
  const { y, m } = parseSeasonId(seasonId);
  // Ngày 0 của tháng sau = ngày cuối tháng này.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: formatYmd({ y, m, d: 1 }), last: formatYmd({ y, m, d: lastDay }) };
}

/** Mã mùa liền trước. */
export function previousSeasonId(id: string): string {
  const { y, m } = parseSeasonId(id);
  return m === 1 ? formatSeasonId(y - 1, 12) : formatSeasonId(y, m - 1);
}

/** Giờ chốt mùa: 00:05 ngày 4 tháng sau, giờ VN. */
export function seasonCloseAt(id: string): Date {
  const { y, m } = nextMonth(parseSeasonId(id));
  return vnWallClockToUtc(y, m, 4, 0, 5);
}

/** Giờ nhắc mod duyệt nốt: 09:00 ngày 3 tháng sau, giờ VN. */
export function seasonNudgeAt(id: string): Date {
  const { y, m } = nextMonth(parseSeasonId(id));
  return vnWallClockToUtc(y, m, 3, 9, 0);
}

// ---------------------------------------------------------------------------
// Định dạng hiển thị
// ---------------------------------------------------------------------------

/** `HH:mm` theo giờ VN. */
export function formatVnTime(d: Date): string {
  assertValidDate(d);
  const shifted = new Date(d.getTime() + VN_OFFSET_MS);
  return `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
}

/** `dd/MM` theo giờ VN; nhận mốc thời gian hoặc chuỗi ngày VN `YYYY-MM-DD`. */
export function formatVnDay(d: Date | string): string {
  const { m, d: day } = typeof d === 'string' ? parseVnDate(d) : vnYmd(d);
  return `${pad2(day)}/${pad2(m)}`;
}

/** `MM/YYYY` của một mã mùa — tên mùa hiện cho người dùng (vd `2026-10` → `10/2026`). */
export function formatSeasonLabel(seasonId: string): string {
  const { y, m } = parseSeasonId(seasonId);
  return `${pad2(m)}/${String(y).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Cột ngày-không-giờ (`@db.Date`)
// ---------------------------------------------------------------------------

/**
 * Prisma đọc/ghi cột `@db.Date` bằng Date lúc 00:00 UTC của ngày đó,
 * nên ngày VN `YYYY-MM-DD` ↔ `Date.UTC(y, m-1, d)` — không dịch múi giờ.
 */
export function dateOnlyToDb(vnDate: string): Date {
  const { y, m, d } = parseVnDate(vnDate);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Ngược lại của `dateOnlyToDb`: lấy phần ngày UTC. */
export function dbToDateOnly(d: Date): string {
  assertValidDate(d);
  return formatYmd(ymdUtc(d));
}
