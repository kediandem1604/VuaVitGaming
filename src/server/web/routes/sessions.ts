/**
 * Buổi chơi qua HTTP: danh sách theo ngày VN, điểm danh (giống hệt bấm nút Discord
 * vì cùng gọi `setAttendance`), mod tạo/sửa/huỷ/kết thúc buổi (kết thúc = chọn hạng mục
 * tri ân và mở vote); chế độ chơi cho form tạo buổi.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EndOptionDto, ModeDto, SessionDto } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { toVnDate, vnDateTimeToUtc } from '../../lib/time.js';
import { avatarUrlsByMemberId } from '../../modules/members/service.js';
import { endOptions } from '../../modules/mvp/categories.js';
import { endSession } from '../../modules/sessions/end.js';
import {
  cancelSession,
  createSession,
  listActiveModes,
  listSessionsOnVnDate,
  setAttendance,
  updateSession,
} from '../../modules/sessions/service.js';
import type { SessionView } from '../../ports.js';
import { currentMember, requireMember, requireMod } from '../auth-plugin.js';
import { VN_DATE, idParams, int32Id } from '../schemas.js';

const VN_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const listQuery = z.object({ date: z.string().regex(VN_DATE).optional() });

const attendanceBody = z.object({ going: z.boolean() }).strict();

/**
 * Hạng mục mở vote khi kết thúc: rỗng = kết thúc không vote; tối đa 25 (mỗi hạng mục
 * một tin Discord). Muốn hạng mục mặc định thì client gửi danh sách tick sẵn của
 * `end-options` — không có mặc định ngầm ở API.
 */
const endBody = z.object({ categoryIds: z.array(int32Id).max(25) }).strict();

const createBody = z
  .object({
    date: z.string().regex(VN_DATE),
    time: z.string().regex(VN_TIME),
    modeId: z.number().int(),
    capacity: z.number().optional(),
    roomCode: z.string().nullish(),
    note: z.string().nullish(),
  })
  .strict();

/**
 * Sửa buổi: chỉ gửi trường muốn đổi. Giờ bắt đầu đổi bằng ngày + giờ VN, luôn đi cùng
 * nhau; `null` (hoặc chuỗi rỗng) xoá mã phòng / ghi chú. Thân rỗng `{}` không đổi gì.
 */
const updateBody = z
  .object({
    date: z.string().regex(VN_DATE).optional(),
    time: z.string().regex(VN_TIME).optional(),
    capacity: z.number().optional(),
    roomCode: z.string().nullish(),
    note: z.string().nullish(),
  })
  .strict()
  .refine((body) => (body.date === undefined) === (body.time === undefined));

export function toSessionDto(view: SessionView, avatars: ReadonlyMap<number, string | null>, meId: number): SessionDto {
  return {
    id: view.id,
    startsAt: view.startsAt.toISOString(),
    modeName: view.modeName,
    capacity: view.capacity,
    roomCode: view.roomCode,
    note: view.note,
    status: view.status,
    attendees: view.attendees.map((a) => ({
      memberId: a.memberId,
      displayName: a.displayName,
      avatarUrl: avatars.get(a.memberId) ?? null,
    })),
    myStatus: view.attendees.some((a) => a.memberId === meId) ? 'going' : null,
  };
}

/** Avatar của mọi người tham gia trong các buổi này — một truy vấn cho cả danh sách. */
function avatarsOf(ctx: Ctx, views: SessionView[]): Promise<Map<number, string | null>> {
  const ids = [...new Set(views.flatMap((v) => v.attendees.map((a) => a.memberId)))];
  return avatarUrlsByMemberId(ctx, ids);
}

async function toDtos(ctx: Ctx, views: SessionView[], meId: number): Promise<SessionDto[]> {
  const avatars = await avatarsOf(ctx, views);
  return views.map((v) => toSessionDto(v, avatars, meId));
}

async function toDto(ctx: Ctx, view: SessionView, meId: number): Promise<SessionDto> {
  return toSessionDto(view, await avatarsOf(ctx, [view]), meId);
}

/** Ngày + giờ VN → mốc UTC. Dạng đã kiểm tra bằng zod; ngày không tồn tại → 400. */
function toStartsAt(date: string, time: string): Date {
  try {
    return vnDateTimeToUtc(date, time);
  } catch {
    throw appError('VALIDATION', 'Ngày không hợp lệ');
  }
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/modes', { preHandler: requireMember }, async (): Promise<ModeDto[]> => listActiveModes(app.ctx));

  app.get('/api/sessions', { preHandler: requireMember }, async (request) => {
    const { date } = listQuery.parse(request.query);
    const views = await listSessionsOnVnDate(app.ctx, date ?? toVnDate(app.ctx.now()));
    return toDtos(app.ctx, views, currentMember(request).id);
  });

  app.post('/api/sessions/:id/attendance', { preHandler: requireMember }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { going } = attendanceBody.parse(request.body);
    const me = currentMember(request);
    return toDto(app.ctx, await setAttendance(app.ctx, id, me.id, going), me.id);
  });

  app.post('/api/admin/sessions', { preHandler: requireMod }, async (request, reply) => {
    const { date, time, ...rest } = createBody.parse(request.body);
    const me = currentMember(request);
    const view = await createSession(app.ctx, me.id, { startsAt: toStartsAt(date, time), ...rest });
    return reply.code(201).send(await toDto(app.ctx, view, me.id));
  });

  app.patch('/api/admin/sessions/:id', { preHandler: requireMod }, async (request): Promise<SessionDto> => {
    const { id } = idParams.parse(request.params);
    const { date, time, ...rest } = updateBody.parse(request.body);
    const me = currentMember(request);
    const startsAt = date !== undefined && time !== undefined ? toStartsAt(date, time) : undefined;
    const view = await updateSession(app.ctx, me.id, id, { ...rest, ...(startsAt ? { startsAt } : {}) });
    return toDto(app.ctx, view, me.id);
  });

  app.post('/api/admin/sessions/:id/cancel', { preHandler: requireMod }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await cancelSession(app.ctx, id);
    return reply.code(204).send();
  });

  app.get('/api/admin/sessions/:id/end-options', { preHandler: requireMod }, async (request): Promise<EndOptionDto[]> => {
    const { id } = idParams.parse(request.params);
    return endOptions(app.ctx, id);
  });

  app.post('/api/admin/sessions/:id/end', { preHandler: requireMod }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { categoryIds } = endBody.parse(request.body);
    await endSession(app.ctx, id, categoryIds);
    return reply.code(204).send();
  });
}
