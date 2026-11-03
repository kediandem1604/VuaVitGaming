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
// Điểm theo role: chỉ số chính × points, chỉ số phụ, chỉ số phạt (spec điểm role §3, §5)
// ---------------------------------------------------------------------------

/**
 * Phần của role mà cách tính và cách đọc điểm cần: nhãn chính và điểm mỗi đơn vị (`points`), nhãn
 * phụ và điểm mỗi đơn vị phụ, chỉ số phạt (nhãn, tối đa, điểm bị trừ mỗi đơn vị). `RoleDto`,
 * `ReportDto.role`, `FactionTopRowDto.role` đều khớp kiểu này. Role không có chỉ số phụ khi
 * `extraMetricLabel` là null, không có chỉ số phạt khi `penaltyMetricLabel` là null (DB giữ mỗi bộ
 * ba trường cùng có hoặc cùng null).
 */
export interface MetricRole {
  metricLabel: string;
  points: number;
  extraMetricLabel: string | null;
  extraPoints: number | null;
  penaltyMetricLabel: string | null;
  penaltyMaxPerGame: number | null;
  penaltyPoints: number | null;
}

/** Các con số của một lần khai mà cách tính điểm cần. */
export interface ReportValues {
  value: number;
  extraValue: number;
  penaltyValue: number;
  bonusPoints: number;
}

/** Role có chỉ số phụ hay không. */
export function hasExtraMetric(role: Pick<MetricRole, 'extraMetricLabel'>): boolean {
  return role.extraMetricLabel !== null;
}

/** Role có chỉ số phạt hay không. */
export function hasPenaltyMetric(role: Pick<MetricRole, 'penaltyMetricLabel'>): boolean {
  return role.penaltyMetricLabel !== null;
}

/**
 * Điểm của một lần khai = `(value × points + extraValue × extraPoints) × multiplier − penaltyValue ×
 * penaltyPoints + bonusPoints`, đọc điểm HIỆN TẠI của role (spec điểm role §3). `multiplier` là hệ số
 * của ngày chơi (spec ngày nhân điểm §3; mặc định 1) — chỉ nhân phần cộng, không nhân điểm trừ hay
 * bonus. Role không có chỉ số phụ/phạt (hay đã tắt mà lần khai còn giá trị): phần đó tính 0. Có thể âm.
 */
export function reportPoints(r: ReportValues, role: MetricRole, multiplier = 1): number {
  const plus = r.value * role.points + r.extraValue * (role.extraPoints ?? 0);
  return plus * multiplier - r.penaltyValue * (role.penaltyPoints ?? 0) + r.bonusPoints;
}

/**
 * Một lần khai đọc tự nhiên (spec điểm role §5): `{value} {nhãn chính}`, thêm ` + {extraValue}
 * {nhãn phụ}` khi role có chỉ số phụ, thêm ` − {penaltyValue} {nhãn phạt}` khi role có chỉ số phạt
 * và `penaltyValue > 0` — "1 phát bắn trúng kẻ xấu − 1 phát bắn sai". Role không có phần nào thì
 * như `formatMetricValue`.
 */
export function formatReportValue(r: Pick<ReportValues, 'value' | 'extraValue' | 'penaltyValue'>, role: MetricRole): string {
  let text = formatMetricValue(r.value, role.metricLabel);
  if (role.extraMetricLabel !== null) text += ` + ${formatMetricValue(r.extraValue, role.extraMetricLabel)}`;
  if (role.penaltyMetricLabel !== null && r.penaltyValue > 0) text += ` − ${formatMetricValue(r.penaltyValue, role.penaltyMetricLabel)}`;
  return text;
}

/**
 * Phần đứng sau con số của điểm mùa (spec điểm role §5): role có `points ≠ 1`, chỉ số phụ hoặc
 * chỉ số phạt → "điểm" (điểm đã không còn là con số thô của một chỉ số); còn lại → nhãn bỏ chữ
 * "Số" (`metricAfterValue`). Thẻ role và bục in số và đơn vị bằng hai cỡ chữ nên cần riêng phần
 * này; `formatSeasonScore` ghép hai phần lại.
 */
export function seasonScoreUnit(role: MetricRole): string {
  return role.points !== 1 || hasExtraMetric(role) || hasPenaltyMetric(role) ? 'điểm' : metricAfterValue(role.metricLabel);
}

/** Điểm mùa đọc tự nhiên: `{điểm} điểm` hoặc `{điểm} {nhãn}` theo `seasonScoreUnit`. */
export function formatSeasonScore(score: number, role: MetricRole): string {
  return `${score} ${seasonScoreUnit(role)}`;
}
