/**
 * Vỏ Fastify: cookie, giới hạn tốc độ, guard JSON cho thao tác ghi, ánh xạ lỗi
 * sang `{ error: { code, message } }`, 404 JSON cho /api và /auth, file tĩnh +
 * index.html cho web. Mọi route sau này đăng ký vào đây.
 *
 * `buildApp` trả app CHƯA `ready()` và chưa lắng nghe, để test còn gắn thêm route.
 */

import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '../../shared/api-types.js';
import type { Ctx } from '../ctx.js';
import { AppError, appError } from '../lib/errors.js';
import type { OAuthClient } from '../modules/auth/oauth.js';
import { installAuth } from './auth-plugin.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';

export interface AppDeps {
  oauth: OAuthClient;
  /** Thư mục build của web (Vite). Bỏ trống thì không phục vụ file tĩnh. */
  webDistDir?: string;
  /** Logger Fastify; mặc định tắt (test im lặng). */
  logger?: FastifyServerOptions['logger'];
}

const RATE_LIMIT_PER_MINUTE = 120;

export async function buildApp(ctx: Ctx, deps: AppDeps): Promise<FastifyInstance> {
  // trustProxy: chạy sau proxy (Railway) nên IP thật nằm ở x-forwarded-for.
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });
  installAuth(app, ctx);

  app.setErrorHandler((err, request, reply) => sendError(err, request, reply));
  app.setNotFoundHandler((request, reply) => sendNotFound(request, reply, deps.webDistDir !== undefined));

  await app.register(fastifyCookie, { secret: ctx.config.sessionSecret });
  await app.register(fastifyRateLimit, {
    max: RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: () => appError('RATE_LIMITED', 'Bạn thao tác quá nhanh, thử lại sau'),
  });

  app.addHook('onRequest', jsonGuard);
  acceptEmptyJsonBody(app);

  await app.register(authRoutes, { oauth: deps.oauth });
  await app.register(meRoutes);

  if (deps.webDistDir !== undefined) {
    await app.register(fastifyStatic, { root: deps.webDistDir });
  }

  return app;
}

// ---------------------------------------------------------------------------
// Lỗi
// ---------------------------------------------------------------------------

function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

/**
 * `AppError` → status của nó; `ZodError` → 400 VALIDATION; lỗi 4xx của Fastify
 * (JSON hỏng, body quá lớn…) → giữ status, thông báo chung; còn lại → 500 và
 * ghi log đầy đủ ở server. Thân phản hồi không bao giờ chứa chi tiết nội bộ.
 */
export function sendError(err: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (err instanceof AppError) return reply.code(err.status).send(errorBody(err.code, err.message));
  if (err instanceof ZodError) return reply.code(400).send(errorBody('VALIDATION', 'Dữ liệu không hợp lệ'));

  const status = statusCodeOf(err);
  if (status === 415) return reply.code(415).send(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Chỉ nhận dữ liệu JSON'));
  if (status !== null && status >= 400 && status < 500) {
    return reply.code(status).send(errorBody('BAD_REQUEST', 'Yêu cầu không hợp lệ'));
  }

  request.log.error(err);
  return reply.code(500).send(errorBody('INTERNAL', 'Có lỗi xảy ra, thử lại sau'));
}

function statusCodeOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('statusCode' in err)) return null;
  const code = (err as { statusCode: unknown }).statusCode;
  return typeof code === 'number' ? code : null;
}

function sendNotFound(request: FastifyRequest, reply: FastifyReply, serveWeb: boolean): FastifyReply {
  const path = pathOf(request);
  if (serveWeb && (request.method === 'GET' || request.method === 'HEAD') && !isApiOrAuth(path)) {
    // Đường dẫn của SPA (React Router): trả index.html, trình duyệt không được cache.
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  }
  return reply.code(404).send(errorBody('NOT_FOUND', 'Không tìm thấy'));
}

// ---------------------------------------------------------------------------
// Guard JSON cho thao tác ghi dưới /api
// ---------------------------------------------------------------------------

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const ROLE_IMAGE_UPLOAD = /^\/api\/admin\/roles\/[^/]+\/image$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Thao tác ghi dưới /api phải gửi `application/json` (chống CSRF kiểu form, cùng
 * với cookie sameSite=lax). Ngoại lệ: `PUT /api/admin/roles/:id/image` nhận ảnh;
 * DELETE không có body được bỏ content-type.
 */
async function jsonGuard(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!MUTATING_METHODS.has(request.method)) return undefined;
  const path = pathOf(request);
  if (!isUnder(path, '/api')) return undefined;

  const type = mediaTypeOf(request.headers['content-type']);
  if (type === 'application/json') return undefined;
  if (type === undefined && request.method === 'DELETE') return undefined;
  if (request.method === 'PUT' && type !== undefined && IMAGE_TYPES.has(type) && ROLE_IMAGE_UPLOAD.test(path)) {
    return undefined;
  }
  return reply.code(415).send(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Chỉ nhận dữ liệu JSON'));
}

/** `application/json; charset=utf-8` → `application/json`; thiếu header → undefined. */
function mediaTypeOf(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  return header.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

/**
 * Body JSON rỗng (client đặt sẵn content-type nhưng không gửi gì, vd DELETE hay
 * POST không tham số) → `request.body` undefined thay vì lỗi 400 của Fastify.
 */
function acceptEmptyJsonBody(app: FastifyInstance): void {
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text === '') {
      done(null, undefined);
      return;
    }
    parseJson(request, text, done);
  });
}

// ---------------------------------------------------------------------------
// Đường dẫn
// ---------------------------------------------------------------------------

function pathOf(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] ?? '';
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isApiOrAuth(path: string): boolean {
  return isUnder(path, '/api') || isUnder(path, '/auth');
}
