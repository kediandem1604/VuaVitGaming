/**
 * Danh bạ server Discord thật và phép chuyển `GuildMember` → `GuildMemberInfo`
 * (dùng chung cho handler sự kiện và nút/menu/lệnh ở các task sau).
 */

import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { Client, ImageURLOptions } from 'discord.js';
import type { GuildDirectory, GuildMemberInfo } from '../ports.js';

/**
 * Phần của `GuildMember` mà việc chuyển đổi cần. Kiểu cấu trúc (GuildMember thật
 * khớp) để test dựng được đối tượng giả mà không cần discord.js.
 */
export interface GuildMemberSource {
  id: string;
  displayName: string;
  displayAvatarURL(options?: ImageURLOptions): string;
  roles: { cache: ReadonlyMap<string, unknown> };
  guild: { id: string };
  /** Ngày vào server; discord.js để null khi gateway không gửi `joined_at`. */
  joinedAt: Date | null;
}

/** Role @everyone có id trùng id server và không mang quyền gì — bỏ khỏi `roleIds`. */
export function toGuildMemberInfo(gm: GuildMemberSource): GuildMemberInfo {
  return {
    discordId: gm.id,
    displayName: gm.displayName,
    avatarUrl: gm.displayAvatarURL({ size: 128 }),
    roleIds: [...gm.roles.cache.keys()].filter((id) => id !== gm.guild.id),
    joinedAt: gm.joinedAt,
  };
}

/**
 * Tra thành viên trong server cấu hình qua REST (bỏ cache để không tin dữ liệu
 * cũ sau một quãng mất kết nối). "Unknown Member" → null (đã rời); lỗi khác
 * (chưa sẵn sàng, mạng, bot không ở trong server) → ném để đăng nhập web lùi
 * về bản ghi trong DB.
 */
export class DiscordGuildDirectory implements GuildDirectory {
  constructor(
    private readonly client: Client,
    private readonly guildId: string,
  ) {}

  async getMember(discordId: string): Promise<GuildMemberInfo | null> {
    if (!this.client.isReady()) throw new Error('Bot Discord chưa sẵn sàng');
    const guild = await this.client.guilds.fetch(this.guildId);
    try {
      return toGuildMemberInfo(await guild.members.fetch({ user: discordId, force: true }));
    } catch (err) {
      if (isUnknownMember(err)) return null;
      throw err;
    }
  }
}

function isUnknownMember(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember;
}
