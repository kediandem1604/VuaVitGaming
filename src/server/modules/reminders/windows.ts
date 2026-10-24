/**
 * Cửa sổ nhắc giờ của một buổi (spec §4.4), tách riêng để module buổi chơi dùng được
 * khi đổi giờ mà không phải import bộ gửi nhắc (bộ gửi nhắc lại import module buổi chơi).
 *
 * Cửa sổ nửa mở: `pre15` khi `startsAt − lead ≤ now < startsAt`, `start` khi
 * `startsAt ≤ now < startsAt + 10 phút`.
 */

import type { ReminderKind } from '@prisma/client';

/** Sau giờ bắt đầu bao lâu thì thôi không nhắc `start` nữa. */
export const START_WINDOW_MS = 10 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

/** Loại nhắc đang đến hạn tại `now` cho buổi bắt đầu lúc `startsAt` (tối đa một loại). */
export function reminderKindsDue(startsAt: Date, now: Date, leadMinutes: number): ReminderKind[] {
  const s = startsAt.getTime();
  const t = now.getTime();
  if (s - leadMinutes * MINUTE_MS <= t && t < s) return ['pre15'];
  if (s <= t && t < s + START_WINDOW_MS) return ['start'];
  return [];
}

/**
 * Loại nhắc mà cửa sổ của nó (theo giờ bắt đầu `startsAt`) chưa mở tại `now`. Đổi giờ
 * buổi thì log của các loại này được xoá để nhắc lại theo giờ mới; loại đã tới hạn theo
 * giờ mới thì giữ log (đã nhắc rồi thì không nhắc lần hai).
 */
export function reminderKindsNotYetDue(startsAt: Date, now: Date, leadMinutes: number): ReminderKind[] {
  const s = startsAt.getTime();
  const t = now.getTime();
  const kinds: ReminderKind[] = [];
  if (t < s - leadMinutes * MINUTE_MS) kinds.push('pre15');
  if (t < s) kinds.push('start');
  return kinds;
}
