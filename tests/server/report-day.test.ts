import { expect, test } from 'vitest';
import { REPORT_DAY_START_HOUR, defaultPlayedOn, pickDefaultSession } from '../../src/shared/report-day.js';

/** Mốc UTC của `HH:mm` ngày `ymd` giờ VN (UTC+7). */
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

test('the report day turns over at 06:00 VN, not at midnight', () => {
  expect(REPORT_DAY_START_HOUR).toBe(6);
  expect(defaultPlayedOn(vn('2026-10-31', '05:59'))).toBe('2026-10-30');
  expect(defaultPlayedOn(new Date(vn('2026-10-31', '06:00').getTime() - 1))).toBe('2026-10-30');
  expect(defaultPlayedOn(vn('2026-10-31', '06:00'))).toBe('2026-10-31');
  expect(defaultPlayedOn(vn('2026-10-31', '23:59'))).toBe('2026-10-31');
  // Nửa đêm VN: vẫn là ngày hôm trước.
  expect(defaultPlayedOn(vn('2026-10-31', '00:00'))).toBe('2026-10-30');
});

test('the report day rolls back across month and year starts', () => {
  expect(defaultPlayedOn(vn('2026-11-01', '03:00'))).toBe('2026-10-31');
  expect(defaultPlayedOn(vn('2026-11-01', '06:00'))).toBe('2026-11-01');
  expect(defaultPlayedOn(vn('2027-01-01', '05:00'))).toBe('2026-12-31');
  expect(defaultPlayedOn(vn('2028-03-01', '01:00'))).toBe('2028-02-29');
});

test('the default session is the latest one already started that day, else the first of the day, cancelled ones skipped', () => {
  const s = (id: number, ymd: string, hhmm: string, status = 'scheduled') => ({ id, startsAt: vn(ymd, hhmm).toISOString(), status });
  const sessions = [
    s(1, '2026-10-30', '20:00'),
    s(2, '2026-10-31', '21:00'),
    s(3, '2026-10-31', '19:00'),
    s(4, '2026-10-31', '20:00', 'cancelled'),
    s(5, '2026-10-31', '22:30'),
  ];
  // 20:30: buổi 19:00 đã bắt đầu (buổi 20:00 bị huỷ bị bỏ qua).
  expect(pickDefaultSession(sessions, vn('2026-10-31', '20:30'))?.id).toBe(3);
  expect(pickDefaultSession(sessions, vn('2026-10-31', '21:00'))?.id).toBe(2);
  // Chưa buổi nào bắt đầu → buổi đầu tiên của ngày.
  expect(pickDefaultSession(sessions, vn('2026-10-31', '08:00'))?.id).toBe(3);
  // 01:00 ngày 01/11 vẫn là ngày chơi 31/10 → buổi gần nhất đã bắt đầu: 22:30.
  expect(pickDefaultSession(sessions, vn('2026-11-01', '01:00'))?.id).toBe(5);
  // Ngày chỉ định rõ.
  expect(pickDefaultSession(sessions, vn('2026-10-31', '20:30'), '2026-10-30')?.id).toBe(1);
  // Không có buổi nào (hoặc chỉ buổi bị huỷ) → null.
  expect(pickDefaultSession(sessions, vn('2026-10-29', '20:00'))).toBeNull();
  expect(pickDefaultSession([s(9, '2026-10-31', '19:00', 'cancelled')], vn('2026-10-31', '20:00'))).toBeNull();
  // Nhận cả `Date`.
  expect(pickDefaultSession([{ id: 7, startsAt: vn('2026-10-31', '19:00'), status: 'ended' }], vn('2026-10-31', '23:00'))?.id).toBe(7);
});
