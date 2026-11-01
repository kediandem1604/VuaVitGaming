/**
 * Tổ chức offline (spec offline): quản trị sự kiện cho mod và admin; danh sách sắp tới và vote cho mọi
 * thành viên. Chỉ kiểm tra DẠNG body ở đây (strict — khoá lạ bị từ chối); độ dài, giờ, hạn vote do
 * service báo lỗi tiếng Việt.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminOfflineEventDto, OfflineEventDto } from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import {
  createOfflineEvent,
  deleteOfflineEvent,
  listOfflineEventsAdmin,
  listUpcomingOfflineEvents,
  updateOfflineEvent,
  voteOfflineEvent,
} from '../../modules/offline/service.js';
import { currentMember, requireMember, requireMod } from '../auth-plugin.js';
import { idParams } from '../schemas.js';

// Kiểu của từng trường do service kiểm tra (để báo đúng câu của trường đó, không phải câu chung).
const anyValue = z.custom<string>(() => true);
const createBody = z
  .object({ title: anyValue, startsAt: anyValue, place: anyValue, description: anyValue.nullish(), voteDeadline: anyValue.nullish() })
  .strict();
const patchBody = z
  .object({
    title: anyValue.optional(),
    startsAt: anyValue.optional(),
    place: anyValue.optional(),
    description: anyValue.nullish(),
    voteDeadline: anyValue.nullish(),
    closed: z.boolean().optional(),
  })
  .strict();
const voteBody = z.object({ going: z.boolean() }).strict();

/** `:id` lạ (chữ, 0) là một sự kiện không tồn tại — 404 như id không có trong DB. */
function eventId(params: unknown): number {
  const parsed = idParams.safeParse(params);
  if (!parsed.success) throw appError('NOT_FOUND');
  return parsed.data.id;
}

export async function offlineRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/offline-events', { preHandler: requireMod }, async (): Promise<AdminOfflineEventDto[]> => listOfflineEventsAdmin(app.ctx));

  app.post('/api/admin/offline-events', { preHandler: requireMod }, async (request, reply) => {
    const input = createBody.parse(request.body);
    return reply.code(201).send(await createOfflineEvent(app.ctx, currentMember(request).id, input));
  });

  app.patch('/api/admin/offline-events/:id', { preHandler: requireMod }, async (request): Promise<AdminOfflineEventDto> => {
    const id = eventId(request.params);
    return updateOfflineEvent(app.ctx, id, patchBody.parse(request.body));
  });

  app.delete('/api/admin/offline-events/:id', { preHandler: requireMod }, async (request, reply) => {
    await deleteOfflineEvent(app.ctx, eventId(request.params));
    return reply.code(204).send();
  });

  app.get('/api/offline-events/upcoming', { preHandler: requireMember }, async (request): Promise<OfflineEventDto[]> =>
    listUpcomingOfflineEvents(app.ctx, currentMember(request).id),
  );

  app.put('/api/offline-events/:id/vote', { preHandler: requireMember }, async (request): Promise<OfflineEventDto> => {
    const id = eventId(request.params);
    const { going } = voteBody.parse(request.body);
    return voteOfflineEvent(app.ctx, currentMember(request).id, id, going);
  });
}
