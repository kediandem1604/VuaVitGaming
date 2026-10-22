/**
 * Định tuyến tương tác Discord (nút, menu) tới service theo `custom_id`.
 *
 * Nút Tham gia/Huỷ: Discord chỉ cho 3 giây để trả lời nên `deferReply` (ẩn) trước,
 * rồi mới tạo/cập nhật hồ sơ người bấm, điểm danh và `editReply`. Embed của buổi
 * do service tự sửa lại (`syncSessionMessage`) — ở đây không `update` tin, và kết
 * quả giống hệt bấm trên web vì cùng gọi `setAttendance`.
 *
 * Handler không phụ thuộc lớp `Interaction` của discord.js: nhận kiểu cấu trúc
 * `InteractionLike` (Interaction thật khớp nhờ các type predicate) nên test được
 * bằng bản giả, không cần kết nối Discord.
 */

import { MessageFlags } from 'discord.js';
import type { Ctx } from '../ctx.js';
import { AppError } from '../lib/errors.js';
import { formatVnTime } from '../lib/time.js';
import { upsertMemberFromGuild } from '../modules/members/service.js';
import { setAttendance } from '../modules/sessions/service.js';
import { parseCustomId } from './custom-ids.js';
import type { CustomIdData } from './custom-ids.js';
import { toGuildMemberInfo } from './guild-directory.js';
import type { GuildMemberSource } from './guild-directory.js';

/** Phần của `Interaction` mà bộ định tuyến cần: chỉ để nhận ra nút và menu chọn. */
export interface InteractionLike {
  isButton(): this is ComponentInteractionLike;
  isStringSelectMenu(): this is ComponentInteractionLike;
}

/** Phần của `ButtonInteraction` / `StringSelectMenuInteraction` mà handler dùng. */
export interface ComponentInteractionLike {
  customId: string;
  guildId: string | null;
  /** Server của tương tác đã cache (bot ở trong server) → `member` là GuildMember đầy đủ. */
  inCachedGuild(): this is ComponentInteractionLike & { member: GuildMemberSource };
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(content: string): Promise<unknown>;
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
}

type GuildComponentInteraction = ComponentInteractionLike & { member: GuildMemberSource };

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export async function handleInteraction(ctx: Ctx, interaction: InteractionLike): Promise<void> {
  // Lệnh slash là việc của Task 14; các loại khác (autocomplete, modal) không dùng.
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  await handleComponent(ctx, interaction);
}

async function handleComponent(ctx: Ctx, interaction: ComponentInteractionLike): Promise<void> {
  const data = parseCustomId(interaction.customId);
  if (!data) {
    console.warn(`[bot] Bỏ qua tương tác có custom id lạ: ${interaction.customId}`);
    return;
  }
  if (interaction.guildId !== ctx.config.discord.guildId || !interaction.inCachedGuild()) {
    await interaction.reply({ content: 'Bot chỉ dùng trong server chính', ...EPHEMERAL });
    return;
  }

  switch (data.kind) {
    case 'att':
      await handleAttendance(ctx, interaction, data);
      return;
    case 'vote': // Task 13
      await interaction.reply({ content: 'Chưa hỗ trợ', ...EPHEMERAL });
      return;
  }
}

/**
 * Người bấm được tạo/cập nhật hồ sơ từ GuildMember (lần đầu bấm cũng có mã thành
 * viên), rồi điểm danh. Lỗi nghiệp vụ (`AppError`: hết chỗ, buổi đã đóng…) trả
 * đúng thông báo của nó; lỗi khác chỉ ghi log, người dùng thấy câu chung.
 */
async function handleAttendance(
  ctx: Ctx,
  interaction: GuildComponentInteraction,
  data: Extract<CustomIdData, { kind: 'att' }>,
): Promise<void> {
  await interaction.deferReply(EPHEMERAL);
  try {
    const { member } = await upsertMemberFromGuild(ctx, toGuildMemberInfo(interaction.member));
    const going = data.action === 'join';
    const view = await setAttendance(ctx, data.sessionId, member.id, going);
    await interaction.editReply(going ? `Đã đăng ký buổi ${formatVnTime(view.startsAt)} ✅` : 'Đã huỷ tham gia');
  } catch (err) {
    if (err instanceof AppError) {
      await interaction.editReply(err.message);
      return;
    }
    console.error(`[bot] Lỗi xử lý nút ${interaction.customId}:`, err);
    await interaction.editReply('Có lỗi xảy ra, thử lại sau');
  }
}
