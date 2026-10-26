/**
 * Huy hiệu qua HTTP (spec huy hiệu §7): tường vinh danh và trang thành viên công khai. Cả hai
 * chỉ đọc và đều cần đăng nhập (`requireMember`). Chỉ kiểm tra DẠNG query ở đây; `before` có
 * tồn tại hay không do service báo (`VALIDATION`).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BadgeDto, PublicMemberDto } from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import { MAX_LIMIT, getPublicMember, listBadges } from '../../modules/badges/queries.js';
import { requireMember } from '../auth-plugin.js';
import { idParams } from '../schemas.js';

/** `before` = id dòng cuối trang trước (số nguyên dương vừa Int); `limit` 1..100, vắng mặt → mặc định của service. */
const badgesQuery = z.object({
  before: z.coerce.number().int().positive().max(2_147_483_647).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

export async function badgeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/badges', { preHandler: requireMember }, async (request): Promise<BadgeDto[]> => {
    const { before, limit } = badgesQuery.parse(request.query);
    return listBadges(app.ctx, { before, limit });
  });

  app.get('/api/members/:id', { preHandler: requireMember }, async (request): Promise<PublicMemberDto> => {
    // `:id` không phải số nguyên dương (`abc`, `1.5`, `0`) là một trang không tồn tại — 404 như id lạ,
    // để web hiện cùng một trang "không tìm thấy" (spec §9), không phải lỗi dữ liệu 400.
    const params = idParams.safeParse(request.params);
    if (!params.success) throw appError('NOT_FOUND');
    return getPublicMember(app.ctx, params.data.id);
  });
}
