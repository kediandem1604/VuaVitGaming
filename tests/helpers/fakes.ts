import type {
  DiscordNotifier,
  GuildDirectory,
  GuildMemberInfo,
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
 * `publishSession`/`publishVote` trả `msg-<n>` từ MỘT bộ đếm chung, bắt đầu từ 1.
 */
export class FakeNotifier implements DiscordNotifier {
  dms: { discordId: string; text: string }[] = [];
  published: SessionView[] = [];
  updated: { messageId: string; view: SessionView }[] = [];
  votes: VotePrompt[] = [];
  closedVotes: { messageId: string; resultText: string }[] = [];
  announcements: string[] = [];
  down = false;
  failDmFor = new Set<string>();

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
    this.updated.push({ messageId, view });
  }

  async publishVote(prompt: VotePrompt): Promise<string> {
    this.assertUp();
    this.votes.push(prompt);
    return this.nextMessageId();
  }

  async closeVote(messageId: string, resultText: string): Promise<void> {
    this.assertUp();
    this.closedVotes.push({ messageId, resultText });
  }

  async announce(text: string): Promise<void> {
    this.assertUp();
    this.announcements.push(text);
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
