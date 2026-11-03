/**
 * Chế độ chơi cho trang quản trị (spec §6.5: tên tiếng Việt của các chế độ chưa được xác
 * minh — admin sửa được; chế độ không chơi thì tắt). `key` và tên tiếng Anh cố định theo
 * dữ liệu mẫu; nạp lại dữ liệu mẫu không bao giờ ghi đè chỉnh sửa của admin.
 *
 * Chế độ tắt không hiện trong form tạo buổi / hạng mục (`GET /api/modes` chỉ trả chế độ
 * bật — `listActiveModes` ở module buổi chơi) và không tạo buổi mới được; buổi, role,
 * hạng mục đã gắn với chế độ đó giữ nguyên.
 */

import { z } from 'zod';
import type { AdminModeDto } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';

const MODE_SELECT = { id: true, key: true, nameVi: true, nameEn: true, active: true } as const;

/** Mọi chế độ chơi, kể cả đang tắt, theo id tăng dần (thứ tự dữ liệu mẫu). */
export function listAllModes(ctx: Ctx): Promise<AdminModeDto[]> {
  return ctx.db.gameMode.findMany({ select: MODE_SELECT, orderBy: { id: 'asc' } });
}

export interface ModePatch {
  /** Cắt khoảng trắng, 1–60 ký tự. */
  nameVi?: string;
  active?: boolean;
}

const NAME_MESSAGE = 'Tên tiếng Việt phải từ 1 đến 60 ký tự';

const patchSchema = z
  .object({
    nameVi: z.string().trim().min(1, NAME_MESSAGE).max(60, NAME_MESSAGE).optional(),
    active: z.boolean().optional(),
  })
  .strict();

/** Lỗi zod không có thông báo riêng (sai kiểu, trường lạ…) → thông báo chung tiếng Việt. */
const defaultErrorMap: z.ZodErrorMap = () => ({ message: 'Dữ liệu không hợp lệ' });

/** Đổi tên tiếng Việt và/hoặc bật/tắt một chế độ. Dữ liệu sai → `VALIDATION`; id không có → `NOT_FOUND`. */
export async function updateMode(ctx: Ctx, id: number, patch: ModePatch): Promise<AdminModeDto> {
  const parsed = patchSchema.safeParse(patch, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);

  const existing = await ctx.db.gameMode.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw appError('NOT_FOUND');
  return ctx.db.gameMode.update({ where: { id }, data: parsed.data, select: MODE_SELECT });
}
