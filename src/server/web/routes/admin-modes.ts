/**
 * Chế độ chơi cho admin: xem mọi chế độ (kể cả đang tắt), đổi tên tiếng Việt, bật/tắt.
 * `GET /api/modes` (chế độ đang bật, cho mọi thành viên) nằm cùng các route buổi chơi.
 * Chỉ kiểm tra DẠNG ở đây; độ dài tên do service báo.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminModeDto } from '../../../shared/api-types.js';
import { listAllModes, updateMode } from '../../modules/modes/service.js';
import { requireAdmin } from '../auth-plugin.js';
import { idParams } from '../schemas.js';

const patchBody = z.object({ nameVi: z.string().optional(), active: z.boolean().optional() }).strict();

export async function adminModeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/modes', { preHandler: requireAdmin }, async (): Promise<AdminModeDto[]> => listAllModes(app.ctx));

  app.patch('/api/admin/modes/:id', { preHandler: requireAdmin }, async (request): Promise<AdminModeDto> => {
    const { id } = idParams.parse(request.params);
    return updateMode(app.ctx, id, patchBody.parse(request.body));
  });
}
