/**
 * `DiscordNotifier` thật trên discord.js: DM, kênh thông báo và tin buổi chơi
 * (embed + nút, dựng bởi `buildSessionMessage`). Tin vote (Task 13) còn ném
 * "Chưa hỗ trợ". Mọi lỗi Discord được ném ra — service coi đó là "đăng bù sau"
 * (cờ `discordDirty`). Giới hạn 2000 ký tự của tin văn bản là việc của nơi gọi.
 */

import type { Client, SendableChannels } from 'discord.js';
import type { Config } from '../config.js';
import type { DiscordNotifier, SessionView, VotePrompt } from '../ports.js';
import { buildSessionMessage } from './embeds.js';

export class DiscordJsNotifier implements DiscordNotifier {
  constructor(
    private readonly client: Client,
    private readonly config: Config,
  ) {}

  /** DM qua REST; ném lỗi khi người nhận chặn DM hay bot chưa đăng nhập — nơi gọi tự ghi nhận. */
  async sendDm(discordId: string, text: string): Promise<void> {
    await this.client.users.send(discordId, text);
  }

  /** Đăng tin buổi chơi vào kênh lịch chơi; trả về id tin để sửa về sau. */
  async publishSession(view: SessionView): Promise<string> {
    const channel = await this.scheduleChannel();
    const message = await channel.send(buildSessionMessage(view));
    return message.id;
  }

  /** Sửa tin đã đăng theo trạng thái mới (kể cả bỏ nút khi buổi huỷ / kết thúc). */
  async updateSession(messageId: string, view: SessionView): Promise<void> {
    const channel = await this.scheduleChannel();
    await channel.messages.edit(messageId, buildSessionMessage(view));
  }

  async publishVote(_prompt: VotePrompt): Promise<string> {
    throw new Error('Chưa hỗ trợ');
  }

  async closeVote(_messageId: string, _resultText: string): Promise<void> {
    throw new Error('Chưa hỗ trợ');
  }

  /** Gửi vào kênh thông báo đã cấu hình; kênh không tồn tại hay không gửi tin được → ném lỗi. */
  async announce(text: string): Promise<void> {
    const channel = await this.sendableChannel(this.config.discord.announceChannelId, 'thông báo');
    await channel.send(text);
  }

  private scheduleChannel(): Promise<SendableChannels> {
    return this.sendableChannel(this.config.discord.scheduleChannelId, 'lịch chơi');
  }

  /** Kênh theo id; không tồn tại hay không gửi tin được (kênh thoại, danh mục…) → ném lỗi. */
  private async sendableChannel(channelId: string, label: string): Promise<SendableChannels> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isSendable()) {
      throw new Error(`Kênh ${label} ${channelId} không phải kênh văn bản gửi tin được`);
    }
    return channel;
  }
}
