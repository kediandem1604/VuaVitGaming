/**
 * Các "cổng" ra thế giới bên ngoài (email, Discord). Service chỉ phụ thuộc vào
 * interface ở đây; bản thật nằm ở adapter, bản giả nằm ở tests/helpers/fakes.ts.
 */

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export interface SessionView {
  id: number;
  startsAt: Date;
  modeName: string;
  capacity: number;
  roomCode: string | null;
  note: string | null;
  status: 'scheduled' | 'ended' | 'cancelled';
  attendees: { memberId: number; displayName: string }[];
}

export interface VotePrompt {
  roundId: number;
  categoryId: number;
  categoryName: string;
  description: string | null;
  sessionLabel: string;
  closesAt: Date;
  nominees: { memberId: number; displayName: string }[];
}

/**
 * Một highlight cần đăng vào kênh `#highlight`: file (chỉ nằm trong bộ nhớ) và các mảnh
 * của dòng chú thích — adapter ghép thành
 * `🎬 Highlight — **{tên}** · {roleLabel} · {valueText} · {playedOnText}` và escape Markdown của tên.
 */
export interface HighlightPost {
  memberName: string;
  /** `{icon} {tên role}`, vd `🦆 Vịt`. */
  roleLabel: string;
  /** `{giá trị} {chỉ số}`, vd `3 Số mạng đã giết`. */
  valueText: string;
  /** Ngày chơi `dd/mm/yyyy`. */
  playedOnText: string;
  /** Tên file hiện trên Discord, do app đặt (`highlight-{reportId}.{đuôi}`). */
  fileName: string;
  data: Buffer;
}

export interface DiscordNotifier {
  sendDm(discordId: string, text: string): Promise<void>;
  publishSession(view: SessionView): Promise<string>; // trả về message id
  /** Ném `MessageGoneError` khi tin `messageId` không còn tồn tại (đã bị xoá tay). */
  updateSession(messageId: string, view: SessionView): Promise<void>;
  publishVote(prompt: VotePrompt): Promise<string>;
  closeVote(messageId: string, resultText: string): Promise<void>;
  announce(text: string): Promise<void>;
  /** Số byte tối đa một file tải lên server Discord theo cấp boost (10 MiB; cấp 2–3: 50 MiB). */
  highlightUploadLimit(): Promise<number>;
  /** Đăng highlight vào kênh `#highlight`; trả về vị trí tin để dựng link và xoá về sau. */
  postHighlight(post: HighlightPost): Promise<{ channelId: string; messageId: string }>;
  /** Xoá một tin; tin (hoặc kênh) đã mất thì coi như xong, lỗi khác ném ra. */
  deleteMessage(channelId: string, messageId: string): Promise<void>;
}

/**
 * Tin Discord cần sửa không còn tồn tại. Adapter ném lỗi này thay cho lỗi Discord
 * gốc (giữ ở `cause`) để service biết phải đăng tin mới thay vì sửa mãi không được.
 */
export class MessageGoneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MessageGoneError';
  }
}

export interface GuildMemberInfo {
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
  roleIds: string[];
}

export interface GuildDirectory {
  getMember(discordId: string): Promise<GuildMemberInfo | null>;
}
