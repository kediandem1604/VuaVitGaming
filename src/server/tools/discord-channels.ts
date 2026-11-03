/**
 * Kế hoạch tạo kênh Discord cho GGD Hub (dùng bởi `setup-discord.ts`): một nhóm kênh
 * "GGD Hub" với năm kênh bot đăng tin — lịch chơi, vote MVP, thông báo, highlight, treo thưởng. Chạy lại
 * an toàn, theo thứ tự ưu tiên cho từng kênh:
 *
 * 1. ID đã có trong `.env` mà vẫn là kênh văn bản của server → giữ nguyên, kể cả khi admin đã
 *    đổi tên kênh hay nhóm, hoặc tự điền ID một kênh khác (dùng chung một kênh cho cả ba…).
 * 2. Không thì tìm kênh cùng tên trong nhóm, 3. không có nữa thì tạo.
 *
 * Kênh tạo mới vào nhóm chứa kênh giữ được đầu tiên (nhóm đã đổi tên vẫn là nhóm của hội);
 * không kênh nào giữ được nằm trong nhóm thì tìm/tạo nhóm "GGD Hub" theo tên — chỉ khi thật sự
 * có kênh cần tìm hay tạo. Máy chủ đã có các kênh cũ từ bản trước chỉ được thêm kênh còn thiếu
 * (`#highlight`, `#treo-thưởng`).
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
    | 'DISCORD_HIGHLIGHT_CHANNEL_ID'
    | 'DISCORD_BOUNTY_CHANNEL_ID';
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
  {
    // Quyền như #lịch-chơi: mọi người xem, không nhắn; bot đăng tin và menu.
    envKey: 'DISCORD_BOUNTY_CHANNEL_ID',
    name: 'treo-thưởng',
    topic: 'Treo thưởng mỗi buổi chơi — chọn mục đã hoàn thành trong menu dưới tin của bot.',
  },
];

/** ID kênh đã biết (đọc từ `.env`) theo tên biến; thiếu hoặc trống = chưa biết. */
export type KnownChannelIds = Partial<Record<ChannelPlan['envKey'], string>>;

/** Thao tác tối thiểu trên server Discord mà kế hoạch cần. */
export interface ChannelAdmin {
  /** Kênh văn bản `id` của server này (kèm nhóm chứa nó); không còn, khác server hay không phải kênh văn bản → null. */
  textChannelById(id: string): Promise<{ id: string; parentId: string | null } | null>;
  findCategory(name: string): Promise<string | null>;
  createCategory(name: string): Promise<string>;
  findTextChannel(name: string, categoryId: string): Promise<string | null>;
  createTextChannel(plan: ChannelPlan, categoryId: string): Promise<string>;
}

export interface EnsuredChannel extends ChannelPlan {
  id: string;
  created: boolean;
  /** Giữ theo ID đã có trong `.env` (không tra tên, không đụng quyền kênh). */
  keptById: boolean;
}

export interface EnsureResult {
  /** Nhóm chứa kênh tìm/tạo theo tên; `null` khi mọi kênh đều giữ theo ID (không cần nhóm). */
  categoryId: string | null;
  categoryCreated: boolean;
  channels: EnsuredChannel[];
}

export async function ensureChannels(admin: ChannelAdmin, known: KnownChannelIds = {}): Promise<EnsureResult> {
  // 1. Kênh có ID trong .env còn tồn tại → giữ (Map giữ thứ tự kế hoạch: "kênh giữ được đầu tiên").
  const kept = new Map<ChannelPlan['envKey'], { id: string; parentId: string | null }>();
  for (const plan of CHANNELS) {
    const id = known[plan.envKey]?.trim();
    if (!id) continue;
    const channel = await admin.textChannelById(id);
    if (channel) kept.set(plan.envKey, channel);
  }

  // 2. Nhóm cho kênh còn thiếu, chỉ tìm/tạo khi lần đầu cần: nhóm của kênh giữ được đầu tiên,
  //    không có thì nhóm "GGD Hub" theo tên.
  let categoryId: string | null = null;
  let categoryCreated = false;
  const category = async (): Promise<string> => {
    if (categoryId !== null) return categoryId;
    const keptParent = [...kept.values()].find((channel) => channel.parentId !== null)?.parentId ?? null;
    if (keptParent !== null) return (categoryId = keptParent);
    const existing = await admin.findCategory(CATEGORY_NAME);
    categoryCreated = existing === null;
    return (categoryId = existing ?? (await admin.createCategory(CATEGORY_NAME)));
  };

  // 3. Từng kênh: giữ theo ID, hoặc tìm theo tên trong nhóm, hoặc tạo.
  const channels: EnsuredChannel[] = [];
  for (const plan of CHANNELS) {
    const keptChannel = kept.get(plan.envKey);
    if (keptChannel) {
      channels.push({ ...plan, id: keptChannel.id, created: false, keptById: true });
      continue;
    }
    const parent = await category();
    const existing = await admin.findTextChannel(plan.name, parent);
    const id = existing ?? (await admin.createTextChannel(plan, parent));
    channels.push({ ...plan, id, created: existing === null, keptById: false });
  }
  return { categoryId, categoryCreated, channels };
}

/** Dòng `KEY=ID` cho từng kênh — script shell ghi thẳng vào `.env`. */
export function envLines(result: EnsureResult): string[] {
  return result.channels.map((channel) => `${channel.envKey}=${channel.id}`);
}

/** So tên kênh như Discord: không phân biệt hoa thường, cùng dạng Unicode. */
export function sameChannelName(a: string, b: string): boolean {
  return a.normalize('NFC').toLocaleLowerCase('vi') === b.normalize('NFC').toLocaleLowerCase('vi');
}
