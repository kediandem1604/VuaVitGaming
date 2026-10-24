/** Quản trị hạng mục tri ân (chỉ admin): xem, thêm, sửa / ẩn. */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AwardCategoryDto } from '../../../shared/api-types.js';
import { createCategory, listCategories, updateCategory } from '../../modules/mvp/categories.js';
import type { AwardCategoryWithMode } from '../../modules/mvp/categories.js';
import { requireAdmin } from '../auth-plugin.js';
import { idParams, int32Id } from '../schemas.js';

/** `?all=1` → kể cả hạng mục đã ẩn. */
const listQuery = z.object({ all: z.literal('1').optional() });

const scopeSchema = z.enum(['always', 'mode', 'optional']);

// Chỉ kiểm tra dạng ở đây; cắt khoảng trắng, độ dài và quy tắc phạm vi ⇔ chế độ do
// service kiểm tra (có thông báo riêng).
const createBody = z
  .object({
    scope: scopeSchema,
    modeId: int32Id.nullish(),
    name: z.string(),
    description: z.string().nullish(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

const patchBody = z
  .object({
    scope: scopeSchema.optional(),
    modeId: int32Id.nullish(),
    name: z.string().optional(),
    description: z.string().nullish(),
    sortOrder: z.number().int().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export function toCategoryDto(c: AwardCategoryWithMode): AwardCategoryDto {
  return {
    id: c.id,
    scope: c.scope,
    mode: c.mode,
    name: c.name,
    description: c.description,
    active: c.active,
    sortOrder: c.sortOrder,
  };
}

export async function adminCategoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/categories', { preHandler: requireAdmin }, async (request): Promise<AwardCategoryDto[]> => {
    const { all } = listQuery.parse(request.query);
    return (await listCategories(app.ctx, { includeInactive: all === '1' })).map(toCategoryDto);
  });

  app.post('/api/admin/categories', { preHandler: requireAdmin }, async (request, reply) => {
    const input = createBody.parse(request.body);
    return reply.code(201).send(toCategoryDto(await createCategory(app.ctx, input)));
  });

  app.patch('/api/admin/categories/:id', { preHandler: requireAdmin }, async (request): Promise<AwardCategoryDto> => {
    const { id } = idParams.parse(request.params);
    return toCategoryDto(await updateCategory(app.ctx, id, patchBody.parse(request.body)));
  });
}
