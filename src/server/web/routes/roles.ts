/**
 * Danh mục role qua HTTP: thành viên xem role đang bật và ảnh của role; admin thêm,
 * sửa, đổi/xoá ảnh. Ảnh gửi lên dưới dạng body thô với content-type ảnh (guard JSON
 * trong app.ts đã cho qua đúng route này); parser buffer chỉ đăng ký trong plugin này.
 */

import { createHash } from 'node:crypto';
import type { FastifyError, FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleDto } from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import { clearRoleImage, getRoleImage, setRoleImage } from '../../modules/roles/image.js';
import { createRole, listRoles, updateRole } from '../../modules/roles/service.js';
import { currentMember, requireAdmin, requireMember } from '../auth-plugin.js';
import { idParams } from '../schemas.js';

/** Content-type ảnh được nhận ở `PUT /api/admin/roles/:id/image` (guard JSON trong app.ts dùng cùng danh sách). */
export const ROLE_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
/** Hơn 1 MiB một chút để body đúng 1 MiB qua được; service kiểm giới hạn chính xác. */
const IMAGE_BODY_LIMIT = 1_100_000;
/** Ảnh đổi hiếm; trình duyệt giữ 5 phút rồi hỏi lại bằng ETag. */
const IMAGE_CACHE_CONTROL = 'public, max-age=300';
/**
 * Bucket giới hạn tốc độ riêng cho ảnh role: một lần tải Đại sảnh có thể kéo ~70 ảnh,
 * nhiều người sau một NAT (CGNAT di động) dùng chung IP — nếu tính vào bucket chung
 * 120/phút thì mọi route /api của IP đó (kể cả "Tham gia") sẽ bị chặn. Thân lỗi 429
 * vẫn là của app (route kế thừa `errorResponseBuilder` chung).
 */
const IMAGE_RATE_LIMIT = { max: 600, timeWindow: '1 minute' };

/** `?all=1` → kể cả role đã tắt (chỉ admin; người khác vẫn chỉ thấy role bật). */
const listQuery = z.object({ all: z.literal('1').optional() });

const factionSchema = z.enum(['goose', 'duck', 'neutral']);

// Chỉ kiểm tra dạng ở đây; cắt khoảng trắng, độ dài, khoảng giá trị và key trùng do
// service kiểm tra (có thông báo riêng).
const createBody = z
  .object({
    key: z.string(),
    faction: factionSchema,
    nameVi: z.string(),
    nameEn: z.string(),
    description: z.string().optional(),
    metricLabel: z.string(),
    maxPerGame: z.number().int(),
    mapNote: z.string().nullish(),
    icon: z.string(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    modeKey: z.string().nullish(),
  })
  .strict();

const patchBody = z
  .object({
    faction: factionSchema.optional(),
    nameVi: z.string().optional(),
    nameEn: z.string().optional(),
    description: z.string().optional(),
    metricLabel: z.string().optional(),
    maxPerGame: z.number().int().optional(),
    mapNote: z.string().nullish(),
    icon: z.string().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser([...ROLE_IMAGE_TYPES], { parseAs: 'buffer', bodyLimit: IMAGE_BODY_LIMIT }, (_request, body, done) => done(null, body));

  app.get('/api/roles', { preHandler: requireMember }, async (request): Promise<RoleDto[]> => {
    const { all } = listQuery.parse(request.query);
    const isAdmin = currentMember(request).accessLevel === 'admin';
    return listRoles(app.ctx, { includeInactive: isAdmin && all === '1' });
  });

  app.get('/api/roles/:id/image', { preHandler: requireMember, config: { rateLimit: IMAGE_RATE_LIMIT } }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const image = await getRoleImage(app.ctx, id);
    if (!image) throw appError('NOT_FOUND');

    const etag = `"${createHash('sha1').update(image.buf).digest('hex')}"`;
    reply.header('etag', etag).header('cache-control', IMAGE_CACHE_CONTROL).header('x-content-type-options', 'nosniff');
    if (etagMatches(request.headers['if-none-match'], etag)) return reply.code(304).send();
    return reply.type(image.mime).send(image.buf);
  });

  app.post('/api/admin/roles', { preHandler: requireAdmin }, async (request, reply) => {
    const input = createBody.parse(request.body);
    return reply.code(201).send(await createRole(app.ctx, input));
  });

  app.patch('/api/admin/roles/:id', { preHandler: requireAdmin }, async (request): Promise<RoleDto> => {
    const { id } = idParams.parse(request.params);
    return updateRole(app.ctx, id, patchBody.parse(request.body));
  });

  app.put('/api/admin/roles/:id/image', { preHandler: requireAdmin, errorHandler: imageUploadErrorHandler }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    // Body không phải buffer ảnh (vd gửi JSON, hoặc rỗng) → cùng lỗi với file giả ảnh.
    if (!Buffer.isBuffer(request.body)) throw appError('INVALID_IMAGE');
    await setRoleImage(app.ctx, id, request.body);
    return reply.code(204).send();
  });

  app.delete('/api/admin/roles/:id/image', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await clearRoleImage(app.ctx, id);
    return reply.code(204).send();
  });
}

/**
 * Body vượt `bodyLimit` → Fastify ném 413 trước khi vào handler; với ảnh thì đó là
 * "ảnh quá 1 MB" (400 INVALID_IMAGE). Ném tiếp để handler lỗi chung của app định dạng
 * phản hồi (Fastify chuyển lỗi ném từ đây lên handler cha).
 */
function imageUploadErrorHandler(err: FastifyError): never {
  if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') throw appError('INVALID_IMAGE');
  throw err;
}

/** `If-None-Match` khớp ETag (kể cả dạng yếu `W/"…"`, danh sách phân cách bằng dấu phẩy). */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(',').some((tag) => {
    const t = tag.trim();
    return t === etag || t === `W/${etag}`;
  });
}
