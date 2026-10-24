/**
 * Xử lý sự kiện thành viên Discord: vào, rời, đổi tên/role, và quét toàn bộ
 * server lúc bot sẵn sàng. Không chạm discord.js — nhận `GuildMemberInfo` (hoặc
 * đối tượng có hình dạng GuildMember) nên test được bằng bản giả.
 */

import type { Ctx } from '../ctx.js';
import {
  buildWelcomeText,
  markMemberLeft,
  syncGuildMembers,
  upsertMemberFromGuild,
} from '../modules/members/service.js';
import type { GuildMemberInfo } from '../ports.js';
import { toGuildMemberInfo } from './guild-directory.js';
import type { GuildMemberSource } from './guild-directory.js';

/**
 * Người vào server: bot bị bỏ qua; người mới hoặc quay lại được DM mã thành viên
 * (người đang `active` chỉ được cập nhật hồ sơ). DM lỗi (chặn DM…) chỉ ghi log.
 */
export async function onMemberJoin(ctx: Ctx, info: GuildMemberInfo, isBot: boolean): Promise<void> {
  if (isBot) return;
  const { member, created, reactivated } = await upsertMemberFromGuild(ctx, info);
  if (!created && !reactivated) return;

  const text = buildWelcomeText(member, ctx.config.publicUrl, reactivated);
  try {
    await ctx.notifier.sendDm(info.discordId, text);
  } catch (err) {
    console.error(`[bot] Không gửi được DM chào ${member.memberCode} (${info.discordId}): ${messageOf(err)}`);
  }
}

/** Người rời server → hồ sơ `left` (giữ lịch sử); id lạ thì không làm gì. */
export async function onMemberLeave(ctx: Ctx, discordId: string): Promise<void> {
  await markMemberLeft(ctx, discordId);
}

/** Đổi tên hiển thị, avatar hay role → cập nhật hồ sơ (kể cả quyền); không DM. */
export async function onMemberUpdate(ctx: Ctx, info: GuildMemberInfo, isBot = false): Promise<void> {
  if (isBot) return;
  await upsertMemberFromGuild(ctx, info);
}

/**
 * Quét toàn bộ server lúc bot sẵn sàng: tạo hồ sơ còn thiếu, đánh dấu rời hội
 * người không còn trong danh sách; không DM ai. Danh sách rỗng gần như chắc
 * chắn là fetch hỏng (thiếu intent, lỗi mạng) chứ không phải server trống →
 * bỏ qua thay vì đánh dấu cả hội rời.
 */
export async function onReadySync(ctx: Ctx, infos: GuildMemberInfo[]): Promise<void> {
  if (infos.length === 0) {
    console.warn('[bot] Danh sách thành viên từ Discord rỗng — bỏ qua đồng bộ, không đánh dấu ai rời hội');
    return;
  }
  const { created, left } = await syncGuildMembers(ctx, infos);
  console.log(`[bot] Đồng bộ thành viên: ${infos.length} trong server, ${created} mới, ${left} rời`);
}

/** Phần của GuildMember mà handler sự kiện cần (xem `GuildMemberSource`). */
export type MemberEventSource = GuildMemberSource & { user: { bot: boolean } };

export interface MemberEventHandlers {
  guildMemberAdd(member: MemberEventSource): Promise<void>;
  guildMemberRemove(member: { id: string; guild: { id: string } }): Promise<void>;
  guildMemberUpdate(oldMember: unknown, member: MemberEventSource): Promise<void>;
}

/**
 * Handler cho từng sự kiện discord.js, đã gắn `getCtx`: bỏ qua sự kiện của
 * server khác `config.discord.guildId`, chuyển GuildMember thành
 * `GuildMemberInfo` rồi gọi `onMember*`. client.ts chỉ việc
 * `client.on(event, safeHandler(name, handler))`.
 */
export function memberEventHandlers(getCtx: () => Ctx): MemberEventHandlers {
  const ours = (ctx: Ctx, member: { guild: { id: string } }): boolean =>
    member.guild.id === ctx.config.discord.guildId;

  return {
    async guildMemberAdd(member) {
      const ctx = getCtx();
      if (!ours(ctx, member)) return;
      await onMemberJoin(ctx, toGuildMemberInfo(member), member.user.bot);
    },
    async guildMemberRemove(member) {
      const ctx = getCtx();
      if (!ours(ctx, member)) return;
      await onMemberLeave(ctx, member.id);
    },
    async guildMemberUpdate(_oldMember, member) {
      const ctx = getCtx();
      if (!ours(ctx, member)) return;
      await onMemberUpdate(ctx, toGuildMemberInfo(member), member.user.bot);
    },
  };
}

/**
 * Bọc handler sự kiện discord.js: mọi lỗi (ném đồng bộ hay reject) được ghi log
 * kèm tên handler và không bao giờ lan ra ngoài — một sự kiện hỏng không làm
 * sập bot.
 */
export function safeHandler<A extends unknown[]>(
  name: string,
  fn: (...args: A) => Promise<void>,
): (...args: A) => void {
  return (...args) => {
    void (async () => {
      try {
        await fn(...args);
      } catch (err) {
        console.error(`[bot] Lỗi trong handler ${name}:`, err);
      }
    })();
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
