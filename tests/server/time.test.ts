import { expect, test } from 'vitest';
import {
  addDaysVn,
  dateOnlyToDb,
  dbToDateOnly,
  formatSeasonLabel,
  formatVnDay,
  formatVnTime,
  previousSeasonId,
  seasonCloseAt,
  seasonDateRange,
  seasonIdOf,
  seasonNudgeAt,
  toVnDate,
  vnDateTimeToUtc,
  vnDayRange,
  vnDaysBetween,
} from '../../src/server/lib/time.js';

test('VN date crosses UTC midnight', () => {
  expect(toVnDate(new Date('2026-10-22T17:30:00Z'))).toBe('2026-10-23');
  expect(toVnDate(new Date('2026-10-22T16:59:59Z'))).toBe('2026-10-22');
});

test('VN day range', () => {
  const range = vnDayRange('2026-10-23');
  expect(range.start.toISOString()).toBe('2026-10-22T17:00:00.000Z');
  expect(range.end.toISOString()).toBe('2026-10-23T17:00:00.000Z');
});

test('local time to UTC', () => {
  expect(vnDateTimeToUtc('2026-10-22', '21:00').toISOString()).toBe('2026-10-22T14:00:00.000Z');
  expect(vnDateTimeToUtc('2026-10-23', '02:30').toISOString()).toBe('2026-10-22T19:30:00.000Z');
});

test('vnDaysBetween counts Vietnam calendar days, never negative', () => {
  // Cùng một ngày VN (23:00 và 23:59 ngày 22/10 giờ VN) → 0.
  expect(vnDaysBetween(new Date('2026-10-22T16:00:00Z'), new Date('2026-10-22T16:59:00Z'))).toBe(0);
  // Qua nửa đêm VN (17:00Z) dù chỉ một phút → 1.
  expect(vnDaysBetween(new Date('2026-10-22T16:59:00Z'), new Date('2026-10-22T17:00:00Z'))).toBe(1);
  // Theo múi giờ VN, không phải UTC: 01:00Z và 23:00Z cùng ngày UTC nhưng 23:00Z đã là ngày hôm sau ở VN.
  expect(vnDaysBetween(new Date('2026-10-22T01:00:00Z'), new Date('2026-10-22T23:00:00Z'))).toBe(1);
  // Khác ngày UTC nhưng cùng ngày VN: 17:00Z ngày 21 và 10:00Z ngày 22 → 0.
  expect(vnDaysBetween(new Date('2026-10-21T17:00:00Z'), new Date('2026-10-22T10:00:00Z'))).toBe(0);
  // Nhiều ngày, qua tháng.
  expect(vnDaysBetween(new Date('2026-09-30T17:00:00Z'), new Date('2026-10-22T12:00:00Z'))).toBe(21);
  // `to` trước `from` → 0, không âm.
  expect(vnDaysBetween(new Date('2026-10-25T00:00:00Z'), new Date('2026-10-22T00:00:00Z'))).toBe(0);
});

test('add days across month', () => {
  expect(addDaysVn('2026-03-01', -3)).toBe('2026-02-26');
  expect(addDaysVn('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDaysVn('2026-10-22', 0)).toBe('2026-10-22');
});

test('season helpers', () => {
  expect(seasonIdOf('2026-10-31')).toBe('2026-10');
  expect(seasonDateRange('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
  expect(seasonDateRange('2024-02')).toEqual({ first: '2024-02-01', last: '2024-02-29' });
  expect(previousSeasonId('2026-01')).toBe('2025-12');
  expect(previousSeasonId('2026-10')).toBe('2026-09');
  expect(seasonCloseAt('2026-10').toISOString()).toBe('2026-11-03T17:05:00.000Z');
  expect(seasonCloseAt('2026-12').toISOString()).toBe('2027-01-03T17:05:00.000Z');
  expect(seasonNudgeAt('2026-12').toISOString()).toBe('2027-01-03T02:00:00.000Z');
  expect(formatSeasonLabel('2026-10')).toBe('10/2026');
  expect(formatSeasonLabel('2027-01')).toBe('01/2027');
  expect(() => formatSeasonLabel('2026-13')).toThrow();
});

test('formatting', () => {
  expect(formatVnTime(new Date('2026-10-22T14:00:00Z'))).toBe('21:00');
  expect(formatVnTime(new Date('2026-10-22T17:05:00Z'))).toBe('00:05');
  expect(formatVnDay('2026-10-05')).toBe('05/10');
  expect(formatVnDay(new Date('2026-10-22T17:30:00Z'))).toBe('23/10');
});

test('date-only roundtrip', () => {
  expect(dbToDateOnly(dateOnlyToDb('2026-10-31'))).toBe('2026-10-31');
  expect(dateOnlyToDb('2026-10-31').toISOString()).toBe('2026-10-31T00:00:00.000Z');
});

test('malformed input is rejected', () => {
  expect(() => toVnDate(new Date('không phải ngày'))).toThrow();
  expect(() => vnDayRange('2026-2-3')).toThrow();
  expect(() => vnDayRange('2026-02-30')).toThrow();
  expect(() => addDaysVn('20261022', 1)).toThrow();
  expect(() => vnDateTimeToUtc('2026-10-22', '24:00')).toThrow();
  expect(() => vnDateTimeToUtc('2026-10-22', '9:00')).toThrow();
  expect(() => vnDateTimeToUtc('2026-10-22', '21:60')).toThrow();
  expect(() => seasonDateRange('2026-13')).toThrow();
  expect(() => seasonDateRange('2026-00')).toThrow();
  expect(() => previousSeasonId('2026/01')).toThrow();
  expect(() => dateOnlyToDb('31/10/2026')).toThrow();
});
