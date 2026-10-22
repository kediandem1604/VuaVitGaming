/**
 * `DiscordNotifier` thật trên discord.js: DM, kênh thông báo, tin buổi chơi (embed +
 * nút, dựng bởi `buildSessionMessage`) và tin vote (embed + menu, dựng bởi
 * `buildVoteMessage`). Mọi lỗi Discord được ném ra — service coi đó là "đăng bù sau"
 * (cờ `discordDirty`, `resultPending`); riêng "Unknown Message" khi sửa tin thành
 * `MessageGoneError` để service đăng lại (tin buổi) hay bỏ qua (tin vote) thay vì thử
 * sửa mãi. Giới hạn 2000 ký tự của tin văn bản là việc của nơi gọi.
 */

import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { APIEmbed, Client, SendableChannels } from 'discord.js';
import type { Config } from '../config.js';
import { MessageGoneError } from '../ports.js';
import type { DiscordNotifier, SessionView, VotePrompt } from '../ports.js';
import { buildSessionMessage, buildVoteMessage } from './embeds.js';

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

  /**
   * Sửa tin đã đăng theo trạng thái mới (kể cả bỏ nút khi buổi huỷ / kết thúc).
   * Tin đã bị xoá (Discord 10008 Unknown Message) → `MessageGoneError`; lỗi khác giữ nguyên.
   */
  async updateSession(messageId: string, view: SessionView): Promise<void> {
    const channel = await this.scheduleChannel();
    try {
      await channel.messages.edit(messageId, buildSessionMessage(view));
    } catch (err) {
      throw asMessageGone(err, messageId);
    }
  }

  /** Đăng tin vote (embed + menu) vào kênh vote; trả về id tin để sửa thành kết quả về sau. */
  async publishVote(prompt: VotePrompt): Promise<string> {
    const channel = await this.voteChannel();
    const message = await channel.send(buildVoteMessage(prompt));
    return message.id;
  }

  /**
   * Đóng tin vote: đọc lại tin, giữ nguyên embed gốc, thêm dòng "Kết quả" và chân
   * "Đã đóng vote", bỏ menu. Tin đã bị xoá (10008, khi đọc hay khi sửa) →
   * `MessageGoneError`; lỗi khác giữ nguyên.
   */
  async closeVote(messageId: string, resultText: string): Promise<void> {
    const channel = await this.voteChannel();
    try {
      const message = await channel.messages.fetch(messageId);
      const original: APIEmbed = message.embeds[0]?.toJSON() ?? {};
      const embed: APIEmbed = {
        ...original,
        fields: [...(original.fields ?? []), { name: 'Kết quả', value: resultText }],
        footer: { text: 'Đã đóng vote' },
      };
      await channel.messages.edit(messageId, { embeds: [embed], components: [] });
    } catch (err) {
      throw asMessageGone(err, messageId);
    }
  }

  /** Gửi vào kênh thông báo đã cấu hình; kênh không tồn tại hay không gửi tin được → ném lỗi. */
  async announce(text: string): Promise<void> {
    const channel = await this.sendableChannel(this.config.discord.announceChannelId, 'thông báo');
    await channel.send(text);
  }

  private scheduleChannel(): Promise<SendableChannels> {
    return this.sendableChannel(this.config.discord.scheduleChannelId, 'lịch chơi');
  }

  private voteChannel(): Promise<SendableChannels> {
    return this.sendableChannel(this.config.discord.voteChannelId, 'vote');
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

/** Lỗi khi sửa tin `messageId`: 10008 Unknown Message → `MessageGoneError` (giữ lỗi gốc ở `cause`); lỗi khác trả về nguyên vẹn. */
function asMessageGone(err: unknown, messageId: string): unknown {
  return isUnknownMessage(err) ? new MessageGoneError(`Tin Discord ${messageId} không còn tồn tại`, { cause: err }) : err;
}

function isUnknownMessage(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage;
}
