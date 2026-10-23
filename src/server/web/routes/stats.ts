/**
 * Khai điểm, duyệt, bảng xếp hạng, Đại sảnh hoá thân và mùa qua HTTP (spec §4.6, §4.7).
 * Cùng gọi một service với lệnh slash nên khai trên web hay `/baocao` cho kết quả như
 * nhau. Thân ghi là JSON `.strict()`; mùa trong query là `YYYY-MM`, mặc định mùa hiện
 * tại theo giờ VN. Chỉ kiểm tra DẠNG ở đây — quy tắc nghiệp vụ (cửa sổ 3 ngày, giới hạn
 * của role, mùa đã chốt, ai được duyệt…) do service báo với thông báo riêng.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HallDto, HeldRoleDto, LeaderboardRowDto, ReportDto, SeasonDto } from '../../../shared/api-types.js';
import { seasonIdOf, toVnDate } from '../../lib/time.js';
import { listSeasons } from '../../modules/seasons/service.js';
import { getHall, getHeldRoles, getRoleLeaderboard } from '../../modules/stats/leaderboard.js';
import type { LeaderboardRow } from '../../modules/stats/leaderboard.js';
import {
  getReportDto,
  listMyReports,
  listPendingReports,
  reviewReport,
  submitReport,
  updateOwnReport,
} from '../../modules/stats/reports.js';
import { currentMember, requireMember, requireMod } from '../auth-plugin.js';
import { SEASON_ID, VN_DATE, idParams, int32Id } from '../schemas.js';

const reportBody = z
  .object({
    roleId: int32Id,
    // Chỉ cần là số: lẻ/âm/quá giới hạn do service báo riêng kèm giới hạn của role.
    value: z.number(),
    playedOn: z.string().regex(VN_DATE),
    sessionId: int32Id.nullish(),
    note: z.string().nullish(),
  })
  .strict();

/** Sửa lần khai: trường vắng mặt giữ nguyên (vẫn `.strict()`). */
const reportPatchBody = reportBody.partial();

/** `limit` 1–100 (giới hạn trên của service); vắng mặt → mặc định của service. */
const limitQuery = z.coerce.number().int().min(1).max(100).optional();
const seasonQueryParam = z.string().regex(SEASON_ID).optional();

const mineQuery = z.object({ limit: limitQuery });
/** Hàng chờ duyệt là danh sách duy nhất có — trạng thái khác chưa hỗ trợ. */
const pendingQuery = z.object({ status: z.literal('pending') });
const leaderboardQuery = z.object({ roleId: z.coerce.number().int().positive().max(2_147_483_647), season: seasonQueryParam, limit: limitQuery });
const hallQuery = z.object({ season: seasonQueryParam });

/** Duyệt: `reason` chỉ có nghĩa khi từ chối; khi duyệt thì bỏ qua (kể cả chuỗi rỗng). */
const reviewBody = z.object({ approve: z.boolean(), reason: z.string().optional() }).strict();

function toLeaderboardRowDto(r: LeaderboardRow): LeaderboardRowDto {
  return { ...r, lastApprovedAt: r.lastApprovedAt.toISOString() };
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  const currentSeason = (): string => seasonIdOf(toVnDate(app.ctx.now()));

  // --- Khai điểm của tôi ---

  app.post('/api/reports', { preHandler: requireMember }, async (request, reply) => {
    const input = reportBody.parse(request.body);
    const created = await submitReport(app.ctx, currentMember(request).id, input);
    return reply.code(201).send(await getReportDto(app.ctx, created.id));
  });

  app.patch('/api/reports/:id', { preHandler: requireMember }, async (request): Promise<ReportDto> => {
    const { id } = idParams.parse(request.params);
    const patch = reportPatchBody.parse(request.body);
    const updated = await updateOwnReport(app.ctx, currentMember(request).id, id, patch);
    return getReportDto(app.ctx, updated.id);
  });

  app.get('/api/reports/mine', { preHandler: requireMember }, async (request): Promise<ReportDto[]> => {
    const { limit } = mineQuery.parse(request.query);
    return listMyReports(app.ctx, currentMember(request).id, limit);
  });

  app.get('/api/me/titles', { preHandler: requireMember }, async (request): Promise<HeldRoleDto[]> =>
    getHeldRoles(app.ctx, currentMember(request).id, currentSeason()),
  );

  // --- Duyệt (mod/admin) ---

  app.get('/api/admin/reports', { preHandler: requireMod }, async (request): Promise<ReportDto[]> => {
    pendingQuery.parse(request.query);
    return listPendingReports(app.ctx);
  });

  app.post('/api/admin/reports/:id/review', { preHandler: requireMod }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { approve, reason } = reviewBody.parse(request.body);
    const me = currentMember(request);
    const decision = approve ? ({ approve: true } as const) : ({ approve: false, reason: reason ?? '' } as const);
    await reviewReport(app.ctx, { id: me.id, accessLevel: me.accessLevel }, id, decision);
    return reply.code(204).send();
  });

  // --- Bảng xếp hạng, Đại sảnh, mùa ---

  app.get('/api/leaderboard', { preHandler: requireMember }, async (request): Promise<LeaderboardRowDto[]> => {
    const { roleId, season, limit } = leaderboardQuery.parse(request.query);
    const rows = await getRoleLeaderboard(app.ctx, roleId, season ?? currentSeason(), limit);
    return rows.map(toLeaderboardRowDto);
  });

  app.get('/api/hall', { preHandler: requireMember }, async (request): Promise<HallDto> => {
    const { season } = hallQuery.parse(request.query);
    return getHall(app.ctx, season ?? currentSeason());
  });

  app.get('/api/seasons', { preHandler: requireMember }, async (): Promise<SeasonDto[]> => listSeasons(app.ctx));
}
