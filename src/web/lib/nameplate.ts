/**
 * Bảng tên trên đầu nhân vật (spec §4.8): chữ tự co theo độ dài, tên quá dài cắt
 * bằng "…". Đếm theo code point (`Array.from`) chứ không theo `.length`, để một
 * emoji (2 đơn vị UTF-16) tính là một ký tự và không bị cắt đôi.
 */

/** Cỡ chữ bảng tên: ≤ 10 ký tự → 18px, ≤ 16 → 15px, còn lại → 12px. */
export function nameplateFontSize(name: string): number {
  const length = Array.from(name).length;
  if (length <= 10) return 18;
  if (length <= 16) return 15;
  return 12;
}

/** Tên dài hơn `max` ký tự → `max − 1` ký tự đầu + "…"; ngắn hơn thì giữ nguyên. */
export function truncateName(name: string, max = 24): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  return `${chars.slice(0, max - 1).join('')}…`;
}
