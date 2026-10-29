/**
 * `DiscordNotifier` thật trên discord.js: DM, kênh thông báo, tin buổi chơi (embed +
 * nút, dựng bởi `buildSessionMessage`), tin vote (embed + menu, dựng bởi
 * `buildVoteMessage`) và highlight (file kèm một dòng chú thích trong kênh `#highlight`).
 * Mọi lỗi Discord được ném ra — service coi đó là "đăng bù sau" (cờ `discordDirty`,
 * `resultPending`) hay "thử lại sau" (highlight); riêng "Unknown Message" khi sửa tin
 * thành `MessageGoneError` để service đăng lại (tin buổi) hay bỏ qua (tin vote) thay vì
 * thử sửa mãi, và lỗi đăng highlight không tự hết thành `HighlightChannelError` /
 * `HighlightRejectedTooLargeError` (service báo đúng lỗi thay vì "thử lại sau"). Giới hạn
 * 2000 ký tự của tin văn bản là việc của nơi gọi.
 */

import { DiscordAPIError, GuildPremiumTier, RESTJSONErrorCodes, escapeMarkdown } from 'discord.js';
import type { APIEmbed, Client, SendableChannels } from 'discord.js';
import type { Config } from '../config.js';
import { HighlightChannelError, HighlightRejectedTooLargeError, MessageGoneError } from '../ports.js';
import type { BountyCompletedPost, DiscordNotifier, HighlightPost, SessionView, VotePrompt } from '../ports.js';
import { buildSessionMessage, buildVoteMessage } from './embeds.js';

/** Giới hạn tải lên của Discord theo cấp boost (spec §5): chưa boost / cấp 1 → 10 MiB; cấp 2–3 → 50 MiB (trần của app). */
const UPLOAD_LIMIT_BASE = 10 * 1024 * 1024;
const UPLOAD_LIMIT_BOOSTED = 50 * 1024 * 1024;

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

  /**
   * Gửi vào kênh thông báo đã cấu hình; kênh không tồn tại hay không gửi tin được → ném lỗi.
   * Không ping ai dù chữ có dạng @mention (tên người trong tổng kết là do thành viên tự đặt);
   * không tin thông báo nào của app cần ping.
   */
  async announce(text: string): Promise<void> {
    const channel = await this.sendableChannel(this.config.discord.announceChannelId, 'thông báo');
    await channel.send({ content: text, allowedMentions: { parse: [] } });
  }

  /**
   * Giới hạn tải lên theo `premiumTier` của server. `guilds.fetch` trả bản trong cache của
   * discord.js (có từ lúc đăng nhập, cập nhật theo sự kiện GUILD_UPDATE khi cấp boost đổi) — không
   * gọi mạng mỗi lần, nên route tải highlight hỏi được ngay ở cổng; chỉ gọi REST khi cache chưa có.
   */
  async highlightUploadLimit(): Promise<number> {
    const guild = await this.client.guilds.fetch(this.config.discord.guildId);
    const boosted = guild.premiumTier === GuildPremiumTier.Tier2 || guild.premiumTier === GuildPremiumTier.Tier3;
    return boosted ? UPLOAD_LIMIT_BOOSTED : UPLOAD_LIMIT_BASE;
  }

  /**
   * Đăng file kèm dòng `🎬 Highlight — **Tên** · {icon} {role} · {giá trị} {chỉ số} · {dd/mm/yyyy}`
   * vào kênh highlight. Tên người được escape Markdown; không ping ai dù tên có dạng @mention.
   * Lỗi chỉ admin sửa được — chưa cấu hình kênh (service đã chặn trước), kênh mất / không gửi tin
   * được, bot thiếu quyền (50013, 50001, 10003) → `HighlightChannelError`; Discord chê file quá lớn
   * (40005, hay 413 không kèm mã) → `HighlightRejectedTooLargeError`; lỗi khác ném nguyên vẹn.
   */
  async postHighlight(post: HighlightPost): Promise<{ channelId: string; messageId: string }> {
    const channelId = this.config.discord.highlightChannelId;
    if (channelId === null) throw new HighlightChannelError('Chưa cấu hình kênh highlight (DISCORD_HIGHLIGHT_CHANNEL_ID)');
    const content = `🎬 Highlight — **${escapeMarkdown(post.memberName)}** · ${post.roleLabel} · ${post.valueText} · ${post.playedOnText}`;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new HighlightChannelError(`Kênh highlight ${channelId} không phải kênh văn bản gửi tin được`);
      }
      const message = await channel.send({
        content,
        files: [{ attachment: post.data, name: post.fileName }],
        allowedMentions: { parse: [] },
      });
      return { channelId, messageId: message.id };
    } catch (err) {
      throw asHighlightError(err, channelId);
    }
  }

  /**
   * Xoá tin `messageId` trong kênh `channelId` (kênh highlight cũ — có thể khác kênh đang
   * cấu hình). Tin đã bị xoá tay (10008) hay kênh đã mất (10003) → coi như xong; lỗi khác
   * (thiếu quyền, mạng) ném ra để nơi gọi ghi log.
   */
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    try {
      const channel = await this.sendableChannel(channelId, 'highlight');
      await channel.messages.delete(messageId);
    } catch (err) {
      if (isUnknownMessage(err) || isUnknownChannel(err)) return;
      throw err;
    }
  }

  /**
   * TẠM (Task 3 cài thật): kênh `#treo-thưởng` (`DISCORD_BOUNTY_CHANNEL_ID`) chưa có trong cấu hình nên
   * chưa đăng gì — chỉ ghi log để biết lần duyệt đã tới đây. Bản thật đăng
   * `✅ {tên} hoàn thành **{mục}** +{điểm}` (escape Markdown, không ping) như mô tả ở `BountyCompletedPost`.
   */
  async postBountyCompleted(post: BountyCompletedPost): Promise<void> {
    console.info(`[bot] Chưa cấu hình kênh treo thưởng — bỏ qua thông báo: ${post.memberName} hoàn thành ${post.bountyTitle} +${post.points}`);
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

/** Mã lỗi Discord khi đăng vào kênh mà thử lại cũng không qua: thiếu quyền, mất quyền xem, kênh đã bị xoá. */
const HIGHLIGHT_CHANNEL_CODES: ReadonlySet<unknown> = new Set([
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.UnknownChannel,
]);

/** Lỗi khi đăng highlight → lỗi có kiểu của cổng (giữ lỗi gốc ở `cause`); lỗi khác trả về nguyên vẹn. */
function asHighlightError(err: unknown, channelId: string): unknown {
  if (!(err instanceof DiscordAPIError)) return err;
  if (HIGHLIGHT_CHANNEL_CODES.has(err.code)) {
    return new HighlightChannelError(`Bot không đăng được vào kênh highlight ${channelId}: ${err.message}`, { cause: err });
  }
  // 413 mà thân lỗi không phải JSON (trang lỗi của proxy) thì discord.js không có mã.
  if (err.code === RESTJSONErrorCodes.RequestEntityTooLarge || err.status === 413) {
    return new HighlightRejectedTooLargeError(`Discord từ chối file highlight vì quá lớn: ${err.message}`, { cause: err });
  }
  return err;
}

function isUnknownMessage(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage;
}

function isUnknownChannel(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownChannel;
}
