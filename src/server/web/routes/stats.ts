/**
 * Khai điểm, duyệt, bảng xếp hạng, Đại sảnh hoá thân và mùa qua HTTP (spec §4.6, §4.7);
 * highlight kèm lần khai (spec highlight §8). Cùng gọi một service với lệnh slash nên khai
 * trên web hay `/baocao` cho kết quả như nhau. Thân ghi là JSON `.strict()`, trừ highlight
 * gửi lên dưới dạng body thô với content-type video/ảnh (guard JSON trong app.ts đã cho qua
 * đúng route này; parser buffer chỉ đăng ký trong plugin này). Mùa trong query là `YYYY-MM`,
 * mặc định mùa hiện tại theo giờ VN. Chỉ kiểm tra DẠNG ở đây — quy tắc nghiệp vụ (cửa sổ
 * 3 ngày, giới hạn của role, mùa đã chốt, ai được duyệt, loại và dung lượng file…) do
 * service báo với thông báo riêng.
 */

import type { FastifyError, FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HallDto, HeldRoleDto, HighlightConfigDto, LeaderboardRowDto, ReportDto, SeasonDto } from '../../../shared/api-types.js';
import { HIGHLIGHT_CONTENT_TYPES } from '../../../shared/highlight.js';
import { appError } from '../../lib/errors.js';
import { seasonIdOf, toVnDate } from '../../lib/time.js';
import { listSeasons } from '../../modules/seasons/service.js';
import { attachHighlight, highlightConfig } from '../../modules/stats/highlight.js';
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

/**
 * Content-type được nhận ở `PUT /api/reports/:id/highlight` (guard JSON trong app.ts dùng cùng
 * danh sách) — một danh sách dùng chung với web (`src/shared/highlight.ts`) để ô chọn file và
 * route không lệch nhau. Chỉ để qua cửa: loại thật của file do service nhận diện theo nội dung.
 */
export const HIGHLIGHT_TYPES: readonly string[] = HIGHLIGHT_CONTENT_TYPES;
/** Mẫu route tải highlight — guard JSON trong app.ts so đúng mẫu này (route đã khớp) để cho body thô đi qua. */
export const HIGHLIGHT_UPLOAD_ROUTE = '/api/reports/:id/highlight';
/**
 * Trần của app là 50 MiB (spec highlight §5); thêm 64 KiB để body đúng 50 MiB qua được —
 * service kiểm giới hạn hiện hành của server Discord (10 hay 50 MiB) và báo "Highlight tối đa N MB".
 */
const HIGHLIGHT_BODY_LIMIT = 50 * 1024 * 1024 + 64 * 1024; // 52 494 336
/**
 * Bucket giới hạn tốc độ riêng: mỗi lần tải lên giữ tới 50 MiB trong bộ nhớ máy chủ 1 GB, nên
 * chặt hơn hẳn 120/phút chung; tách bucket để người tải highlight không làm các route /api
 * khác của cùng IP (nhiều người sau một NAT) bị chặn. Thân lỗi 429 vẫn là của app.
 */
const HIGHLIGHT_RATE_LIMIT = { max: 6, timeWindow: '10 minutes' };

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
  app.addContentTypeParser([...HIGHLIGHT_TYPES], { parseAs: 'buffer', bodyLimit: HIGHLIGHT_BODY_LIMIT }, (_request, body, done) => done(null, body));

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

  // --- Highlight kèm lần khai ---

  app.get('/api/reports/highlight-config', { preHandler: requireMember }, async (): Promise<HighlightConfigDto> => highlightConfig(app.ctx));

  app.put(
    HIGHLIGHT_UPLOAD_ROUTE,
    {
      // Kiểm đăng nhập ở onRequest — TRƯỚC khi đọc body — để người lạ không bắt máy chủ giữ
      // tới 50 MiB trong bộ nhớ rồi mới nhận 401 (các route JSON kiểm ở preHandler vì body nhỏ).
      onRequest: requireMember,
      errorHandler: highlightUploadErrorHandler,
      config: { rateLimit: HIGHLIGHT_RATE_LIMIT },
    },
    async (request): Promise<ReportDto> => {
      const { id } = idParams.parse(request.params);
      // Body không phải buffer (vd gửi JSON) → cùng lỗi với file không nhận diện được.
      if (!Buffer.isBuffer(request.body)) throw appError('INVALID_HIGHLIGHT');
      return attachHighlight(app.ctx, currentMember(request).id, id, { data: request.body });
    },
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

/**
 * Body vượt `bodyLimit` → Fastify ném 413 trước khi vào handler; với highlight thì đó là
 * "file quá lớn" (400 HIGHLIGHT_TOO_LARGE, câu dự phòng "Highlight quá lớn" vì chưa hỏi được
 * giới hạn hiện hành — body đã vượt cả trần 50 MiB của app). Ném tiếp để handler lỗi chung
 * của app định dạng phản hồi (Fastify chuyển lỗi ném từ đây lên handler cha).
 */
function highlightUploadErrorHandler(err: FastifyError): never {
  if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') throw appError('HIGHLIGHT_TOO_LARGE');
  throw err;
}
