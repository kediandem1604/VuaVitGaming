/**
 * Buổi chơi qua HTTP: danh sách theo ngày VN, điểm danh (giống hệt bấm nút Discord
 * vì cùng gọi `setAttendance`), mod tạo/huỷ buổi; chế độ chơi cho form tạo buổi.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ModeDto, SessionDto } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { toVnDate, vnDateTimeToUtc } from '../../lib/time.js';
import { avatarUrlsByMemberId } from '../../modules/members/service.js';
import {
  cancelSession,
  createSession,
  listActiveModes,
  listSessionsOnVnDate,
  setAttendance,
} from '../../modules/sessions/service.js';
import type { SessionView } from '../../ports.js';
import { currentMember, requireMember, requireMod } from '../auth-plugin.js';

// Chỉ kiểm tra dạng ở đây; ngày không tồn tại (30/02) do src/server/lib/time.ts bắt.
const VN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VN_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `:id` phải là số nguyên dương vừa cột Int của PostgreSQL. */
const idParams = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

const listQuery = z.object({ date: z.string().regex(VN_DATE).optional() });

const attendanceBody = z.object({ going: z.boolean() }).strict();

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

  app.post('/api/admin/sessions/:id/cancel', { preHandler: requireMod }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await cancelSession(app.ctx, id);
    return reply.code(204).send();
  });
}
