/**
 * Dùng bot để tạo nhóm kênh "GGD Hub" (lịch chơi, vote MVP, thông báo) trên server Discord
 * và in ID kênh dạng `KEY=ID` ra stdout; thông báo cho người đọc in ra stderr. Cũng in danh
 * sách role của server kèm ID để chọn role admin/mod. Chạy lại an toàn (dùng lại kênh cùng tên).
 *
 * Chỉ cần DISCORD_TOKEN và DISCORD_GUILD_ID. Bot phải có quyền **Manage Channels** trên server.
 * Trên máy chủ chạy qua `bash deploy/server/discord-setup.sh` (tự ghi ID vào .env);
 * ở máy: `npx tsx src/server/tools/setup-discord.ts`.
 *
 * Quyền của kênh mới: mọi người xem và đọc lịch sử nhưng không nhắn (chỉ bot đăng tin; nút và
 * menu vote vẫn bấm được); bot xem, gửi, nhúng link, đọc lịch sử. Discord chỉ cho bot đặt
 * những quyền chính nó đang có, nên danh sách quyền giữ đúng bộ quyền bot được mời với.
 */

import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits, type Guild } from 'discord.js';
import { ensureChannels, envLines, sameChannelName, type ChannelAdmin } from './discord-channels.js';

const log = (line = '') => process.stderr.write(`${line}\n`);

/** Lỗi đã có lời giải thích cho người dùng — in ra rồi thoát với mã 1 (không in stack). */
class SetupError extends Error {}

function fail(message: string): never {
  throw new SetupError(message);
}

function channelAdmin(guild: Guild, botId: string): ChannelAdmin {
  const all = () => guild.channels.fetch();
  return {
    findCategory: async (name) =>
      (await all()).find((c) => c?.type === ChannelType.GuildCategory && sameChannelName(c.name, name))?.id ?? null,
    createCategory: async (name) => (await guild.channels.create({ name, type: ChannelType.GuildCategory })).id,
    findTextChannel: async (name, categoryId) =>
      (await all()).find(
        (c) => c?.type === ChannelType.GuildText && c.parentId === categoryId && sameChannelName(c.name, name),
      )?.id ?? null,
    createTextChannel: async (plan, categoryId) =>
      (
        await guild.channels.create({
          name: plan.name,
          type: ChannelType.GuildText,
          parent: categoryId,
          topic: plan.topic,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
              deny: [PermissionFlagsBits.SendMessages],
            },
            {
              id: botId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
          ],
        })
      ).id,
  };
}

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!token) fail('thiếu DISCORD_TOKEN (README mục 2.1).');
  if (!guildId) fail('thiếu DISCORD_GUILD_ID (README mục 3).');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  // Luôn đóng kết nối Discord trước khi thoát (process.exit giữa lúc đóng socket làm Node
  // văng lỗi trên Windows); mã thoát đặt qua process.exitCode ở cuối file.
  try {
    const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
    try {
      await client.login(token);
    } catch {
      fail('bot không đăng nhập được — kiểm tra lại DISCORD_TOKEN (Developer Portal → Bot → Reset Token).');
    }
    await ready;

    let guild: Guild;
    try {
      guild = await client.guilds.fetch(guildId);
    } catch {
      fail('không thấy server — bot chưa được mời vào server (README mục 2.2) hoặc DISCORD_GUILD_ID sai.');
    }
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      fail(
        'bot chưa có quyền Manage Channels. Server Settings → Roles → role của bot → bật "Manage Channels"' +
          ' (hoặc mời lại bot bằng link ở README mục 2.2), rồi chạy lại.',
      );
    }

    log(`Server: ${guild.name}`);
    const result = await ensureChannels(channelAdmin(guild, me.id));
    log(`Nhóm kênh: ${result.categoryCreated ? 'đã tạo' : 'đã có'}`);
    for (const channel of result.channels) {
      log(`  #${channel.name}: ${channel.created ? 'đã tạo' : 'đã có'} (${channel.envKey})`);
    }

    const roles = [...(await guild.roles.fetch()).values()]
      .filter((role) => role.id !== guild.roles.everyone.id && !role.managed)
      .sort((a, b) => b.position - a.position);
    log();
    log('Role trong server (chọn ID cho DISCORD_ADMIN_ROLE_IDS và DISCORD_MOD_ROLE_IDS):');
    if (roles.length === 0) log('  (server chưa có role nào ngoài @everyone — tạo role Admin/Mod trong Server Settings → Roles)');
    for (const role of roles) log(`  ${role.name}: ${role.id}`);

    process.stdout.write(`${envLines(result).join('\n')}\n`);
  } finally {
    await client.destroy();
  }
}

main().catch((err: unknown) => {
  log(`Lỗi: ${err instanceof Error ? err.message : String(err)}`);
  if (!(err instanceof SetupError) && err instanceof Error && err.stack) log(err.stack);
  process.exitCode = 1;
});
