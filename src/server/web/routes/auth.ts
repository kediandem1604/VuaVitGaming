/**
 * Đăng nhập Discord OAuth, đăng xuất, và dev-login (chỉ khi `config.devLogin`).
 * Mọi thất bại của callback đều là redirect về `/login?error=<lý do>`, không bao
 * giờ là trang lỗi 500.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appError } from '../../lib/errors.js';
import { findActiveMember, loginFromDiscord } from '../../modules/auth/login.js';
import type { OAuthClient, OAuthProfile } from '../../modules/auth/oauth.js';
import { createWebSession, deleteWebSession } from '../../modules/auth/sessions.js';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  clearOAuthStateCookie,
  clearSessionCookie,
  readSignedCookie,
  setOAuthStateCookie,
  setSessionCookie,
} from '../auth-plugin.js';

export interface AuthRoutesOptions {
  oauth: OAuthClient;
}

type LoginFailure = 'state' | 'oauth' | 'not_member';

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
});

const devLoginQuery = z.object({ discordId: z.string().min(1) });

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions): Promise<void> {
  const { ctx } = app;

  app.get('/auth/login', async (_request, reply) => {
    const state = randomBytes(16).toString('base64url');
    setOAuthStateCookie(reply, state);
    return reply.redirect(opts.oauth.authorizeUrl(state));
  });

  app.get('/auth/callback', async (request, reply) => {
    const expectedState = readSignedCookie(request, OAUTH_STATE_COOKIE);
    clearOAuthStateCookie(reply);
    const fail = (reason: LoginFailure) => reply.redirect(`/login?error=${reason}`);

    const query = callbackQuery.safeParse(request.query);
    if (!query.success || !expectedState || !query.data.code || query.data.state !== expectedState) {
      return fail('state');
    }

    let profile: OAuthProfile;
    try {
      profile = await opts.oauth.exchange(query.data.code);
    } catch {
      return fail('oauth');
    }

    // Sau khi đổi mã, lỗi bất kỳ (DB trục trặc khi đồng bộ hồ sơ hay tạo phiên…) cũng chỉ
    // là "đăng nhập thất bại, thử lại" — ghi log ở server, không bao giờ là trang lỗi 500.
    let sessionId: string;
    try {
      const member = await loginFromDiscord(ctx, profile);
      if (!member) return fail('not_member');
      sessionId = (await createWebSession(ctx, member.id)).id;
    } catch (err) {
      request.log.error({ err }, 'Đăng nhập Discord lỗi sau khi đổi mã');
      return fail('oauth');
    }
    setSessionCookie(reply, sessionId);
    return reply.redirect('/');
  });

  app.post('/auth/logout', async (request, reply) => {
    const sessionId = readSignedCookie(request, SESSION_COOKIE);
    if (sessionId) await deleteWebSession(ctx, sessionId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  if (ctx.config.devLogin) {
    app.get('/auth/dev-login', async (request, reply) => {
      const { discordId } = devLoginQuery.parse(request.query);
      const member = await findActiveMember(ctx, discordId);
      if (!member) throw appError('NOT_FOUND');
      const session = await createWebSession(ctx, member.id);
      setSessionCookie(reply, session.id);
      return reply.redirect('/');
    });
  }
}
