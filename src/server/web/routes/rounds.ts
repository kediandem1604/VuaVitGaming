/**
 * Ván đấu qua HTTP (spec 2026-11-01 game rounds §4, §5): mọi thành viên xem trang buổi (ván + lần khai
 * công khai) và ảnh ván; mod/admin thêm ván, đổi ảnh, chọn phe thắng / người thắng, xoá ván.
 *
 * Ảnh gửi lên dưới dạng body thô (như ảnh role): `POST /api/admin/sessions/:id/rounds?winnerFaction=…`
 * và `PUT /api/admin/rounds/:id/image` với content-type ảnh — guard JSON trong app.ts chỉ cho qua đúng
 * ba route này (thêm `PUT /api/admin/rounds/:id/thumbnail` — ảnh nhỏ web tự thu nhỏ, ≤ 300 KB). Nhận cả `image/gif` và `application/octet-stream` để file sai loại được báo bằng câu của
 * spec ("Chỉ nhận ảnh PNG, JPG hoặc WebP" — service nhận diện theo nội dung) thay vì 415 chung.
 */

import type { FastifyError, FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ReportDto, RoundDto, SessionRoundsDto } from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import {
  ROUND_IMAGE_MAX_BYTES,
  ROUND_IMAGE_TOO_LARGE_MESSAGE,
  ROUND_THUMB_MAX_BYTES,
  ROUND_THUMB_TOO_LARGE_MESSAGE,
  createRound,
  deleteRound,
  getRoundImage,
  getRoundImageMeta,
  listSessionRounds,
  parseWinnerFaction,
  replaceRoundImage,
  setRoundThumb,
  updateRound,
} from '../../modules/rounds/service.js';
import { getReportDto, submitRoundReport } from '../../modules/stats/reports.js';
import { currentMember, requireMember, requireMod } from '../auth-plugin.js';
import { idParams, int32Id } from '../schemas.js';

/** Content-type được nhận ở hai route tải ảnh ván (guard JSON trong app.ts dùng cùng danh sách). */
export const ROUND_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/octet-stream'];
/** Mẫu route thêm ván (POST, body là ảnh). */
export const ROUND_CREATE_ROUTE = '/api/admin/sessions/:id/rounds';
/** Mẫu route đổi ảnh ván (PUT, body là ảnh). */
export const ROUND_IMAGE_UPLOAD_ROUTE = '/api/admin/rounds/:id/image';
/** Mẫu route up ảnh nhỏ của ván (PUT, body là ảnh). */
export const ROUND_THUMB_UPLOAD_ROUTE = '/api/admin/rounds/:id/thumbnail';
/** Hơn 300 KiB một chút; service kiểm giới hạn chính xác. */
const THUMB_BODY_LIMIT = ROUND_THUMB_MAX_BYTES + 16 * 1024;
/** Hơn 5 MiB một chút để body đúng 5 MiB qua được; service kiểm giới hạn chính xác. */
const IMAGE_BODY_LIMIT = ROUND_IMAGE_MAX_BYTES + 64 * 1024;
/** Ảnh chỉ cho thành viên đăng nhập: trình duyệt giữ 5 phút rồi hỏi lại bằng ETag. */
const IMAGE_CACHE_CONTROL = 'private, max-age=300';
/** Bucket riêng như ảnh role: trang buổi kéo nhiều ảnh, không làm nghẽn các route /api khác của IP. */
const IMAGE_RATE_LIMIT = { max: 600, timeWindow: '1 minute' };

const createQuery = z.object({ winnerFaction: z.string().optional() });
/** `?size=thumb` → ảnh nhỏ (chưa có thì ảnh gốc); `v` chỉ để phá cache, server bỏ qua. */
const imageQuery = z.object({ size: z.enum(['thumb']).optional(), v: z.string().optional() });

/**
 * Khai theo ván (spec ván §5): như body khai điểm nhưng không có `playedOn`/`sessionId` (server lấy theo
 * buổi của ván). Chỉ kiểm DẠNG — giới hạn chỉ số, ván còn nhận khai, trùng… do service báo.
 */
const roundReportBody = z
  .object({
    roleId: int32Id,
    value: z.number(),
    extraValue: z.number().optional(),
    penaltyValue: z.number().optional(),
    note: z.string().nullish(),
    // Có mặt → service báo "Báo cáo người chơi gửi ở tab riêng" (như `POST /api/reports`).
    accusation: z.unknown().optional(),
  })
  .strict();

