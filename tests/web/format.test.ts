import { expect, test } from 'vitest';
import { formatDateLabel, formatDayLabel, formatTime } from '../../src/web/lib/format';

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
