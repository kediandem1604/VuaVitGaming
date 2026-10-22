/**
 * `DiscordNotifier` thật trên discord.js. Task này chỉ có DM và kênh thông báo;
 * embed buổi chơi (Task 9) và tin vote (Task 13) còn ném "Chưa hỗ trợ" — service
 * coi lỗi Discord là "đăng bù sau" nên vô hại. Giới hạn 2000 ký tự của Discord
 * là việc của nơi gọi; ở đây không cắt.
 */

import type { Client } from 'discord.js';
import type { Config } from '../config.js';
import type { DiscordNotifier, SessionView, VotePrompt } from '../ports.js';

export class DiscordJsNotifier implements DiscordNotifier {
  constructor(
    private readonly client: Client,
    private readonly config: Config,
  ) {}

  /** DM qua REST; ném lỗi khi người nhận chặn DM hay bot chưa đăng nhập — nơi gọi tự ghi nhận. */
  async sendDm(discordId: string, text: string): Promise<void> {
    await this.client.users.send(discordId, text);
  }

  async publishSession(_view: SessionView): Promise<string> {
    throw new Error('Chưa hỗ trợ');
  }

  async updateSession(_messageId: string, _view: SessionView): Promise<void> {
    throw new Error('Chưa hỗ trợ');
  }

  async publishVote(_prompt: VotePrompt): Promise<string> {
    throw new Error('Chưa hỗ trợ');
  }

  async closeVote(_messageId: string, _resultText: string): Promise<void> {
    throw new Error('Chưa hỗ trợ');
  }

  /** Gửi vào kênh thông báo đã cấu hình; kênh không tồn tại hay không gửi tin được → ném lỗi. */
  async announce(text: string): Promise<void> {
    const channelId = this.config.discord.announceChannelId;
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isSendable()) {
      throw new Error(`Kênh thông báo ${channelId} không phải kênh văn bản gửi tin được`);
    }
    await channel.send(text);
  }
}
