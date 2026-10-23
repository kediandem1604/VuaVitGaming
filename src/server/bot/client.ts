/**
 * Dựng discord.js Client: intent, handler sự kiện (bọc `safeHandler`), đồng bộ
 * thành viên lúc sẵn sàng, cùng notifier và danh bạ thật dùng client này.
 * `getCtx` là hàm vì Ctx cần notifier/directory của chính bot — main.ts dựng
 * Ctx sau khi tạo bot.
 */

import { Client, Events, GatewayIntentBits } from 'discord.js';
import type { Interaction } from 'discord.js';
import type { Config } from '../config.js';
import type { Ctx } from '../ctx.js';
import type { DiscordNotifier, GuildDirectory } from '../ports.js';
import { commandDefinitions } from './commands.js';
import { DiscordJsNotifier } from './discord-notifier.js';
import { DiscordGuildDirectory, toGuildMemberInfo } from './guild-directory.js';
import { handleInteraction } from './interactions.js';
import { memberEventHandlers, onReadySync, safeHandler } from './member-events.js';

export interface Bot {
  client: Client;
  notifier: DiscordNotifier;
  directory: GuildDirectory;
  /** Đăng nhập và chờ tới khi client sẵn sàng; reject nếu token sai hay không nối được. */
  start(): Promise<void>;
}

export function createBot(getCtx: () => Ctx, config: Config): Bot {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  const { guildId, token } = config.discord;

  const handlers = memberEventHandlers(getCtx);
  client.on(Events.GuildMemberAdd, safeHandler('guildMemberAdd', handlers.guildMemberAdd));
  client.on(Events.GuildMemberRemove, safeHandler('guildMemberRemove', handlers.guildMemberRemove));
  client.on(Events.GuildMemberUpdate, safeHandler('guildMemberUpdate', handlers.guildMemberUpdate));

  // Nút Tham gia/Huỷ, menu vote, lệnh slash và autocomplete đều đi qua một cửa.
  client.on(
    Events.InteractionCreate,
    safeHandler('interactionCreate', (interaction: Interaction) => handleInteraction(getCtx(), interaction)),
  );

  // Mỗi lần sẵn sàng (đăng nhập lại cũng vậy): đăng ký lệnh slash rồi quét toàn bộ server để đồng bộ.
  client.on(
    Events.ClientReady,
    safeHandler('clientReady', async (ready: Client<true>) => {
      console.log(`[bot] Đã đăng nhập Discord với tên ${ready.user.tag}`);
      await registerCommands(ready, guildId);
      const guild = await ready.guilds.fetch(guildId);
      const members = await guild.members.fetch();
      const infos = members.filter((m) => !m.user.bot).map((m) => toGuildMemberInfo(m));
      await onReadySync(getCtx(), infos);
    }),
  );

  client.on(Events.Error, (err) => console.error('[bot] Lỗi client Discord:', err));
  client.on(Events.ShardError, (err, shardId) => console.error(`[bot] Lỗi shard ${shardId}:`, err));
  client.on(Events.Warn, (message) => console.warn(`[bot] Cảnh báo Discord: ${message}`));
  client.on(Events.Invalidated, () => console.error('[bot] Phiên Discord bị vô hiệu — cần khởi động lại tiến trình'));

  return {
    client,
    notifier: new DiscordJsNotifier(client, config),
    directory: new DiscordGuildDirectory(client, guildId),
    start: () => loginAndWaitReady(client, token),
  };
}

/**
 * Đăng ký lệnh slash THEO SERVER (`set` thay cả bộ, nên lệnh bỏ đi cũng biến mất):
 * cập nhật ngay, trong khi lệnh toàn cục mất tới một giờ. Lỗi chỉ ghi log — bot vẫn
 * chạy với bộ lệnh đã đăng ký lần trước, và đồng bộ thành viên vẫn tiếp tục.
 */
async function registerCommands(ready: Client<true>, guildId: string): Promise<void> {
  const definitions = commandDefinitions();
  try {
    await ready.application.commands.set(definitions, guildId);
    console.log(`[bot] Đã đăng ký ${definitions.length} lệnh slash cho server ${guildId}`);
  } catch (err) {
    console.error('[bot] Không đăng ký được lệnh slash:', err);
  }
}

/** `login` reject khi token sai hay không nối được; nếu không thì chờ `clientReady`. */
async function loginAndWaitReady(client: Client, token: string): Promise<void> {
  let onReady = (): void => {};
  const ready = new Promise<void>((resolve) => {
    onReady = resolve;
    client.once(Events.ClientReady, onReady);
  });
  try {
    await client.login(token);
    await ready;
  } catch (err) {
    client.off(Events.ClientReady, onReady);
    throw err;
  }
}
