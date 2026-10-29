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

/**
 * Một lần nhận treo thưởng vừa được duyệt (spec treo thưởng §7): adapter đăng vào kênh `#treo-thưởng`
 * dòng `✅ {memberName} hoàn thành **{bountyTitle}** +{points}` (escape Markdown tên người và tên mục,
 * không ping ai).
 */
export interface BountyCompletedPost {
  memberName: string;
  bountyTitle: string;
  points: number;
}

/**
 * Tin treo thưởng của một buổi trong `#treo-thưởng` (spec treo thưởng §7): tiêu đề theo buổi, danh
 * sách mục áp dụng (đã sắp: điểm giảm dần rồi id) và menu "Tôi đã hoàn thành…" khi buổi còn mở.
 * Buổi huỷ → tin ghi "Buổi đã huỷ", không menu.
 */
export interface BountyBoardView {
  sessionId: number;
  startsAt: Date;
  modeName: string;
  status: 'scheduled' | 'cancelled';
  bounties: { id: number; title: string; description: string | null; points: number; /** Icon role, hoặc 🎯 khi mục không gắn role. */ icon: string }[];
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
  /**
   * Đăng highlight vào kênh `#highlight`; trả về vị trí tin để dựng link và xoá về sau. Lỗi
   * không tự hết khi thử lại → `HighlightChannelError` (kênh) hay `HighlightRejectedTooLargeError`
   * (file); lỗi khác (mạng, Discord sập) ném nguyên vẹn.
   */
  postHighlight(post: HighlightPost): Promise<{ channelId: string; messageId: string }>;
  /** Xoá một tin; tin (hoặc kênh) đã mất thì coi như xong, lỗi khác ném ra. */
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  /**
   * Đăng thông báo duyệt treo thưởng vào `#treo-thưởng` (`BountyCompletedPost`). Chưa cấu hình kênh →
   * không làm gì; lỗi Discord ném ra — nơi gọi chỉ ghi log.
   */
  postBountyCompleted(post: BountyCompletedPost): Promise<void>;
  /** Đăng tin treo thưởng của buổi vào kênh `channelId`; trả về id tin. */
  publishBountyBoard(channelId: string, view: BountyBoardView): Promise<string>;
  /** Sửa tin treo thưởng đã đăng; tin hay kênh không còn → `MessageGoneError`. */
  updateBountyBoard(channelId: string, messageId: string, view: BountyBoardView): Promise<void>;
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

/**
 * Bot không đăng được vào kênh highlight vì lỗi chỉ admin sửa được: thiếu quyền (Discord 50013
 * Missing Permissions, 50001 Missing Access), kênh đã bị xoá (10003 Unknown Channel), kênh không
 * gửi tin được hay chưa cấu hình. Lỗi Discord gốc (nếu có) giữ ở `cause`.
 */
export class HighlightChannelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HighlightChannelError';
  }
}

/** Discord từ chối file highlight vì quá lớn (40005 Request entity too large); lỗi gốc ở `cause`. */
export class HighlightRejectedTooLargeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HighlightRejectedTooLargeError';
  }
}

export interface GuildMemberInfo {
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
  roleIds: string[];
  /** Ngày vào server theo Discord (`GuildMember.joinedAt`); null khi Discord không cho biết. */
  joinedAt: Date | null;
}

export interface GuildDirectory {
  getMember(discordId: string): Promise<GuildMemberInfo | null>;
}

/** Một role thứ hạng bot tự tạo khi server chưa có (tên, màu `0xRRGGBB`, hiện tách nhóm hay không). */
export interface RankRoleSpec {
  name: string;
  color: number;
  hoist: boolean;
}

/**
 * Gắn/gỡ role thứ hạng trong server cấu hình. Lỗi do bot thiếu quyền (Manage Roles, hay role
 * của bot nằm dưới role cần gắn) → `RankRolePermissionError`; lỗi khác ném nguyên vẹn.
 */
export interface RankRoleAdmin {
  /** ID role của `spec`: `knownId` nếu role đó còn trong server; không thì role cùng tên; không có nữa thì tạo mới. */
  ensureRole(spec: RankRoleSpec, knownId: string | null): Promise<string>;
  /** discordId của mọi người đang mang role. */
  holders(roleId: string): Promise<string[]>;
  /** Người đã rời server thì coi như xong. */
  addRole(discordId: string, roleId: string): Promise<void>;
  /** Người đã rời server thì coi như xong. */
  removeRole(discordId: string, roleId: string): Promise<void>;
}

/** Bot không quản lý được role thứ hạng vì lỗi chỉ admin sửa được (Discord 50013 / 50001); lỗi gốc ở `cause`. */
export class RankRolePermissionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RankRolePermissionError';
  }
}
