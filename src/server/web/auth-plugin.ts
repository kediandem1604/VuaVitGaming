/**
 * Gắn `Ctx` vào app, `member` vào request; cookie phiên và cookie state OAuth
 * (đều ký bằng `sessionSecret`); các preHandler phân quyền.
 */

import type { CookieSerializeOptions } from '@fastify/cookie';
import type { Member } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Ctx } from '../ctx.js';
import { appError } from '../lib/errors.js';
import { SESSION_TTL_SECONDS, resolveWebSession } from '../modules/auth/sessions.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx;
  }
  interface FastifyRequest {
    /** Thành viên đang đăng nhập; chỉ được gán sau `requireMember`/`requireMod`/`requireAdmin`. */
    member: Member | null;
  }
}

export const SESSION_COOKIE = 'ggd_sid';
export const OAUTH_STATE_COOKIE = 'ggd_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function installAuth(app: FastifyInstance, ctx: Ctx): void {
  app.decorate('ctx', ctx);
  app.decorateRequest('member', null);
}

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

function cookieOptions(config: Config): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: config.publicUrl.startsWith('https://'),
    signed: true,
  };
}

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, { ...cookieOptions(reply.server.ctx.config), maxAge: SESSION_TTL_SECONDS });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, cookieOptions(reply.server.ctx.config));
}

export function setOAuthStateCookie(reply: FastifyReply, state: string): void {
  reply.setCookie(OAUTH_STATE_COOKIE, state, {
    ...cookieOptions(reply.server.ctx.config),
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_STATE_COOKIE, cookieOptions(reply.server.ctx.config));
}

/** Giá trị của cookie đã ký; thiếu cookie hoặc chữ ký sai → null (coi như không có). */
export function readSignedCookie(request: FastifyRequest, name: string): string | null {
  const raw = request.cookies[name];
  if (!raw) return null;
  const result = request.unsignCookie(raw);
  return result.valid ? result.value : null;
}

// ---------------------------------------------------------------------------
// Phân quyền
// ---------------------------------------------------------------------------

async function loadMember(request: FastifyRequest): Promise<Member | null> {
  if (request.member) return request.member;
  const sessionId = readSignedCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  return resolveWebSession(request.server.ctx, sessionId);
}

/** preHandler: cần đăng nhập (phiên còn hạn, thành viên còn `active`). */
export async function requireMember(request: FastifyRequest): Promise<void> {
  const member = await loadMember(request);
  if (!member) throw appError('UNAUTHENTICATED');
  request.member = member;
}

/** preHandler: mod hoặc admin. */
export async function requireMod(request: FastifyRequest): Promise<void> {
  await requireMember(request);
  const level = currentMember(request).accessLevel;
  if (level !== 'mod' && level !== 'admin') throw appError('FORBIDDEN');
}

/** preHandler: chỉ admin. */
export async function requireAdmin(request: FastifyRequest): Promise<void> {
  await requireMember(request);
  if (currentMember(request).accessLevel !== 'admin') throw appError('FORBIDDEN');
}

/** Thành viên đã qua một preHandler ở trên; dùng trong handler để khỏi kiểm tra null. */
export function currentMember(request: FastifyRequest): Member {
  if (!request.member) throw appError('UNAUTHENTICATED');
  return request.member;
}
