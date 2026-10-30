import { expect, test } from 'vitest';
import {
  formatMetricValue,
  formatReportValue,
  formatSeasonScore,
  hasExtraMetric,
  hasPenaltyMetric,
  metricAfterValue,
  reportPoints,
  seasonScoreUnit,
} from '../../src/shared/metric';
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
// Điểm một lần khai: chính × points, phụ, phạt trừ, bonus (spec điểm role §3)
// ---------------------------------------------------------------------------

/** Ám sát sau migration: giết ×1, ám sát trong họp ×3, không có chỉ số phạt. */
const assassin: MetricRole = {
  metricLabel: 'Số mạng đã giết',
  points: 1,
  extraMetricLabel: 'Số lần ám sát trong cuộc họp',
  extraPoints: 3,
  penaltyMetricLabel: null,
  penaltyMaxPerGame: null,
  penaltyPoints: null,
};
/** Role thường: ×1, không có chỉ số phụ hay phạt. */
const swordsman: MetricRole = {
  metricLabel: 'Số mạng chém',
  points: 1,
  extraMetricLabel: null,
  extraPoints: null,
  penaltyMetricLabel: null,
  penaltyMaxPerGame: null,
  penaltyPoints: null,
};
/** Dân phòng theo điểm khởi đầu: mỗi phát trúng +5, mỗi phát bắn sai −3 (tối đa 1). */
const vigilante: MetricRole = {
  metricLabel: 'Số phát bắn trúng kẻ xấu',
  points: 5,
  extraMetricLabel: null,
  extraPoints: null,
  penaltyMetricLabel: 'Số phát bắn sai',
  penaltyMaxPerGame: 1,
  penaltyPoints: 3,
};
/** Cảnh sát trưởng: +3 mỗi phát trúng, −1 mỗi phát sai (tối đa 10). */
const sheriff: MetricRole = { ...vigilante, metricLabel: 'Số phát bắn trúng kẻ xấu', points: 3, penaltyMaxPerGame: 10, penaltyPoints: 1 };

/** Một lần khai với các trường bỏ trống = 0. */
const r = (o: { value: number; extraValue?: number; penaltyValue?: number; bonusPoints?: number }) => ({
  value: o.value,
  extraValue: o.extraValue ?? 0,
  penaltyValue: o.penaltyValue ?? 0,
  bonusPoints: o.bonusPoints ?? 0,
});

test('hasExtraMetric / hasPenaltyMetric follow the labels', () => {
  expect(hasExtraMetric(assassin)).toBe(true);
  expect(hasExtraMetric(vigilante)).toBe(false);
  expect(hasPenaltyMetric(vigilante)).toBe(true);
  expect(hasPenaltyMetric(assassin)).toBe(false);
  expect(hasPenaltyMetric(swordsman)).toBe(false);
});

test('reportPoints = value × points + extraValue × extraPoints − penaltyValue × penaltyPoints + bonusPoints', () => {
  // Chính × points.
  expect(reportPoints(r({ value: 7 }), swordsman)).toBe(7);
  expect(reportPoints(r({ value: 1 }), vigilante)).toBe(5);
  expect(reportPoints(r({ value: 3 }), sheriff)).toBe(9);
  expect(reportPoints(r({ value: 0 }), vigilante)).toBe(0);
  // Chỉ số phụ như cũ.
  expect(reportPoints(r({ value: 4, extraValue: 2 }), assassin)).toBe(10);
  expect(reportPoints(r({ value: 0, extraValue: 1 }), assassin)).toBe(3);
  // Chỉ số phụ đã tắt (extraPoints null) mà lần khai còn extraValue → phần phụ tính 0 điểm.
  expect(reportPoints(r({ value: 4, extraValue: 2 }), swordsman)).toBe(4);
  expect(reportPoints(r({ value: 4, extraValue: 2 }), { ...assassin, extraPoints: null })).toBe(4);
  // Điểm mỗi lần đọc từ role hiện tại.
  expect(reportPoints(r({ value: 4, extraValue: 2 }), { ...assassin, extraPoints: 5 })).toBe(14);
  expect(reportPoints(r({ value: 4, extraValue: 2 }), { ...assassin, points: 2 })).toBe(14);
  // Phạt trừ: 1 trúng (+5) − 1 sai (−3) = 2; Cảnh sát 2 trúng (+6) − 3 sai (−3) = 3.
  expect(reportPoints(r({ value: 1, penaltyValue: 1 }), vigilante)).toBe(2);
  expect(reportPoints(r({ value: 2, penaltyValue: 3 }), sheriff)).toBe(3);
  // Có thể âm: 0 trúng, 1 sai → −3; mục trừ do báo cáo (value 0, penalty 1).
  expect(reportPoints(r({ value: 0, penaltyValue: 1 }), vigilante)).toBe(-3);
  expect(reportPoints(r({ value: 1, penaltyValue: 4 }), sheriff)).toBe(-1);
  // Role không có chỉ số phạt mà lần khai còn penaltyValue → phần phạt tính 0.
  expect(reportPoints(r({ value: 4, penaltyValue: 2 }), swordsman)).toBe(4);
  // bonusPoints cộng thẳng (+1 khi báo cáo kèm theo được duyệt đúng).
  expect(reportPoints(r({ value: 4, bonusPoints: 1 }), swordsman)).toBe(5);
  expect(reportPoints(r({ value: 1, penaltyValue: 1, bonusPoints: 1 }), vigilante)).toBe(3);
  expect(reportPoints(r({ value: 0, bonusPoints: 1 }), swordsman)).toBe(1);
});

