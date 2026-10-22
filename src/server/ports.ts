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

export interface DiscordNotifier {
  sendDm(discordId: string, text: string): Promise<void>;
  publishSession(view: SessionView): Promise<string>; // trả về message id
  updateSession(messageId: string, view: SessionView): Promise<void>;
  publishVote(prompt: VotePrompt): Promise<string>;
  closeVote(messageId: string, resultText: string): Promise<void>;
  announce(text: string): Promise<void>;
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
