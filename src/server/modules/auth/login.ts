/**
 * Ai được đăng nhập: nghiệp vụ đằng sau callback OAuth và dev-login. Không biết
 * gì về HTTP hay cookie — route chỉ gọi vào đây rồi tạo phiên.
 */

import type { Member } from '@prisma/client';
import type { Ctx } from '../../ctx.js';
import type { GuildMemberInfo } from '../../ports.js';
import { markMemberLeft, recordOAuthEmail, upsertMemberFromGuild } from '../members/service.js';
import type { OAuthProfile } from './oauth.js';

/** Thành viên `active` theo discordId, hoặc null. */
export async function findActiveMember(ctx: Ctx, discordId: string): Promise<Member | null> {
  const member = await ctx.db.member.findUnique({ where: { discordId } });
  return member?.status === 'active' ? member : null;
}

/**
 * Đăng nhập từ hồ sơ Discord OAuth. Hỏi danh bạ server:
 * - có trong server → đồng bộ tên/avatar/quyền, rồi ghi email đã xác minh (nếu hồ sơ chưa có email);
 * - không có trong server → đánh dấu rời hội, trả null;
 * - danh bạ không trả lời (Discord sập) → tin bản ghi DB nếu còn `active`, không tạo mới.
 */
export async function loginFromDiscord(ctx: Ctx, profile: OAuthProfile): Promise<Member | null> {
  const member = await memberFromGuild(ctx, profile.discordId);
  if (!member) return null;
  await recordOAuthEmail(ctx, member.id, profile.email, profile.emailVerified);
  return member;
}

async function memberFromGuild(ctx: Ctx, discordId: string): Promise<Member | null> {
  let info: GuildMemberInfo | null;
  try {
    info = await ctx.directory.getMember(discordId);
  } catch (err) {
    console.warn(
      `[auth] Không hỏi được danh bạ Discord cho ${discordId} — dùng hồ sơ trong database: ${err instanceof Error ? err.message : String(err)}`,
    );
    return findActiveMember(ctx, discordId);
  }
  if (!info) {
    await markMemberLeft(ctx, discordId);
    return null;
  }
  return (await upsertMemberFromGuild(ctx, info)).member;
}
