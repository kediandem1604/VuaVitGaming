/**
 * Vỏ Fastify: cookie, giới hạn tốc độ (chỉ /api và /auth), guard JSON cho thao tác ghi, ánh xạ lỗi
 * sang `{ error: { code, message } }`, 404 JSON cho /api và /auth, file tĩnh +
 * index.html cho web, header bảo mật cho mọi phản hồi, log không kèm query string.
 * Mọi route sau này đăng ký vào đây.
 *
 * `buildApp` trả app CHƯA `ready()` và chưa lắng nghe, để test còn gắn thêm route.
 */

import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorBody, DiscordStatus, HealthDto } from '../../shared/api-types.js';
import type { Ctx } from '../ctx.js';
import { AppError, appError } from '../lib/errors.js';
import type { OAuthClient } from '../modules/auth/oauth.js';
import { installAuth } from './auth-plugin.js';
import { adminCategoryRoutes } from './routes/admin-categories.js';
import { adminMiscRoutes } from './routes/admin-misc.js';
import { adminModeRoutes } from './routes/admin-modes.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { mvpRoutes } from './routes/mvp.js';
import { ROLE_IMAGE_TYPES, ROLE_IMAGE_UPLOAD_ROUTE, roleRoutes } from './routes/roles.js';
import { sessionRoutes } from './routes/sessions.js';
import { HIGHLIGHT_TYPES, HIGHLIGHT_UPLOAD_ROUTE, statsRoutes } from './routes/stats.js';

export interface AppDeps {
  oauth: OAuthClient;
  /** Thư mục build của web (Vite). Bỏ trống thì không phục vụ file tĩnh. */
  webDistDir?: string;
  /** Logger Fastify; mặc định tắt (test im lặng). */
  logger?: FastifyServerOptions['logger'];
  /** Trạng thái bot Discord cho `/healthz`; bỏ trống thì luôn báo `down`. */
  discordStatus?: () => DiscordStatus;
}

const RATE_LIMIT_PER_MINUTE = 120;

/**
 * Chỉ tin đúng `hops` lớp proxy phía trước app (hop 0 là máy nối thẳng vào socket).
 * IP người dùng là mục mà lớp proxy cuối nối vào X-Forwarded-For; phần client tự
 * thêm bị bỏ qua nên không né được giới hạn tốc độ. Fastify 5 cố ý coi số nguyên
 * truyền thẳng vào `trustProxy` là "không tin ai", nên phải đưa hàm.
 */
function trustProxyHops(hops: number): (address: string, hop: number) => boolean {
  return (_address, hop) => hop < hops;
}

export async function buildApp(ctx: Ctx, deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(deps.logger), trustProxy: trustProxyHops(ctx.config.trustProxyHops) });
  installAuth(app, ctx);
  app.addHook('onSend', securityHeaders);

  app.setErrorHandler((err, request, reply) => sendError(err, request, reply));
  app.setNotFoundHandler((request, reply) => sendNotFound(request, reply, deps.webDistDir !== undefined));

  await app.register(fastifyCookie, { secret: ctx.config.sessionSecret });
  await app.register(fastifyRateLimit, {
    max: RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // Chỉ API và đăng nhập: file tĩnh và trang SPA không tính, vì nhiều người sau một NAT
    // (CGNAT di động) chung một IP — tải trang thôi cũng đủ làm cả nhóm bị chặn "Tham gia".
    // Xét theo route đã khớp, không theo URL thô: `/%61pi/me` chạy handler của `/api/me`.
    allowList: (request) => !isApiOrAuth(routePath(request)),
    errorResponseBuilder: () => appError('RATE_LIMITED', 'Bạn thao tác quá nhanh, thử lại sau'),
  });

  app.addHook('onRequest', jsonGuard);
  acceptEmptyJsonBody(app);

  healthRoute(app, deps.discordStatus ?? (() => 'down'));

  await app.register(authRoutes, { oauth: deps.oauth });
  await app.register(meRoutes);
  await app.register(sessionRoutes);
  await app.register(mvpRoutes);
  await app.register(adminCategoryRoutes);
  await app.register(adminMiscRoutes);
  await app.register(adminModeRoutes);
  await app.register(roleRoutes);
  await app.register(statsRoutes);

  if (deps.webDistDir !== undefined) {
    await app.register(fastifyStatic, { root: deps.webDistDir });
  }

  return app;
}

// ---------------------------------------------------------------------------
// Log và header
// ---------------------------------------------------------------------------

/**
 * Logger của Fastify với bộ chuyển `req` riêng: đường dẫn KHÔNG kèm query string, vì
 * query có thể chứa bí mật (mã và state OAuth ở `/auth/callback`) hay dữ liệu người dùng
 * (ô tìm kiếm). Giữ `remoteAddress` (IP đã qua `trustProxy`) để kiểm tra `TRUST_PROXY_HOPS`.
 */
