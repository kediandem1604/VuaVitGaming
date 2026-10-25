/**
 * Dùng bot để tạo nhóm kênh "GGD Hub" (lịch chơi, vote MVP, thông báo, highlight) trên server
 * Discord và in ID kênh dạng `KEY=ID` ra stdout; thông báo cho người đọc in ra stderr. Cũng in
 * danh sách role của server kèm ID để chọn role admin/mod. Chạy lại an toàn: ID kênh đã có trong
 * biến môi trường (`docker compose run` nạp `deploy/server/.env`) mà vẫn là kênh văn bản của
 * server thì được giữ nguyên dù kênh/nhóm đã đổi tên; còn lại dùng kênh cùng tên hoặc tạo mới
 * (máy chủ đã có ba kênh đầu chỉ được tạo thêm #highlight).
 *
 * Cần DISCORD_TOKEN và DISCORD_GUILD_ID; bốn biến DISCORD_*_CHANNEL_ID không bắt buộc (trống =
 * chưa có). Bot phải có quyền **Manage Channels** và
 * **Attach Files** trên server. Trên máy chủ chạy qua `bash deploy/server/discord-setup.sh`
 * (tự ghi ID vào .env); ở máy: `npx tsx src/server/tools/setup-discord.ts`.
 *
 * Quyền của kênh mới: mọi người xem và đọc lịch sử nhưng không nhắn (chỉ bot đăng tin; nút và
 * menu vote vẫn bấm được); bot xem, gửi, nhúng link, đọc lịch sử — ở #highlight thêm đính kèm
 * file. Discord chỉ cho bot đặt những quyền chính nó đang có, nên danh sách quyền giữ đúng bộ
 * quyền bot được mời với, và Attach Files được kiểm trước khi tạo kênh (thiếu thì tạo #highlight
 * sẽ lỗi giữa chừng).
 */

import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits, type Guild } from 'discord.js';
import { CHANNELS, ensureChannels, envLines, sameChannelName, type ChannelAdmin, type KnownChannelIds } from './discord-channels.js';

const log = (line = '') => process.stderr.write(`${line}\n`);

/** Lỗi đã có lời giải thích cho người dùng — in ra rồi thoát với mã 1 (không in stack). */
class SetupError extends Error {}

function fail(message: string): never {
  throw new SetupError(message);
}

/**
 * Loại kênh giữ được theo ID: kênh văn bản, và kênh thông báo (Announcement) mà admin tự điền —
 * bot gửi tin, nút và menu vào đó được như kênh văn bản.
 */
const KEEPABLE_TYPES: ReadonlySet<ChannelType> = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

function channelAdmin(guild: Guild, botId: string): ChannelAdmin {
  const all = () => guild.channels.fetch();
  return {
    // Tra trong danh sách kênh của chính server: ID đã xoá, của server khác hay ID rác đều
    // không có trong đó → null, không phải bắt lỗi Unknown Channel / kênh khác server.
    textChannelById: async (id) => {
      const channel = (await all()).get(id);
      return channel && KEEPABLE_TYPES.has(channel.type) ? { id: channel.id, parentId: channel.parentId } : null;
    },
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
                ...(plan.botAttachFiles ? [PermissionFlagsBits.AttachFiles] : []),
              ],
            },
          ],
        })
      ).id,
  };
}

/** ID kênh đang có trong biến môi trường (đã cắt khoảng trắng); trống hay không đặt thì bỏ qua. */
function knownChannelIds(): KnownChannelIds {
  const known: KnownChannelIds = {};
  for (const { envKey } of CHANNELS) {
    const value = process.env[envKey]?.trim();
    if (value) known[envKey] = value;
  }
  return known;
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
    // Kiểm trước khi tạo kênh: Discord chỉ cho bot cấp trong overwrite những quyền chính nó đang
    // có, nên thiếu Attach Files thì ba kênh đầu tạo xong còn #highlight lỗi giữa chừng.
    if (!me.permissions.has(PermissionFlagsBits.AttachFiles)) {
      fail(
        'bot chưa có quyền Attach Files (cần cho kênh #highlight). Server Settings → Roles → role của bot' +
          ' → bật "Attach Files" (hoặc mời lại bot bằng link ở README mục 2.2), rồi chạy lại.',
      );
    }

    log(`Server: ${guild.name}`);
    const known = knownChannelIds();
    const result = await ensureChannels(channelAdmin(guild, me.id), known);
    log(`Nhóm kênh: ${result.categoryId === null ? 'không cần (cả bốn kênh giữ theo ID trong .env)' : result.categoryCreated ? 'đã tạo' : 'đã có'}`);
    for (const channel of result.channels) {
      if (channel.keptById) {
        log(`  #${channel.name} (${channel.envKey}): đã có — giữ kênh ${channel.id} theo ID trong .env`);
        continue;
      }
      // ID trong .env không còn dùng được: báo rõ vì dòng này trong .env sắp bị ghi đè.
      const stale = known[channel.envKey];
      if (stale) log(`  ${channel.envKey}=${stale} trong .env không còn là kênh văn bản của server — thay bằng kênh dưới đây`);
      log(`  #${channel.name} (${channel.envKey}): ${channel.created ? 'đã tạo' : 'đã có'}`);
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