test('formatReportValue reads "x + y − z": extra part only for an extra-metric role, penalty part only when penaltyValue > 0', () => {
  expect(formatReportValue(r({ value: 4, extraValue: 2 }), assassin)).toBe('4 mạng đã giết + 2 lần ám sát trong cuộc họp');
  expect(formatReportValue(r({ value: 0, extraValue: 0 }), assassin)).toBe('0 mạng đã giết + 0 lần ám sát trong cuộc họp');
  expect(formatReportValue(r({ value: 7 }), swordsman)).toBe('7 mạng chém');
  // Role không có chỉ số phụ: không bao giờ in phần phụ, dù dữ liệu có extraValue lạ.
  expect(formatReportValue(r({ value: 7, extraValue: 2 }), swordsman)).toBe('7 mạng chém');
  // Nhãn phụ không bắt đầu bằng "Số" giữ nguyên.
  expect(formatReportValue(r({ value: 1, extraValue: 1 }), { ...assassin, extraMetricLabel: 'Lần ám sát' })).toBe('1 mạng đã giết + 1 Lần ám sát');
  // Phạt: chỉ in khi penaltyValue > 0, dấu trừ là "−" (U+2212).
  expect(formatReportValue(r({ value: 1, penaltyValue: 1 }), vigilante)).toBe('1 phát bắn trúng kẻ xấu − 1 phát bắn sai');
  expect(formatReportValue(r({ value: 1, penaltyValue: 0 }), vigilante)).toBe('1 phát bắn trúng kẻ xấu');
  expect(formatReportValue(r({ value: 0, penaltyValue: 1 }), vigilante)).toBe('0 phát bắn trúng kẻ xấu − 1 phát bắn sai');
  // Role không có chỉ số phạt: không in phần phạt dù dữ liệu có penaltyValue lạ.
  expect(formatReportValue(r({ value: 7, penaltyValue: 1 }), swordsman)).toBe('7 mạng chém');
  // Đủ cả ba: "x + y − z".
  const full: MetricRole = { ...assassin, penaltyMetricLabel: 'Số lần đoán sai', penaltyMaxPerGame: 2, penaltyPoints: 1 };
  expect(formatReportValue(r({ value: 4, extraValue: 2, penaltyValue: 1 }), full)).toBe('4 mạng đã giết + 2 lần ám sát trong cuộc họp − 1 lần đoán sai');
});

test('seasonScoreUnit is "điểm" when points ≠ 1 or the role has an extra or penalty metric, the label without "Số" otherwise', () => {
  expect(seasonScoreUnit(assassin)).toBe('điểm');
  expect(seasonScoreUnit(vigilante)).toBe('điểm');
  // points ≠ 1 nhưng không có chỉ số phụ hay phạt (vd Chim đa đa ×5).
  expect(seasonScoreUnit({ ...swordsman, points: 5 })).toBe('điểm');
  // Chỉ có chỉ số phạt, points = 1.
  expect(seasonScoreUnit({ ...swordsman, penaltyMetricLabel: 'Số lần chém nhầm', penaltyMaxPerGame: 3, penaltyPoints: 1 })).toBe('điểm');
  expect(seasonScoreUnit(swordsman)).toBe('mạng chém');
  // Thẻ role và bục in số và đơn vị bằng hai cỡ chữ nên cần riêng phần đơn vị; ghép lại phải bằng formatSeasonScore.
  expect(`10 ${seasonScoreUnit(assassin)}`).toBe(formatSeasonScore(10, assassin));
  expect(`12 ${seasonScoreUnit(swordsman)}`).toBe(formatSeasonScore(12, swordsman));
});

test('formatSeasonScore is "N điểm" for a role whose score is not its raw metric and "{N} {label}" otherwise', () => {
  expect(formatSeasonScore(10, assassin)).toBe('10 điểm');
  expect(formatSeasonScore(0, assassin)).toBe('0 điểm');
  expect(formatSeasonScore(5, vigilante)).toBe('5 điểm');
  expect(formatSeasonScore(12, swordsman)).toBe('12 mạng chém');
  expect(formatSeasonScore(1, { ...swordsman, metricLabel: 'Số trận thắng (bị vote ra)' })).toBe('1 trận thắng (bị vote ra)');
});
