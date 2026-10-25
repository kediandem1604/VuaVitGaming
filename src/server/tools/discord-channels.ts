/**
 * Kế hoạch tạo kênh Discord cho GGD Hub (dùng bởi `setup-discord.ts`): một nhóm kênh
 * "GGD Hub" với bốn kênh bot đăng tin — lịch chơi, vote MVP, thông báo, highlight. Chạy lại
 * an toàn: kênh/nhóm đã có (cùng tên) được dùng lại, chỉ tạo phần còn thiếu (máy chủ đã có ba
 * kênh đầu từ bản trước chỉ được thêm `#highlight`).
 *
 * Tách khỏi discord.js qua `ChannelAdmin` để test được bằng bản giả.
 */

export const CATEGORY_NAME = 'GGD Hub';

export interface ChannelPlan {
  /** Tên biến môi trường nhận ID kênh. */
  envKey:
    | 'DISCORD_SCHEDULE_CHANNEL_ID'
    | 'DISCORD_VOTE_CHANNEL_ID'
    | 'DISCORD_ANNOUNCE_CHANNEL_ID'
    | 'DISCORD_HIGHLIGHT_CHANNEL_ID';
  name: string;
  topic: string;
  /** Bot được cấp thêm Attach Files trong kênh (đăng file highlight). */
  botAttachFiles?: boolean;
}

export const CHANNELS: readonly ChannelPlan[] = [
  {
    envKey: 'DISCORD_SCHEDULE_CHANNEL_ID',
    name: 'lịch-chơi',
    topic: 'Lịch các buổi chơi — bấm Tham gia / Huỷ ngay trên tin của bot.',
  },
  {
    envKey: 'DISCORD_VOTE_CHANNEL_ID',
    name: 'vote-mvp',
    topic: 'Vote MVP sau mỗi buổi chơi — chọn trong menu dưới mỗi hạng mục.',
  },
  {
    envKey: 'DISCORD_ANNOUNCE_CHANNEL_ID',
    name: 'thông-báo',
    topic: 'Kết quả tri ân, đổi người hoá thân, tổng kết mùa.',
  },
  {
    envKey: 'DISCORD_HIGHLIGHT_CHANNEL_ID',
    name: 'highlight',
    topic: 'Highlight người chơi gửi kèm khi khai điểm.',
    botAttachFiles: true,
  },
];

/** Thao tác tối thiểu trên server Discord mà kế hoạch cần. */
export interface ChannelAdmin {
  findCategory(name: string): Promise<string | null>;
  createCategory(name: string): Promise<string>;
  findTextChannel(name: string, categoryId: string): Promise<string | null>;
  createTextChannel(plan: ChannelPlan, categoryId: string): Promise<string>;
}

export interface EnsuredChannel extends ChannelPlan {
  id: string;
  created: boolean;
}

export interface EnsureResult {
  categoryId: string;
  categoryCreated: boolean;
  channels: EnsuredChannel[];
}

export async function ensureChannels(admin: ChannelAdmin): Promise<EnsureResult> {
  const existingCategory = await admin.findCategory(CATEGORY_NAME);
  const categoryId = existingCategory ?? (await admin.createCategory(CATEGORY_NAME));

  const channels: EnsuredChannel[] = [];
  for (const plan of CHANNELS) {
    const existing = await admin.findTextChannel(plan.name, categoryId);
    const id = existing ?? (await admin.createTextChannel(plan, categoryId));
    channels.push({ ...plan, id, created: existing === null });
  }
  return { categoryId, categoryCreated: existingCategory === null, channels };
}

/** Dòng `KEY=ID` cho từng kênh — script shell ghi thẳng vào `.env`. */
export function envLines(result: EnsureResult): string[] {
  return result.channels.map((channel) => `${channel.envKey}=${channel.id}`);
}

/** So tên kênh như Discord: không phân biệt hoa thường, cùng dạng Unicode. */
export function sameChannelName(a: string, b: string): boolean {
  return a.normalize('NFC').toLocaleLowerCase('vi') === b.normalize('NFC').toLocaleLowerCase('vi');
}
