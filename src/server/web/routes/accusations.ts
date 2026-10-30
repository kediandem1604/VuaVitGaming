/**
 * Báo cáo người chơi độc lập qua HTTP (spec 2026-10-31 §B): gửi và "Báo cáo của tôi" cho thành viên;
 * hàng chờ, "Đã duyệt gần đây", duyệt/từ chối, huỷ duyệt cho mod và admin. Chỉ kiểm tra DẠNG ở đây
 * (strict — khoá lạ bị từ chối); bốn trường của báo cáo chỉ cần có mặt — thiếu/sai, tự báo cáo, cửa sổ 3
 * ngày, buổi, giới hạn 10/ngày, quyền và lý do do service báo lỗi tiếng Việt.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StandaloneAccusationDto, StandaloneAccusationInputDto } from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import {
  listMyStandaloneAccusations,
  listPendingStandaloneAccusations,
  listRecentlyApprovedStandaloneAccusations,
  reviewStandaloneAccusation,
  revokeStandaloneAccusation,
  submitStandaloneAccusation,
} from '../../modules/stats/standalone-accusations.js';
import { currentMember, requireMember, requireMod } from '../auth-plugin.js';
import { VN_DATE, idParams, int32Id } from '../schemas.js';

const submitBody = z
  .object({
    playedOn: z.string().regex(VN_DATE),
    sessionId: int32Id.nullish(),
    note: z.string().nullish(),
    // Kiểm ở service để báo lời nhắn cụ thể ("Báo cáo cần đủ…", "Không thể tự báo cáo…").
    accusedId: z.unknown(),
    accusedRoleId: z.unknown(),
    victimId: z.unknown(),
    victimFaction: z.unknown(),
  })
  .strict();

const mineQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });
/** `pending` = hàng chờ duyệt, `approved` = "Đã duyệt gần đây"; trạng thái khác → `VALIDATION`. */
const adminListQuery = z.object({ status: z.enum(['pending', 'approved']) });
/** Duyệt: `reason` chỉ dùng khi từ chối (thiếu → service báo "Cần ghi lý do từ chối"). */
const reviewBody = z.object({ approve: z.boolean(), reason: z.string().optional() }).strict();
const revokeBody = z.object({ reason: z.string() }).strict();

/** `:id` lạ (chữ, 0) là báo cáo không tồn tại — 404 như id không có trong DB. */
function accusationId(params: unknown): number {
  const parsed = idParams.safeParse(params);
  if (!parsed.success) throw appError('NOT_FOUND');
  return parsed.data.id;
}

export async function accusationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/accusations', { preHandler: requireMember }, async (request, reply) => {
    const input = submitBody.parse(request.body) as StandaloneAccusationInputDto;
    return reply.code(201).send(await submitStandaloneAccusation(app.ctx, currentMember(request).id, input));
  });

  app.get('/api/accusations/mine', { preHandler: requireMember }, async (request): Promise<StandaloneAccusationDto[]> => {
    const { limit } = mineQuery.parse(request.query);
    return listMyStandaloneAccusations(app.ctx, currentMember(request).id, limit);
  });

  app.get('/api/admin/accusations', { preHandler: requireMod }, async (request): Promise<StandaloneAccusationDto[]> => {
    const { status } = adminListQuery.parse(request.query);
    return status === 'pending' ? listPendingStandaloneAccusations(app.ctx) : listRecentlyApprovedStandaloneAccusations(app.ctx);
  });

  app.post('/api/admin/accusations/:id/review', { preHandler: requireMod }, async (request, reply) => {
    const id = accusationId(request.params);
    const { approve, reason } = reviewBody.parse(request.body);
    const me = currentMember(request);
    await reviewStandaloneAccusation(app.ctx, { id: me.id, accessLevel: me.accessLevel }, id, approve ? { approve: true } : { approve: false, reason: reason ?? '' });
    return reply.code(204).send();
  });

  app.post('/api/admin/accusations/:id/revoke', { preHandler: requireMod }, async (request, reply) => {
    const id = accusationId(request.params);
    const { reason } = revokeBody.parse(request.body);
    const me = currentMember(request);
    await revokeStandaloneAccusation(app.ctx, { id: me.id, accessLevel: me.accessLevel }, id, reason);
    return reply.code(204).send();
  });
}
