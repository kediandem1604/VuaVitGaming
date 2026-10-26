/**
 * Nhãn chỉ số của role (vd "Số mạng đã giết") đọc đúng khi đứng một mình — ô nhập khai điểm,
 * dòng "Chỉ số: …". Khi đứng sau con số thì bỏ chữ "Số" ở đầu: "3 mạng đã giết", không phải
 * "3 Số mạng đã giết". Nhãn không bắt đầu bằng "Số" giữ nguyên.
 */
export function metricAfterValue(label: string): string {
  // NFC trước khi so: nhãn gõ ở dạng tổ hợp (NFD, "ô" = "o" + dấu mũ) vẫn phải khớp "số".
  const trimmed = label.trim().normalize('NFC');
  const rest = trimmed.replace(/^số\s+/iu, '');
  return rest.length > 0 ? rest : trimmed;
}

/** `{giá trị} {nhãn}` đọc tự nhiên: `formatMetricValue(3, 'Số mạng đã giết')` → "3 mạng đã giết". */
export function formatMetricValue(value: number, label: string): string {
  return `${value} ${metricAfterValue(label)}`;
}

// ---------------------------------------------------------------------------
// Chỉ số phụ (spec chỉ số phụ §3, §7)
// ---------------------------------------------------------------------------

/**
 * Phần của role mà cách tính và cách đọc điểm cần: nhãn chính, nhãn phụ và điểm mỗi đơn vị
 * phụ. `RoleDto`, `ReportDto.role`, `FactionTopRowDto.role` đều khớp kiểu này. Role không có
 * chỉ số phụ khi `extraMetricLabel` là null (DB giữ ba trường phụ cùng có hoặc cùng null).
 */
export interface MetricRole {
  metricLabel: string;
  extraMetricLabel: string | null;
  extraPoints: number | null;
}

/** Role có chỉ số phụ hay không. */
export function hasExtraMetric(role: MetricRole): boolean {
  return role.extraMetricLabel !== null;
}

/**
 * Điểm của một lần khai = `value` + `extraValue × extraPoints`, đọc điểm mỗi lần HIỆN TẠI của
 * role. Role không có chỉ số phụ (hay đã tắt mà lần khai còn `extraValue`): phần phụ tính 0.
 */
export function reportPoints(value: number, extraValue: number, role: MetricRole): number {
  return value + extraValue * (role.extraPoints ?? 0);
}

/**
 * Một lần khai đọc tự nhiên: role có chỉ số phụ → `{value} {nhãn chính} + {extraValue} {nhãn phụ}`
 * ("4 mạng đã giết + 2 lần ám sát trong cuộc họp"); role không có → như `formatMetricValue`.
 */
export function formatReportValue(value: number, extraValue: number, role: MetricRole): string {
  const main = formatMetricValue(value, role.metricLabel);
  return role.extraMetricLabel === null ? main : `${main} + ${formatMetricValue(extraValue, role.extraMetricLabel)}`;
}

/**
 * Điểm mùa đọc tự nhiên: role có chỉ số phụ → `{điểm} điểm` (điểm đã trộn hai chỉ số, không còn
 * đơn vị); role không có → `{điểm} {nhãn}` như cũ.
 */
export function formatSeasonScore(score: number, role: MetricRole): string {
  return hasExtraMetric(role) ? `${score} điểm` : formatMetricValue(score, role.metricLabel);
}
