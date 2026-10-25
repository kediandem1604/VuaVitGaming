import { MessageGoneError } from '../../src/server/ports.js';
import type {
  DiscordNotifier,
  GuildDirectory,
  GuildMemberInfo,
  HighlightPost,
  Mailer,
  SessionView,
  VotePrompt,
} from '../../src/server/ports.js';

/** Ghi lại email đã gửi; ném lỗi với địa chỉ nằm trong `failFor`. */
export class FakeMailer implements Mailer {
  sent: { to: string; subject: string; text: string }[] = [];
  failFor = new Set<string>();

  async send(to: string, subject: string, text: string): Promise<void> {
    if (this.failFor.has(to)) throw new Error(`FakeMailer: không gửi được tới ${to}`);
    this.sent.push({ to, subject, text });
  }
}

/**
 * Ghi lại mọi lời gọi Discord. Khi `down` là true, mọi hàm đều ném lỗi.
 * `publishSession`/`publishVote`/`postHighlight` trả `msg-<n>` từ MỘT bộ đếm chung, bắt đầu từ 1.
 * `publishVote` với danh sách ứng viên rỗng ném lỗi (Discord từ chối menu 0 lựa chọn).
 * `updateSession`/`closeVote` với id trong `goneMessageIds` ném `MessageGoneError` (tin đã bị xoá).
 * `postHighlight` đăng vào kênh `highlightChannelId`, gọi `onPostHighlight` (nếu có) ngay trước khi
 * trả kết quả — để test chen một thao tác vào giữa lúc "đang tải lên"; `deleteMessage` chỉ ghi lại.
 */
export class FakeNotifier implements DiscordNotifier {
  dms: { discordId: string; text: string }[] = [];
  published: SessionView[] = [];
  updated: { messageId: string; view: SessionView }[] = [];
  votes: VotePrompt[] = [];
  closedVotes: { messageId: string; resultText: string }[] = [];
  announcements: string[] = [];
  highlights: (HighlightPost & { channelId: string; messageId: string })[] = [];
  deletedMessages: { channelId: string; messageId: string }[] = [];
  /** Giới hạn tải lên giả (mặc định 10 MiB — server chưa boost); gán lại để giả cấp 2–3. */
  uploadLimit = 10 * 1024 * 1024;
  highlightChannelId = 'ch-highlight';
  onPostHighlight?: () => Promise<void>;
  down = false;
  failDmFor = new Set<string>();
  goneMessageIds = new Set<string>();

  private messageCounter = 0;

  async sendDm(discordId: string, text: string): Promise<void> {
    this.assertUp();
    if (this.failDmFor.has(discordId)) throw new Error(`FakeNotifier: không gửi được DM tới ${discordId}`);
    this.dms.push({ discordId, text });
  }

  async publishSession(view: SessionView): Promise<string> {
    this.assertUp();
    this.published.push(view);
    return this.nextMessageId();
  }

  async updateSession(messageId: string, view: SessionView): Promise<void> {
    this.assertUp();
    if (this.goneMessageIds.has(messageId)) throw new MessageGoneError(`FakeNotifier: tin ${messageId} đã bị xoá`);
    this.updated.push({ messageId, view });
  }

  async publishVote(prompt: VotePrompt): Promise<string> {
    this.assertUp();
    // Discord từ chối menu chọn không có lựa chọn nào — bản giả bắt chước để test không lọt lỗi này.
    if (prompt.nominees.length === 0) throw new Error('Discord không nhận menu rỗng');
    this.votes.push(prompt);
    return this.nextMessageId();
  }

  async closeVote(messageId: string, resultText: string): Promise<void> {
    this.assertUp();
    if (this.goneMessageIds.has(messageId)) throw new MessageGoneError(`FakeNotifier: tin ${messageId} đã bị xoá`);
    this.closedVotes.push({ messageId, resultText });
  }

  async announce(text: string): Promise<void> {
    this.assertUp();
    this.announcements.push(text);
  }

  async highlightUploadLimit(): Promise<number> {
    this.assertUp();
    return this.uploadLimit;
  }

  async postHighlight(post: HighlightPost): Promise<{ channelId: string; messageId: string }> {
    this.assertUp();
    const location = { channelId: this.highlightChannelId, messageId: this.nextMessageId() };
    this.highlights.push({ ...post, ...location });
    await this.onPostHighlight?.();
    return location;
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    this.assertUp();
    this.deletedMessages.push({ channelId, messageId });
  }

  private assertUp(): void {
    if (this.down) throw new Error('FakeNotifier: Discord đang sập');
  }

  private nextMessageId(): string {
    this.messageCounter += 1;
    return `msg-${this.messageCounter}`;
  }
}

/** Danh bạ server Discord giả: tra trong `members`; ném lỗi khi `down`. */
export class FakeDirectory implements GuildDirectory {
  members = new Map<string, GuildMemberInfo>();
  down = false;

  async getMember(discordId: string): Promise<GuildMemberInfo | null> {
    if (this.down) throw new Error('FakeDirectory: Discord đang sập');
    return this.members.get(discordId) ?? null;
  }
}
