/**
 * Treo thưởng (spec treo thưởng §5): quản trị mục cho mod và admin. Chỉ kiểm tra DẠNG body ở
 * đây (strict — khoá lạ bị từ chối); độ dài, khoảng điểm, role và buổi do service báo lỗi
 * tiếng Việt.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BountyDto } from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import { createBounty, deleteBounty, listBounties, updateBounty } from '../../modules/bounties/admin.js';
import { currentMember, requireMod } from '../auth-plugin.js';
import { idParams, int32Id } from '../schemas.js';

// Điểm chỉ kiểm tra là số — khoảng 1–50 do service báo ("Điểm phải từ 1 đến 50").
const createBody = z
  .object({
    title: z.string(),
    description: z.string().nullish(),
    points: z.number(),
    roleId: int32Id.nullable(),
    sessionId: int32Id.nullable(),
  })
  .strict();

const patchBody = z
  .object({
    title: z.string().optional(),
    description: z.string().nullish(),
    points: z.number().optional(),
    roleId: int32Id.nullable().optional(),
    sessionId: int32Id.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

/** `:id` lạ (chữ, 0) là một mục không tồn tại — 404 như id không có trong DB. */
function bountyId(params: unknown): number {
  const parsed = idParams.safeParse(params);
  if (!parsed.success) throw appError('NOT_FOUND');
  return parsed.data.id;
}

export async function bountyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/bounties', { preHandler: requireMod }, async (): Promise<BountyDto[]> => listBounties(app.ctx));

  app.post('/api/admin/bounties', { preHandler: requireMod }, async (request, reply) => {
    const input = createBody.parse(request.body);
    return reply.code(201).send(await createBounty(app.ctx, currentMember(request).id, input));
  });

  app.patch('/api/admin/bounties/:id', { preHandler: requireMod }, async (request): Promise<BountyDto> => {
    const id = bountyId(request.params);
    return updateBounty(app.ctx, id, patchBody.parse(request.body));
  });

  app.delete('/api/admin/bounties/:id', { preHandler: requireMod }, async (request, reply) => {
    await deleteBounty(app.ctx, bountyId(request.params));
    return reply.code(204).send();
  });
}
