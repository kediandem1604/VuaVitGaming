import { expect, test } from 'vitest';
import { formatMetricValue, metricAfterValue } from '../../src/shared/metric';

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
