import { expect, test } from 'vitest';
import {
  addDaysIso,
  formatCountdown,
  formatDateLabel,
  formatDayLabel,
  formatDayMonth,
  formatSeasonLabel,
  formatTime,
  isIsoDate,
  vnMonthOf,
  vnTodayIso,
} from '../../src/web/lib/format';

test('formatTime renders the Vietnam wall clock as HH:mm', () => {
  expect(formatTime('2026-10-22T14:00:00.000Z')).toBe('21:00');
  expect(formatTime('2026-10-22T02:05:00.000Z')).toBe('09:05');
});

test('formatTime never shows midnight as 24:00', () => {
  expect(formatTime('2026-10-22T17:00:00.000Z')).toBe('00:00');
});

test('formatDayLabel gives a capitalised weekday and dd/MM', () => {
  expect(formatDayLabel('2026-10-22')).toBe('Thứ Năm, 22/10');
  expect(formatDayLabel('2026-10-25')).toBe('Chủ Nhật, 25/10');
  expect(formatDayLabel('2026-10-05')).toBe('Thứ Hai, 05/10');
});

test('formatDayLabel of a Date uses the Vietnam day, not UTC', () => {
  // 17:30Z ngày 22 là 00:30 ngày 23 ở Việt Nam.
  expect(formatDayLabel(new Date('2026-10-22T17:30:00.000Z'))).toBe('Thứ Sáu, 23/10');
});

test('formatDateLabel renders YYYY-MM-DD as dd/MM/yyyy', () => {
  expect(formatDateLabel('2026-10-22')).toBe('22/10/2026');
  expect(formatDateLabel('2026-01-03')).toBe('03/01/2026');
});

test('formatDateLabel of a Date uses the Vietnam day, not UTC', () => {
  expect(formatDateLabel(new Date('2026-10-22T17:30:00.000Z'))).toBe('23/10/2026');
  expect(formatDateLabel(new Date('2026-12-31T17:00:00.000Z'))).toBe('01/01/2027');
});

test('formatSeasonLabel renders a YYYY-MM season as Tháng M/yyyy', () => {
  expect(formatSeasonLabel('2026-10')).toBe('Tháng 10/2026');
  expect(formatSeasonLabel('2026-01')).toBe('Tháng 1/2026');
});

test('vnTodayIso is the Vietnam calendar day, not UTC', () => {
  expect(vnTodayIso(new Date('2026-10-22T12:00:00.000Z'))).toBe('2026-10-22');
  // 17:30Z ngày 22 đã là ngày 23 ở Việt Nam.
  expect(vnTodayIso(new Date('2026-10-22T17:30:00.000Z'))).toBe('2026-10-23');
  expect(vnTodayIso(new Date('2026-12-31T17:00:00.000Z'))).toBe('2027-01-01');
  expect(vnTodayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('vnMonthOf is the Vietnam calendar month of an instant, as a YYYY-MM season id', () => {
  expect(vnMonthOf('2026-10-22T12:00:00.000Z')).toBe('2026-10');
  // 17:30Z ngày 30/9 đã là 00:30 ngày 1/10 ở Việt Nam.
  expect(vnMonthOf('2026-09-30T17:30:00.000Z')).toBe('2026-10');
  expect(vnMonthOf('2026-12-31T17:00:00.000Z')).toBe('2027-01');
  expect(vnMonthOf('2026-10-31T16:59:00.000Z')).toBe('2026-10');
});

test('addDaysIso shifts a YYYY-MM-DD across month and year boundaries', () => {
  expect(addDaysIso('2026-10-22', -3)).toBe('2026-10-19');
  expect(addDaysIso('2026-11-01', -3)).toBe('2026-10-29');
  expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  expect(addDaysIso('2026-10-22', 0)).toBe('2026-10-22');
});

test('formatDayMonth renders YYYY-MM-DD as dd/MM', () => {
  expect(formatDayMonth('2026-10-21')).toBe('21/10');
  expect(formatDayMonth('2026-01-05')).toBe('05/01');
});

const start = '2026-10-23T13:00:00.000Z';
const at = (iso: string) => new Date(iso);

test('countdown wording', () => {
  expect(formatCountdown(start, at('2026-10-23T10:45:00.000Z'))).toBe('còn 2 giờ 15 phút');
  expect(formatCountdown(start, at('2026-10-23T11:00:00.000Z'))).toBe('còn 2 giờ');
  expect(formatCountdown(start, at('2026-10-23T12:20:00.000Z'))).toBe('còn 40 phút');
  expect(formatCountdown(start, at('2026-10-23T12:59:30.000Z'))).toBe('còn dưới 1 phút');
  expect(formatCountdown(start, at('2026-10-23T13:00:00.000Z'))).toBe('Đang chơi');
  expect(formatCountdown(start, at('2026-10-23T15:00:00.000Z'))).toBe('Đang chơi');
  expect(formatCountdown(start, at('2026-10-22T10:00:00.000Z'))).toBe('còn 1 ngày 3 giờ');
  expect(formatCountdown(start, at('2026-10-21T13:00:00.000Z'))).toBe('còn 2 ngày');
});

test('countdown rounds minutes down and never depends on the time zone', () => {
  // 59 phút 59 giây → vẫn là 59 phút; 1 giờ 0 phút 59 giây → "còn 1 giờ".
  expect(formatCountdown(start, at('2026-10-23T12:00:01.000Z'))).toBe('còn 59 phút');
  expect(formatCountdown(start, at('2026-10-23T11:59:01.000Z'))).toBe('còn 1 giờ');
  // Hiệu thời gian thuần: cùng kết quả dù mốc bắt đầu ghi theo +07:00.
  expect(formatCountdown('2026-10-23T20:00:00.000+07:00', at('2026-10-23T10:45:00.000Z'))).toBe('còn 2 giờ 15 phút');
});

test('isIsoDate accepts only real calendar days in YYYY-MM-DD form', () => {
  for (const ok of ['2026-10-22', '2024-02-29', '2026-12-31', '2026-01-01']) expect(isIsoDate(ok), ok).toBe(true);
  for (const bad of ['2026-13-45', '2026-02-30', '2025-02-29', '2026-00-10', '2026-10-32', '2026-1-5', 'hom-qua', '', '2026-10-22T00:00'])
    expect(isIsoDate(bad), bad).toBe(false);
});
