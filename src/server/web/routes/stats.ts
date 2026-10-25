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

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HallDto, HeldRoleDto, HighlightConfigDto, LeaderboardRowDto, ReportDto, SeasonDto } from '../../../shared/api-types.js';
import { HIGHLIGHT_CONTENT_TYPES, highlightLimitMessage } from '../../../shared/highlight.js';
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
/** Phần dư trên giới hạn dung lượng để body đúng bằng giới hạn vẫn qua cửa (service kiểm chính xác). */
const HIGHLIGHT_LENGTH_SLACK = 64 * 1024;
/**
 * Trần của app là 50 MiB (spec highlight §5) cộng phần dư — chặn cuối cùng khi request không khai
 * `Content-Length` (gửi chunked). Có khai thì cổng của route chặn sớm hơn theo giới hạn hiện hành
 * của server Discord (10 hay 50 MiB); service kiểm lại và báo "Highlight tối đa N MB".
 */
const HIGHLIGHT_BODY_LIMIT = 50 * 1024 * 1024 + HIGHLIGHT_LENGTH_SLACK; // 52 494 336
/**
 * Số lần tải highlight chạy cùng lúc trên cả máy chủ (mọi thành viên, mọi IP): mỗi lần giữ cả
 * file trong bộ nhớ — gấp 2–3 lần dung lượng khi Fastify ghép body và discord.js chép lại — suốt
 * lượt gửi lên Discord, trên máy 1 GB RAM (Render: 512 MB).
 */
const HIGHLIGHT_MAX_IN_FLIGHT = 2;
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

  const uploads = uploadSlots(HIGHLIGHT_MAX_IN_FLIGHT);

  /**
   * Cổng của route tải highlight, chạy ở onRequest sau `requireMember` — TRƯỚC khi đọc body:
   * tính năng tắt → `HIGHLIGHT_DISABLED`; `Content-Length` khai lớn hơn giới hạn hiện hành (+ phần
   * dư) → `HIGHLIGHT_TOO_LARGE` với câu của service; rồi lấy một chỗ tải lên, hết chỗ →
   * `HIGHLIGHT_BUSY`. Không hỏi được giới hạn (bot sập) thì cho qua để service trả lời như cũ.
   */
  const highlightUploadGate = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const config = await highlightConfig(app.ctx).catch(() => null);
    if (config !== null) {
      if (!config.enabled) throw appError('HIGHLIGHT_DISABLED');
      const declared = declaredLength(request);
      if (declared !== null && declared > config.maxBytes + HIGHLIGHT_LENGTH_SLACK) {
        throw appError('HIGHLIGHT_TOO_LARGE', highlightLimitMessage(config.maxBytes));
      }
    }
    if (!uploads.acquire(request, reply)) throw appError('HIGHLIGHT_BUSY');
  };

  app.put(
    HIGHLIGHT_UPLOAD_ROUTE,
    {
      // Kiểm đăng nhập rồi qua cổng ở onRequest — TRƯỚC khi đọc body — để người lạ, file khai quá
      // cỡ hay lúc đã đủ người đang tải không bắt máy chủ giữ tới 50 MiB rồi mới bị từ chối (các
      // route JSON kiểm ở preHandler vì body nhỏ). Giới hạn tốc độ của plugin chạy sau hai hook này.
      onRequest: [requireMember, highlightUploadGate],
      errorHandler: highlightUploadErrorHandler,
      config: { rateLimit: HIGHLIGHT_RATE_LIMIT },
    },
    async (request): Promise<ReportDto> =>
      // File nằm trong bộ nhớ tới khi handler xong (cả lượt gửi lên Discord): chỗ giữ tới lúc đó.
      uploads.hold(request, async () => {
        const { id } = idParams.parse(request.params);
        // Body không phải buffer (vd gửi JSON) → cùng lỗi với file không nhận diện được.
        if (!Buffer.isBuffer(request.body)) throw appError('INVALID_HIGHLIGHT');
        return attachHighlight(app.ctx, currentMember(request).id, id, { data: request.body });
      }),
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

/** `Content-Length` khai trong request; không khai (gửi chunked) hay không phải số → null. */
function declaredLength(request: FastifyRequest): number | null {
  const header = request.headers['content-length'];
  return header !== undefined && /^\d+$/.test(header) ? Number(header) : null;
}

interface UploadSlot {
  /** Kết nối của request đã đóng (trả lời xong, hoặc client đã ngắt). */
  closed: boolean;
  /** Handler đang chạy — đang giữ file trong bộ nhớ, chờ Discord. */
  working: boolean;
  released: boolean;
}

/**
 * Đếm số lần tải lên đang giữ bộ nhớ, tối đa `max`. Một chỗ lấy ở cổng của route và trả ĐÚNG MỘT
 * LẦN khi cả hai điều đã xong: kết nối đã đóng và handler (nếu đã vào) đã chạy xong.
 *
 * "Kết nối đã đóng" lấy từ sự kiện `close` của response — Node bắn nó trên mọi đường: trả lời
 * xong (sau onResponse), lỗi trả từ hook, client ngắt giữa lúc gửi body hay sau khi đã gửi đủ.
 * Không dựa vào onResponse/onRequestAbort: client ngắt sau khi gửi đủ body (đang chờ Discord) thì
 * Fastify không gọi hook nào trong hai hook đó, và chỗ sẽ mất tới khi khởi động lại. Còn đợi
 * handler xong vì lúc client bỏ đi, file vẫn nằm trong bộ nhớ tới khi lượt gửi Discord kết thúc.
 */
function uploadSlots(max: number) {
  let inFlight = 0;
  const slots = new WeakMap<FastifyRequest, UploadSlot>();

  const releaseIfDone = (slot: UploadSlot): void => {
    if (slot.released || !slot.closed || slot.working) return;
    slot.released = true;
    inFlight -= 1;
  };

  return {
    /** Lấy một chỗ cho request; đã đủ `max` → false (không lấy gì). */
    acquire(request: FastifyRequest, reply: FastifyReply): boolean {
      if (inFlight >= max) return false;
      inFlight += 1;
      const slot: UploadSlot = { closed: false, working: false, released: false };
      slots.set(request, slot);
      const onClose = (): void => {
        slot.closed = true;
        releaseIfDone(slot);
      };
      // Client bỏ đi ngay lúc đang kiểm đăng nhập: `close` đã bắn trước khi tới đây.
      if (reply.raw.destroyed) onClose();
      else reply.raw.once('close', onClose);
      return true;
    },

    /** Chạy handler của request; chỗ của nó không được trả trước khi `work` xong. */
    async hold<T>(request: FastifyRequest, work: () => Promise<T>): Promise<T> {
      const slot = slots.get(request);
      if (slot) slot.working = true;
      try {
        return await work();
      } finally {
        if (slot) {
          slot.working = false;
          releaseIfDone(slot);
        }
      }
    },
  };
}