export async function roundRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser([...ROUND_IMAGE_TYPES], { parseAs: 'buffer', bodyLimit: IMAGE_BODY_LIMIT }, (_request, body, done) => done(null, body));

  app.get('/api/sessions/:id/rounds', { preHandler: requireMember }, async (request): Promise<SessionRoundsDto> => {
    const { id } = idParams.parse(request.params);
    return listSessionRounds(app.ctx, id, currentMember(request).id);
  });

  app.post('/api/rounds/:id/reports', { preHandler: requireMember }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const input = roundReportBody.parse(request.body);
    const created = await submitRoundReport(app.ctx, currentMember(request).id, id, input);
    const dto: ReportDto = await getReportDto(app.ctx, created.id);
    return reply.code(201).send(dto);
  });

  app.get('/api/rounds/:id/image', { preHandler: requireMember, config: { rateLimit: IMAGE_RATE_LIMIT } }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const wantThumb = imageQuery.parse(request.query).size === 'thumb';
    const meta = await getRoundImageMeta(app.ctx, id);
    if (!meta) throw appError('NOT_FOUND');
    // ETag theo mốc đổi ảnh (kèm id): đổi ảnh → ETag mới → người đang xem nhận ảnh mới, không 304.
    // `?size=thumb` có ETag riêng — kể cả khi trả ảnh gốc thay ảnh nhỏ — để hai bản không lẫn cache.
    const etag = roundEtag(id, meta.updatedAt, wantThumb ? (meta.hasThumb ? 'thumb' : 'thumb-full') : null);
    reply.header('etag', etag).header('cache-control', IMAGE_CACHE_CONTROL).header('x-content-type-options', 'nosniff');
    if (etagMatches(request.headers['if-none-match'], etag)) return reply.code(304).send();
    const image = await getRoundImage(app.ctx, id, wantThumb);
    if (!image) throw appError('NOT_FOUND');
    // Ảnh vừa bị đổi giữa hai truy vấn: ETag phải khớp đúng ảnh gửi đi.
    reply.header('etag', roundEtag(id, image.updatedAt, wantThumb ? (image.isThumb ? 'thumb' : 'thumb-full') : null));
    return reply.type(image.mime).send(image.buf);
  });

  app.post(ROUND_CREATE_ROUTE, { preHandler: requireMod, errorHandler: imageUploadErrorHandler }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const winnerFaction = parseWinnerFaction(createQuery.parse(request.query).winnerFaction);
    const body = imageBody(request.body);
    const round: RoundDto = await createRound(app.ctx, currentMember(request).id, id, body, winnerFaction);
    return reply.code(201).send(round);
  });

  app.patch('/api/admin/rounds/:id', { preHandler: requireMod }, async (request): Promise<RoundDto> => {
    const { id } = idParams.parse(request.params);
    return updateRound(app.ctx, currentMember(request).id, id, request.body);
  });

  app.put(ROUND_IMAGE_UPLOAD_ROUTE, { preHandler: requireMod, errorHandler: imageUploadErrorHandler }, async (request): Promise<RoundDto> => {
    const { id } = idParams.parse(request.params);
    return replaceRoundImage(app.ctx, currentMember(request).id, id, imageBody(request.body));
  });

  app.put(
    ROUND_THUMB_UPLOAD_ROUTE,
    { preHandler: requireMod, errorHandler: thumbUploadErrorHandler, bodyLimit: THUMB_BODY_LIMIT },
    async (request): Promise<RoundDto> => {
      const { id } = idParams.parse(request.params);
      return setRoundThumb(app.ctx, currentMember(request).id, id, imageBody(request.body));
    },
  );

  app.delete('/api/admin/rounds/:id', { preHandler: requireMod }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await deleteRound(app.ctx, id);
    return reply.code(204).send();
  });
}

/** Body không phải buffer (vd JSON, hoặc rỗng) → coi như file rỗng: service báo "Chỉ nhận ảnh PNG, JPG hoặc WebP". */
function imageBody(body: unknown): Buffer {
  return Buffer.isBuffer(body) ? body : Buffer.alloc(0);
}

/**
 * Body vượt `bodyLimit` → Fastify ném 413 trước khi vào handler; với ảnh ván đó là "Ảnh tối đa 5 MB"
 * (400 INVALID_IMAGE). Ném tiếp để handler lỗi chung của app định dạng phản hồi.
 */
function imageUploadErrorHandler(err: FastifyError): never {
  if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') throw appError('INVALID_IMAGE', ROUND_IMAGE_TOO_LARGE_MESSAGE);
  throw err;
}

/** Body ảnh nhỏ vượt `bodyLimit` → "Ảnh nhỏ tối đa 300 KB" (400 INVALID_IMAGE). */
function thumbUploadErrorHandler(err: FastifyError): never {
  if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') throw appError('INVALID_IMAGE', ROUND_THUMB_TOO_LARGE_MESSAGE);
  throw err;
}

/** ETag ảnh ván: `"round-{id}-{mốc}"` (ảnh gốc) hoặc kèm hậu tố của bản `?size=thumb`. */
function roundEtag(id: number, updatedAt: Date, variant: 'thumb' | 'thumb-full' | null): string {
  return variant === null ? `"round-${id}-${updatedAt.getTime()}"` : `"round-${id}-${updatedAt.getTime()}-${variant}"`;
}

/** `If-None-Match` khớp ETag (kể cả dạng yếu `W/"…"`, danh sách phân cách bằng dấu phẩy). */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(',').some((tag) => {
    const t = tag.trim();
    return t === etag || t === `W/${etag}` || t === '*';
  });
}
