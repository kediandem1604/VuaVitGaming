/**
 * Khoá thuê của bộ hẹn giờ (spec §4.4, §4.9): chỉ một tiến trình chạy các việc
 * định kỳ, phòng khi deploy có hai bản chạy chồng nhau. Không dùng advisory lock
 * vì Prisma luân phiên nhiều kết nối; thay vào đó một dòng `scheduler_lease`
 * (id = 1) ghi ai giữ và giữ tới khi nào.
 */

import type { Ctx } from '../ctx.js';

/** Khoá hết hạn sau chừng này nếu người giữ không gia hạn (bộ hẹn giờ gia hạn mỗi 60 s). */
export const DEFAULT_LEASE_TTL_MS = 90_000;

/**
 * Lấy (hoặc gia hạn) khoá cho `holderId`: thành công khi chưa có khoá, khoá đã hết
 * hạn, hoặc chính mình đang giữ. Một câu SQL duy nhất nên hai tiến trình tranh
 * nhau cũng chỉ một bên thắng. "Bây giờ" là `ctx.now()` (không phải `now()` của
 * DB) để test điều khiển được thời gian.
 */
export async function tryAcquireLease(ctx: Ctx, holderId: string, ttlMs = DEFAULT_LEASE_TTL_MS): Promise<boolean> {
  const now = ctx.now();
  const rows = await ctx.db.$queryRaw<{ id: number }[]>`
    INSERT INTO scheduler_lease (id, holder, expires_at)
    VALUES (1, ${holderId}, ${now}::timestamptz + ${ttlMs}::int * interval '1 millisecond')
    ON CONFLICT (id) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
    WHERE scheduler_lease.expires_at < ${now}::timestamptz OR scheduler_lease.holder = ${holderId}
    RETURNING id
  `;
  return rows.length > 0;
}
