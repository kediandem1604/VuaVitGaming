/**
 * Sảnh tri ân qua HTTP (kết quả vote theo ngày VN; các ngày gần đây có kết quả) và
 * mod đóng sớm một đợt vote. Kết thúc buổi (mở vote) nằm cùng các route buổi chơi.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HallOfDayDto } from '../../../shared/api-types.js';
import { toVnDate } from '../../lib/time.js';
import { closeVoteRoundEarly, getDailyHall, listHallDates } from '../../modules/mvp/votes.js';
import { requireMember, requireMod } from '../auth-plugin.js';
import { VN_DATE, idParams } from '../schemas.js';

const dayQuery = z.object({ date: z.string().regex(VN_DATE).optional() });

/** Trang lịch sử tri ân hiện tối đa 30 ngày gần nhất có kết quả. */
const HALL_DATES_LIMIT = 30;

export async function mvpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/mvp/day', { preHandler: requireMember }, async (request): Promise<HallOfDayDto> => {
    const { date } = dayQuery.parse(request.query);
    return getDailyHall(app.ctx, date ?? toVnDate(app.ctx.now()));
  });

  app.get('/api/mvp/dates', { preHandler: requireMember }, async (): Promise<string[]> =>
    listHallDates(app.ctx, HALL_DATES_LIMIT),
  );

  app.post('/api/admin/vote-rounds/:id/close', { preHandler: requireMod }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await closeVoteRoundEarly(app.ctx, id);
    return reply.code(204).send();
  });
}
