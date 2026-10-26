import { expect, test } from 'vitest';
import { formatMetricValue, formatReportValue, formatSeasonScore, metricAfterValue, reportPoints, seasonScoreUnit } from '../../src/shared/metric';
import type { MetricRole } from '../../src/shared/metric';

test('drops the leading "Số" when the label follows a number', () => {
  expect(formatMetricValue(3, 'Số mạng đã giết')).toBe('3 mạng đã giết');
  expect(formatMetricValue(2, 'Số Vịt bị lộ nhờ bạn')).toBe('2 Vịt bị lộ nhờ bạn');
  expect(formatMetricValue(1, 'Số trận thắng (bị vote ra)')).toBe('1 trận thắng (bị vote ra)');
  expect(metricAfterValue('số lần vote trúng Vịt')).toBe('lần vote trúng Vịt');
});

test('drops "Số" typed in decomposed Unicode (NFD) too', () => {
  const decomposed = 'Số mạng'.normalize('NFD');
  expect(decomposed).not.toBe('Số mạng');
  expect(metricAfterValue(decomposed)).toBe('mạng');
  expect(formatMetricValue(3, decomposed)).toBe('3 mạng');
});

test('keeps labels that do not start with "Số", and a bare "Số"', () => {
  expect(metricAfterValue('Chưa đặt chỉ số')).toBe('Chưa đặt chỉ số');
  expect(metricAfterValue('Sống sót')).toBe('Sống sót');
  expect(metricAfterValue('Số')).toBe('Số');
});

// ---------------------------------------------------------------------------
// Chỉ số phụ
// ---------------------------------------------------------------------------

/** Ám sát sau migration: giết ×1, ám sát trong họp ×3. */
const assassin: MetricRole = { metricLabel: 'Số mạng đã giết', extraMetricLabel: 'Số lần ám sát trong cuộc họp', extraPoints: 3 };
/** Role thường, không có chỉ số phụ. */
const swordsman: MetricRole = { metricLabel: 'Số mạng chém', extraMetricLabel: null, extraPoints: null };

test('reportPoints = value + extraValue × extraPoints; a role without an extra metric scores its value', () => {
  expect(reportPoints(4, 2, assassin)).toBe(10);
  expect(reportPoints(0, 1, assassin)).toBe(3);
  expect(reportPoints(4, 0, assassin)).toBe(4);
  expect(reportPoints(0, 0, assassin)).toBe(0);
  expect(reportPoints(7, 0, swordsman)).toBe(7);
  // Chỉ số phụ đã tắt (extraPoints null) mà lần khai còn extraValue → phần phụ tính 0 điểm.
  expect(reportPoints(4, 2, swordsman)).toBe(4);
  expect(reportPoints(4, 2, { ...assassin, extraPoints: null })).toBe(4);
  // Điểm mỗi lần đọc từ role hiện tại.
  expect(reportPoints(4, 2, { ...assassin, extraPoints: 5 })).toBe(14);
});

test('formatReportValue reads "x + y" for an extra-metric role and like formatMetricValue otherwise', () => {
  expect(formatReportValue(4, 2, assassin)).toBe('4 mạng đã giết + 2 lần ám sát trong cuộc họp');
  expect(formatReportValue(0, 0, assassin)).toBe('0 mạng đã giết + 0 lần ám sát trong cuộc họp');
  expect(formatReportValue(7, 0, swordsman)).toBe('7 mạng chém');
  // Role không có chỉ số phụ: không bao giờ in phần phụ, dù dữ liệu có extraValue lạ.
  expect(formatReportValue(7, 2, swordsman)).toBe('7 mạng chém');
  // Nhãn phụ không bắt đầu bằng "Số" giữ nguyên.
  expect(formatReportValue(1, 1, { ...assassin, extraMetricLabel: 'Lần ám sát' })).toBe('1 mạng đã giết + 1 Lần ám sát');
});

test('formatSeasonScore is "N điểm" for an extra-metric role and "{N} {label}" otherwise', () => {
  expect(formatSeasonScore(10, assassin)).toBe('10 điểm');
  expect(formatSeasonScore(0, assassin)).toBe('0 điểm');
  expect(formatSeasonScore(12, swordsman)).toBe('12 mạng chém');
  expect(formatSeasonScore(1, { metricLabel: 'Số trận thắng (bị vote ra)', extraMetricLabel: null, extraPoints: null })).toBe('1 trận thắng (bị vote ra)');
});

test('seasonScoreUnit is the word after the number: "điểm" for an extra-metric role, the label without "Số" otherwise', () => {
  // Thẻ role và bục in số và đơn vị bằng hai cỡ chữ nên cần riêng phần đơn vị; ghép lại phải bằng formatSeasonScore.
  expect(seasonScoreUnit(assassin)).toBe('điểm');
  expect(seasonScoreUnit(swordsman)).toBe('mạng chém');
  expect(`10 ${seasonScoreUnit(assassin)}`).toBe(formatSeasonScore(10, assassin));
  expect(`12 ${seasonScoreUnit(swordsman)}`).toBe(formatSeasonScore(12, swordsman));
});
