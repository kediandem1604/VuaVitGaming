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
