/** Mảnh zod dùng chung giữa các file route: id trong đường dẫn và trong body, ngày VN. */

import { z } from 'zod';

/** Số nguyên dương vừa cột Int của PostgreSQL. */
export const int32Id = z.number().int().positive().max(2_147_483_647);

/** `:id` trong đường dẫn (chuỗi → số). */
export const idParams = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

// Chỉ kiểm tra dạng ở đây; ngày không tồn tại (30/02) do src/server/lib/time.ts bắt.
export const VN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Mã mùa `YYYY-MM` (tháng 01–12) trong query. */
export const SEASON_ID = /^\d{4}-(0[1-9]|1[0-2])$/;
