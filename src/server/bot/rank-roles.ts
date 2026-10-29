/**
 * Quản lý role thứ hạng trên server Discord thật. Đọc role và người mang role từ cache của
 * client: intent Guilds giữ cache role, intent GuildMembers cùng lần quét toàn server lúc sẵn
 * sàng (client.ts) giữ cache thành viên — nên mỗi lượt đồng bộ chỉ gọi REST khi thật sự đổi.
 */

import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { Client, Guild } from 'discord.js';
import { RankRolePermissionError } from '../ports.js';
import type { RankRoleAdmin, RankRoleSpec } from '../ports.js';

const REASON = 'GGD Hub: top 3 mỗi phe';

export class DiscordRankRoles implements RankRoleAdmin {
  constructor(
    private readonly client: Client,
    private readonly guildId: string,
  ) {}

  async ensureRole(spec: RankRoleSpec, knownId: string | null): Promise<string> {
    const guild = await this.guild();
    if (knownId !== null && guild.roles.cache.has(knownId)) return knownId;
    const byName = guild.roles.cache.find((role) => role.name === spec.name);
    if (byName) return byName.id;
    try {
      const role = await guild.roles.create({
        name: spec.name,
        colors: { primaryColor: spec.color },
        hoist: spec.hoist,
        mentionable: false,
        permissions: [],
        reason: REASON,
      });
      return role.id;
    } catch (err) {
      throw asPermissionError(err, `Bot không tạo được role "${spec.name}" — cần quyền Manage Roles`);
    }
  }

  async holders(roleId: string): Promise<string[]> {
    const guild = await this.guild();
    return [...(guild.roles.cache.get(roleId)?.members.keys() ?? [])];
  }

  async addRole(discordId: string, roleId: string): Promise<void> {
    const guild = await this.guild();
    try {
      await guild.members.addRole({ user: discordId, role: roleId, reason: REASON });
    } catch (err) {
      if (isUnknownMember(err)) return;
      throw asPermissionError(err, `Bot không gắn được role ${roleId} — role của bot phải nằm trên role này`);
    }
  }

  async removeRole(discordId: string, roleId: string): Promise<void> {
    const guild = await this.guild();
    try {
      await guild.members.removeRole({ user: discordId, role: roleId, reason: REASON });
    } catch (err) {
      if (isUnknownMember(err)) return;
      throw asPermissionError(err, `Bot không gỡ được role ${roleId} — role của bot phải nằm trên role này`);
    }
  }

  private async guild(): Promise<Guild> {
    if (!this.client.isReady()) throw new Error('Bot Discord chưa sẵn sàng');
    return this.client.guilds.fetch(this.guildId);
  }
}

function isUnknownMember(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember;
}

/** Lỗi thiếu quyền → `RankRolePermissionError` (giữ lỗi gốc ở `cause`); lỗi khác giữ nguyên. */
function asPermissionError(err: unknown, message: string): unknown {
  const denied =
    err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.MissingPermissions || err.code === RESTJSONErrorCodes.MissingAccess);
  return denied ? new RankRolePermissionError(message, { cause: err }) : err;
}
