/**
 * Treo thưởng (spec treo thưởng §5, §6, §8): quản trị mục cho mod và admin; thẻ treo thưởng của buổi
 * và nhận thưởng cho thành viên; hàng chờ, duyệt/từ chối, huỷ duyệt lần nhận cho mod và admin. Chỉ
 * kiểm tra DẠNG body/query ở đây (strict — khoá lạ bị từ chối); độ dài, khoảng điểm, role, buổi, lý
 * do và luật nhận do service báo lỗi tiếng Việt.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BountyClaimDto, BountyDto, SessionBountiesDto } from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import { createBounty, deleteBounty, listBounties, updateBounty } from '../../modules/bounties/admin.js';
import {
  claimBounty,
  getSessionBounties,
  listMyBountyClaims,
  listPendingBountyClaims,
  listRecentlyApprovedBountyClaims,
  reviewBountyClaim,
  revokeBountyClaim,
} from '../../modules/bounties/claims.js';
import { currentMember, requireMember, requireMod } from '../auth-plugin.js';
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

/** `:id` lạ (chữ, 0) là một mục (buổi, lần nhận) không tồn tại — 404 như id không có trong DB. */
function bountyId(params: unknown): number {
  const parsed = idParams.safeParse(params);
  if (!parsed.success) throw appError('NOT_FOUND');
  return parsed.data.id;
}

const pathId = idParams.shape.id;
/** `/api/sessions/:id/bounties/:bountyId/claim` — id lạ → 404. */
const claimParams = z.object({ id: pathId, bountyId: pathId });

const mineQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });
/** `pending` = hàng chờ duyệt, `approved` = "Đã duyệt gần đây"; trạng thái khác → `VALIDATION`. */
const adminListQuery = z.object({ status: z.enum(['pending', 'approved']) });
/** Duyệt: `reason` chỉ dùng khi từ chối (thiếu → service báo "Cần ghi lý do từ chối"). */
const reviewBody = z.object({ approve: z.boolean(), reason: z.string().optional() }).strict();
const revokeBody = z.object({ reason: z.string() }).strict();

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

  // --- Thành viên: thẻ treo thưởng của buổi, nhận, "Treo thưởng của tôi" ---

  app.get('/api/sessions/:id/bounties', { preHandler: requireMember }, async (request): Promise<SessionBountiesDto> =>
    getSessionBounties(app.ctx, currentMember(request).id, bountyId(request.params)),
  );

  app.post('/api/sessions/:id/bounties/:bountyId/claim', { preHandler: requireMember }, async (request, reply) => {
    const parsed = claimParams.safeParse(request.params);
    if (!parsed.success) throw appError('NOT_FOUND');
    const claim = await claimBounty(app.ctx, currentMember(request).id, parsed.data.id, parsed.data.bountyId, 'web');
    return reply.code(201).send(claim);
  });

  app.get('/api/bounty-claims/mine', { preHandler: requireMember }, async (request): Promise<BountyClaimDto[]> => {
    const { limit } = mineQuery.parse(request.query);
    return listMyBountyClaims(app.ctx, currentMember(request).id, limit);
  });

  // --- Duyệt (mod/admin) ---

  app.get('/api/admin/bounty-claims', { preHandler: requireMod }, async (request): Promise<BountyClaimDto[]> => {
    const { status } = adminListQuery.parse(request.query);
    return status === 'pending' ? listPendingBountyClaims(app.ctx) : listRecentlyApprovedBountyClaims(app.ctx);
  });

  app.post('/api/admin/bounty-claims/:id/review', { preHandler: requireMod }, async (request, reply) => {
    const id = bountyId(request.params);
    const { approve, reason } = reviewBody.parse(request.body);
    const me = currentMember(request);
    await reviewBountyClaim(app.ctx, { id: me.id, accessLevel: me.accessLevel }, id, approve ? { approve: true } : { approve: false, reason: reason ?? '' });
    return reply.code(204).send();
  });

  app.post('/api/admin/bounty-claims/:id/revoke', { preHandler: requireMod }, async (request, reply) => {
    const id = bountyId(request.params);
    const { reason } = revokeBody.parse(request.body);
    const me = currentMember(request);
    await revokeBountyClaim(app.ctx, { id: me.id, accessLevel: me.accessLevel }, id, reason);
    return reply.code(204).send();
  });
}
