/**
 * Định tuyến tương tác Discord (nút, menu) tới service theo `custom_id`.
 *
 * Discord chỉ cho 3 giây để trả lời nên mọi handler `deferReply` (ẩn) trước, rồi mới
 * tạo/cập nhật hồ sơ người bấm từ GuildMember, gọi service và `editReply`.
 * - Nút Tham gia/Huỷ: điểm danh. Embed của buổi do service tự sửa lại
 *   (`syncSessionMessage`) — ở đây không `update` tin, và kết quả giống hệt bấm trên
 *   web vì cùng gọi `setAttendance`.
 * - Menu vote: bỏ (hoặc đổi) phiếu qua `castVote`; tin vote giữ nguyên tới khi đóng đợt.
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
import { castVote } from '../modules/mvp/votes.js';
import { setAttendance } from '../modules/sessions/service.js';
import { parseCustomId } from './custom-ids.js';
import type { CustomIdData } from './custom-ids.js';
import { toGuildMemberInfo } from './guild-directory.js';
import type { GuildMemberSource } from './guild-directory.js';

/** Phần của `Interaction` mà bộ định tuyến cần: chỉ để nhận ra nút và menu chọn. */
export interface InteractionLike {
  isButton(): this is ComponentInteractionLike;
  isStringSelectMenu(): this is SelectMenuInteractionLike;
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

/** Thêm phần riêng của `StringSelectMenuInteraction`: các giá trị đã chọn (menu vote chọn 1 → một phần tử). */
export interface SelectMenuInteractionLike extends ComponentInteractionLike {
  values: string[];
}

type GuildComponentInteraction = ComponentInteractionLike & { member: GuildMemberSource };

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export async function handleInteraction(ctx: Ctx, interaction: InteractionLike): Promise<void> {
  if (interaction.isStringSelectMenu()) {
    await handleComponent(ctx, interaction, interaction.values);
  } else if (interaction.isButton()) {
    await handleComponent(ctx, interaction, []);
  }
  // Lệnh slash là việc của Task 14; các loại khác (autocomplete, modal) không dùng.
}

async function handleComponent(ctx: Ctx, interaction: ComponentInteractionLike, values: readonly string[]): Promise<void> {
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
    case 'vote':
      await handleVote(ctx, interaction, data, values);
      return;
  }
}

/**
 * Người bấm được tạo/cập nhật hồ sơ từ GuildMember (lần đầu bấm cũng có mã thành
 * viên), rồi điểm danh.
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
    await answerError(interaction, err);
  }
}

/**
 * Người chọn được tạo/cập nhật hồ sơ từ GuildMember (cả server được vote, không cần
 * có mặt ở buổi), rồi bỏ phiếu; chọn lại là đổi phiếu. Giá trị menu là memberId dạng
 * chuỗi — chuỗi lạ (client bị sửa) → `castVote` từ chối như dữ liệu sai.
 */
async function handleVote(
  ctx: Ctx,
  interaction: GuildComponentInteraction,
  data: Extract<CustomIdData, { kind: 'vote' }>,
  values: readonly string[],
): Promise<void> {
  await interaction.deferReply(EPHEMERAL);
  try {
    const { member } = await upsertMemberFromGuild(ctx, toGuildMemberInfo(interaction.member));
    const { nomineeName, categoryName } = await castVote(ctx, {
      roundId: data.roundId,
      categoryId: data.categoryId,
      voterId: member.id,
      nomineeId: nomineeIdOf(values),
    });
    await interaction.editReply(`Đã vote ${nomineeName} cho “${categoryName}”. Đổi ý thì chọn lại.`);
  } catch (err) {
    await answerError(interaction, err);
  }
}

const POSITIVE_INT = /^[1-9]\d*$/;

/** Giá trị menu đã chọn → memberId; không phải số nguyên dương chính tắc → NaN để `castVote` từ chối (VALIDATION). */
function nomineeIdOf(values: readonly string[]): number {
  const raw = values[0];
  return raw !== undefined && POSITIVE_INT.test(raw) ? Number(raw) : Number.NaN;
}

/**
 * Lỗi nghiệp vụ (`AppError`: hết chỗ, buổi đã đóng, tự vote…) trả đúng thông báo của
 * nó; lỗi khác chỉ ghi log, người dùng thấy câu chung.
 */
async function answerError(interaction: ComponentInteractionLike, err: unknown): Promise<void> {
  if (err instanceof AppError) {
    await interaction.editReply(err.message);
    return;
  }
  console.error(`[bot] Lỗi xử lý tương tác ${interaction.customId}:`, err);
  await interaction.editReply('Có lỗi xảy ra, thử lại sau');
}
