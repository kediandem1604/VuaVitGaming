/**
 * Mã `custom_id` của nút và menu Discord (global constraints):
 *   `att:join:<sessionId>`  `att:leave:<sessionId>`  `vote:<roundId>:<categoryId>`
 *   `bounty:claim:<sessionId>` (menu "Tôi đã hoàn thành…" trong `#treo-thưởng`)
 *
 * `parseCustomId` là ranh giới tin cậy với dữ liệu Discord gửi về: mọi chuỗi không
 * đúng dạng → `null`, không bao giờ ném lỗi. Id phải là số nguyên dương ở dạng
 * chính tắc (không số 0 đứng đầu, không dấu, không khoảng trắng) — đúng như
 * `encodeCustomId` sinh ra, nên encode → parse là một vòng khép kín.
 */

export type CustomIdData =
  | { kind: 'att'; action: 'join' | 'leave'; sessionId: number }
  | { kind: 'vote'; roundId: number; categoryId: number }
  | { kind: 'bounty'; sessionId: number };

/** Giới hạn độ dài `custom_id` của Discord. */
const MAX_LENGTH = 100;

const POSITIVE_INT = /^[1-9]\d*$/;

export function encodeCustomId(d: CustomIdData): string {
  if (d.kind === 'att') return `att:${d.action}:${assertId(d.sessionId)}`;
  if (d.kind === 'bounty') return `bounty:claim:${assertId(d.sessionId)}`;
  return `vote:${assertId(d.roundId)}:${assertId(d.categoryId)}`;
}

export function parseCustomId(s: string): CustomIdData | null {
  if (s.length > MAX_LENGTH) return null;
  const parts = s.split(':');
  if (parts.length !== 3) return null;
  const [kind, second, third] = parts;

  if (kind === 'att') {
    if (second !== 'join' && second !== 'leave') return null;
    const sessionId = parseId(third);
    return sessionId === null ? null : { kind: 'att', action: second, sessionId };
  }
  if (kind === 'vote') {
    const roundId = parseId(second);
    const categoryId = parseId(third);
    return roundId === null || categoryId === null ? null : { kind: 'vote', roundId, categoryId };
  }
  if (kind === 'bounty') {
    if (second !== 'claim') return null;
    const sessionId = parseId(third);
    return sessionId === null ? null : { kind: 'bounty', sessionId };
  }
  return null;
}

function parseId(raw: string | undefined): number | null {
  if (raw === undefined || !POSITIVE_INT.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Lỗi lập trình (id không phải số nguyên dương) nổ ngay khi dựng nút, không đợi tới lúc bấm. */
function assertId(n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Id trong custom id phải là số nguyên dương: ${n}`);
  return n;
}
