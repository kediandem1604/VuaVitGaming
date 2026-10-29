/**
 * Ngày nhân điểm (spec ngày nhân điểm §4): quản trị chỉ cho admin; danh sách ngày sắp tới (banner) cho
 * mọi thành viên. Chỉ kiểm tra DẠNG body ở đây (strict — khoá lạ bị từ chối); ngày, khoảng hệ số và độ
 * dài lời nhắn do service báo lỗi tiếng Việt.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminMultiplierDayDto, MultiplierDayDto } from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import {
  createMultiplierDay,
  deleteMultiplierDay,
  listMultiplierDaysAdmin,
  listUpcomingMultiplierDays,
  updateMultiplierDay,
} from '../../modules/multipliers/service.js';
import { currentMember, requireAdmin, requireMember } from '../auth-plugin.js';
import { idParams } from '../schemas.js';

// Hệ số chỉ kiểm tra là số — khoảng 2–5 do service báo ("Hệ số phải từ ×2 đến ×5").
const createBody = z.object({ day: z.string(), multiplier: z.number(), message: z.string().nullish() }).strict();
const patchBody = z
  .object({ day: z.string().optional(), multiplier: z.number().optional(), message: z.string().nullish() })
  .strict();

/** `:id` lạ (chữ, 0) là một ngày không tồn tại — 404 như id không có trong DB. */
function dayId(params: unknown): number {
  const parsed = idParams.safeParse(params);
  if (!parsed.success) throw appError('NOT_FOUND');
  return parsed.data.id;
}

export async function multiplierRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/multiplier-days', { preHandler: requireAdmin }, async (): Promise<AdminMultiplierDayDto[]> =>
    listMultiplierDaysAdmin(app.ctx),
  );

  app.post('/api/admin/multiplier-days', { preHandler: requireAdmin }, async (request, reply) => {
    const input = createBody.parse(request.body);
    return reply.code(201).send(await createMultiplierDay(app.ctx, currentMember(request).id, input));
  });

  app.patch('/api/admin/multiplier-days/:id', { preHandler: requireAdmin }, async (request): Promise<AdminMultiplierDayDto> => {
    const id = dayId(request.params);
    return updateMultiplierDay(app.ctx, id, patchBody.parse(request.body));
  });

  app.delete('/api/admin/multiplier-days/:id', { preHandler: requireAdmin }, async (request, reply) => {
    await deleteMultiplierDay(app.ctx, dayId(request.params));
    return reply.code(204).send();
  });

  app.get('/api/multiplier-days/upcoming', { preHandler: requireMember }, async (): Promise<MultiplierDayDto[]> =>
    listUpcomingMultiplierDays(app.ctx),
  );
}
