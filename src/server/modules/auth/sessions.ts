/**
 * Phiên đăng nhập web (bảng `web_sessions`). Id là 32 byte ngẫu nhiên base64url
 * — chính là giá trị nằm trong cookie (đã ký) — nên không dùng uuid mặc định.
 */

import { randomBytes } from 'node:crypto';
import type { Member } from '@prisma/client';
import type { Ctx } from '../../ctx.js';

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 ngày

export async function createWebSession(ctx: Ctx, memberId: number): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('base64url');
  const expiresAt = new Date(ctx.now().getTime() + SESSION_TTL_SECONDS * 1000);
  await ctx.db.webSession.create({ data: { id, memberId, expiresAt } });
  return { id, expiresAt };
}

/**
 * Thành viên của phiên, hoặc null nếu không có phiên, phiên đã hết hạn (dòng bị
 * xoá luôn) hay thành viên không còn `active`.
 */
export async function resolveWebSession(ctx: Ctx, id: string): Promise<Member | null> {
  const session = await ctx.db.webSession.findUnique({ where: { id }, include: { member: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= ctx.now().getTime()) {
    await deleteWebSession(ctx, id);
    return null;
  }
  return session.member.status === 'active' ? session.member : null;
}

/** Xoá phiên; id không tồn tại thì không làm gì. */
export async function deleteWebSession(ctx: Ctx, id: string): Promise<void> {
  await ctx.db.webSession.deleteMany({ where: { id } });
}