function loggerOptions(logger: AppDeps['logger']): FastifyServerOptions['logger'] {
  if (!logger) return false;
  const base = logger === true ? {} : logger;
  return { ...base, serializers: { ...base.serializers, req: serializeRequest as never } };
}

export function serializeRequest(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: pathOf(request),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'same-origin',
};

/** Mọi phản hồi (API, lỗi, file tĩnh, SPA, chuyển hướng): không cho nhúng trong iframe, không đoán kiểu, không lộ URL ra ngoài. */
async function securityHeaders(_request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  return payload;
}

// ---------------------------------------------------------------------------
// Sức khoẻ
// ---------------------------------------------------------------------------

/**
 * `GET /healthz` cho Railway (và người vận hành): 200 chừng nào web còn trả lời,
 * kèm trạng thái bot. Discord sập KHÔNG đổi mã trạng thái — khởi động lại web không
 * chữa được Discord, còn nhắc email và API vẫn cần chạy. Không giới hạn tốc độ vì
 * Railway gọi liên tục từ cùng một IP; không cần đăng nhập; không nằm dưới /api.
 */
function healthRoute(app: FastifyInstance, discordStatus: () => DiscordStatus): void {
  app.get('/healthz', { config: { rateLimit: false } }, async (): Promise<HealthDto> => {
    return { ok: true, discord: discordStatus() };
  });
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
  const path = routePath(request);
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
/**
 * Route PUT nhận body thô (file) và đúng các content-type được nhận ở đó — ngoại lệ duy nhất
 * của guard JSON; mỗi route chỉ mở danh sách của mình (ảnh role không mở route highlight và ngược lại).
 */
const RAW_UPLOAD_ROUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [ROLE_IMAGE_UPLOAD_ROUTE, new Set(ROLE_IMAGE_TYPES)],
  [HIGHLIGHT_UPLOAD_ROUTE, new Set(HIGHLIGHT_TYPES)],
]);

/**
 * Thao tác ghi dưới /api phải gửi `application/json` (chống CSRF kiểu form, cùng
 * với cookie sameSite=lax). Ngoại lệ: hai route tải file thô (`PUT /api/admin/roles/:id/image`
 * nhận ảnh, `PUT /api/reports/:id/highlight` nhận video/ảnh) với content-type của route đó;
 * DELETE không có body được bỏ content-type. Xét theo route đã khớp (`routePath`),
 * nên đường dẫn mã hoá % (`/%61pi/me`) bị chặn y như đường dẫn thường.
 */
async function jsonGuard(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!MUTATING_METHODS.has(request.method)) return undefined;
  const path = routePath(request);
  if (!isUnder(path, '/api')) return undefined;

  const type = mediaTypeOf(request.headers['content-type']);
  if (type === 'application/json') return undefined;
  if (type === undefined && request.method === 'DELETE') return undefined;
  if (request.method === 'PUT' && type !== undefined && RAW_UPLOAD_ROUTES.get(path)?.has(type) === true) return undefined;
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

/** Đường dẫn THÔ (chưa giải mã %), bỏ query string — chỉ dùng để ghi log. */
function pathOf(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] ?? '';
}

/**
 * Đường dẫn để quyết định một request là API/đăng nhập hay trang web (giới hạn tốc độ,
 * guard JSON, 404 JSON hay index.html). Không bao giờ dùng URL thô: router giải mã %
 * trước khi chọn route, nên `/%61pi/me` chạy handler của `/api/me` — xét URL thô thì
 * nó lọt khỏi giới hạn tốc độ và guard JSON.
 *
 * - Khớp một route cụ thể → mẫu route router đã chọn (`/api/sessions/:id`).
 * - Không khớp route nào (404), hoặc chỉ khớp route bắt-tất-cả của file tĩnh (`/*`, cũng
 *   là nơi `/api/khong-co` rơi vào khi có thư mục web) → đường dẫn đã giải mã %.
 */
function routePath(request: FastifyRequest): string {
  const route = request.routeOptions.url;
  if (route !== undefined && !route.endsWith('*')) return route;
  return decodedPathOf(request);
}

/**
 * Đường dẫn đã giải mã %. Chuỗi mã hoá hỏng thì coi như API (giới hạn tốc độ, guard JSON,
 * 404 JSON) — chặt hơn là thả; thực tế router đã trả 400 cho URL hỏng trước khi tới đây.
 */
function decodedPathOf(request: FastifyRequest): string {
  try {
    return decodeURIComponent(pathOf(request));
  } catch {
    return '/api';
  }
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isApiOrAuth(path: string): boolean {
  return isUnder(path, '/api') || isUnder(path, '/auth');
}
