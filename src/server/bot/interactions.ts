/**
 * Định tuyến tương tác Discord (nút, menu, lệnh slash, autocomplete) tới service.
 *
 * Discord chỉ cho 3 giây để trả lời nên mọi handler `deferReply` trước, rồi mới
 * tạo/cập nhật hồ sơ người gọi từ GuildMember, gọi service và `editReply`.
 * - Nút Tham gia/Huỷ (`att:*`): điểm danh. Embed của buổi do service tự sửa lại
 *   (`syncSessionMessage`) — ở đây không `update` tin, và kết quả giống hệt bấm trên
 *   web vì cùng gọi `setAttendance`.
 * - Menu vote (`vote:*`): bỏ (hoặc đổi) phiếu qua `castVote`; tin vote giữ nguyên tới khi đóng đợt.
 * - Menu treo thưởng (`bounty:claim:*`): nhận từng mục đã chọn qua `claimBounty` (cùng luật với web),
 *   trả lời ẩn một dòng cho mỗi mục.
 * - `/baocao`: khai điểm (`submitReport`), trả lời ẩn. `/bxh`: embed top 10 của role mùa
 *   này, công khai. `/hoso`: mã thành viên, role đang giữ, link web, trả lời ẩn.
 * - Autocomplete `role`: trả gợi ý ngay (không defer — Discord không cho defer autocomplete).
 *
 * Mọi tương tác trả lời được phải đến từ server chính và có GuildMember đầy đủ; nơi
 * khác chỉ nhận một câu từ chối. Handler không phụ thuộc lớp `Interaction` của
 * discord.js: nhận kiểu cấu trúc `InteractionLike` (Interaction thật khớp nhờ các type
 * predicate) nên test được bằng bản giả, không cần kết nối Discord.
 */

import { MessageFlags } from 'discord.js';
import type { APIEmbed } from 'discord.js';
import type { RoleDto } from '../../shared/api-types.js';
import { normalizeText } from '../../shared/text.js';
import type { Ctx } from '../ctx.js';
import { AppError } from '../lib/errors.js';
import { formatVnDay, formatVnTime, seasonIdOf, toVnDate } from '../lib/time.js';
import { escapeDiscordMarkdown } from '../lib/discord-text.js';
import { claimBounty } from '../modules/bounties/claims.js';
import { upsertMemberFromGuild } from '../modules/members/service.js';
import { castVote } from '../modules/mvp/votes.js';
import { listRoles } from '../modules/roles/service.js';
import { setAttendance } from '../modules/sessions/service.js';
import { getHeldRoles, getRoleLeaderboard } from '../modules/stats/leaderboard.js';
import { isId, submitReport } from '../modules/stats/reports.js';
import { COMMAND, OPTION, filterRoleChoices, leaderboardEmbed, parseDayInput, profileText } from './commands.js';
import { parseCustomId } from './custom-ids.js';
import type { CustomIdData } from './custom-ids.js';
import { toGuildMemberInfo } from './guild-directory.js';
import type { GuildMemberSource } from './guild-directory.js';
import { formatReportValue } from '../../shared/metric.js';

/** Phần của `Interaction` mà bộ định tuyến cần: chỉ để nhận ra từng loại tương tác. */
export interface InteractionLike {
  isButton(): this is ComponentInteractionLike;
  isStringSelectMenu(): this is SelectMenuInteractionLike;
  isChatInputCommand(): this is CommandInteractionLike;
  isAutocomplete(): this is AutocompleteInteractionLike;
}

/** Nội dung trả lời có cấu trúc — `APIEmbed` thuần (không builder) để test so sánh được. */
export interface ReplyPayload {
  content?: string;
  embeds?: readonly APIEmbed[];
}

/** Phần chung của mọi tương tác trả lời được (nút, menu, lệnh). */
interface RepliableInteractionLike {
  guildId: string | null;
  /** Không truyền `flags` → trả lời công khai. */
  deferReply(options?: { flags?: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(payload: string | ReplyPayload): Promise<unknown>;
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
}

/** Phần của `ButtonInteraction` / `StringSelectMenuInteraction` mà handler dùng. */
export interface ComponentInteractionLike extends RepliableInteractionLike {
  customId: string;
  /** Server của tương tác đã cache (bot ở trong server) → `member` là GuildMember đầy đủ. */
  inCachedGuild(): this is ComponentInteractionLike & { member: GuildMemberSource };
}

/** Thêm phần riêng của `StringSelectMenuInteraction`: các giá trị đã chọn (menu vote chọn 1 → một phần tử). */
export interface SelectMenuInteractionLike extends ComponentInteractionLike {
  values: string[];
}

/** Phần của `ChatInputCommandInteraction` mà handler dùng. */
export interface CommandInteractionLike extends RepliableInteractionLike {
  commandName: string;
  /** Tuỳ chọn người dùng điền; tuỳ chọn không điền → null. */
  options: {
    getString(name: string): string | null;
    getInteger(name: string): number | null;
  };
  inCachedGuild(): this is CommandInteractionLike & { member: GuildMemberSource };
}

/** Phần của `AutocompleteInteraction` mà handler dùng: chuỗi đang gõ và cách trả gợi ý. */
export interface AutocompleteInteractionLike {
  commandName: string;
  guildId: string | null;
  options: { getFocused(): string };
  respond(choices: readonly { name: string; value: string }[]): Promise<unknown>;
}

type GuildComponentInteraction = ComponentInteractionLike & { member: GuildMemberSource };
type GuildCommandInteraction = CommandInteractionLike & { member: GuildMemberSource };

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const NOT_MAIN_GUILD = 'Bot chỉ dùng trong server chính';
const ROLE_NOT_FOUND = 'Không tìm thấy role';

export async function handleInteraction(ctx: Ctx, interaction: InteractionLike): Promise<void> {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(ctx, interaction);
  } else if (interaction.isChatInputCommand()) {
    await handleCommand(ctx, interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleComponent(ctx, interaction, interaction.values);
  } else if (interaction.isButton()) {
    await handleComponent(ctx, interaction, []);
  }
  // Loại khác (modal, lệnh ngữ cảnh) không dùng.
}

// ---------------------------------------------------------------------------
// Nút và menu
// ---------------------------------------------------------------------------

async function handleComponent(ctx: Ctx, interaction: ComponentInteractionLike, values: readonly string[]): Promise<void> {
  const data = parseCustomId(interaction.customId);
  if (!data) {
    console.warn(`[bot] Bỏ qua tương tác có custom id lạ: ${interaction.customId}`);
    return;
  }
  if (!isMainGuild(ctx, interaction) || !interaction.inCachedGuild()) {
    await interaction.reply({ content: NOT_MAIN_GUILD, ...EPHEMERAL });
    return;
  }

  switch (data.kind) {
    case 'att':
      await handleAttendance(ctx, interaction, data);
      return;
    case 'vote':
      await handleVote(ctx, interaction, data, values);
      return;
    case 'bounty':
      await handleBountyClaim(ctx, interaction, data, values);
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
    await answerError(interaction, interaction.customId, err);
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
    await answerError(interaction, interaction.customId, err);
  }
}

const POSITIVE_INT = /^[1-9]\d*$/;

/** Giới hạn độ dài tin trả lời của Discord. */
const REPLY_MAX = 2000;

/**
 * Menu "Tôi đã hoàn thành…": người chọn được tạo/cập nhật hồ sơ từ GuildMember (như các nút khác),
 * rồi nhận lần lượt từng mục đã chọn (bỏ trùng, theo thứ tự chọn) qua `claimBounty` — mọi luật nhận
 * nằm ở đó. Trả lời ẩn một dòng mỗi mục: `✅ **{mục}** — Đã gửi, chờ mod duyệt` hoặc `❌ **{mục}** — {lỗi}`.
 * Một mục lỗi không chặn các mục sau. Giá trị lạ (client bị sửa) → mục "không rõ", lỗi của service.
 */
async function handleBountyClaim(
  ctx: Ctx,
  interaction: GuildComponentInteraction,
  data: Extract<CustomIdData, { kind: 'bounty' }>,
  values: readonly string[],
): Promise<void> {
  await interaction.deferReply(EPHEMERAL);
  try {
    const { member } = await upsertMemberFromGuild(ctx, toGuildMemberInfo(interaction.member));
    const ids = [...new Set(values)].map((v) => (POSITIVE_INT.test(v) ? Number(v) : Number.NaN));
    const known = ids.filter(isId);
    const titles = new Map(
      (await ctx.db.bounty.findMany({ where: { id: { in: known } }, select: { id: true, title: true } })).map((b) => [b.id, b.title]),
    );

    const lines: string[] = [];
    for (const id of ids) {
      const title = `**${escapeDiscordMarkdown(titles.get(id) ?? 'Mục không rõ')}**`;
      try {
        await claimBounty(ctx, member.id, data.sessionId, id, 'discord');
        lines.push(`✅ ${title} — Đã gửi, chờ mod duyệt`);
      } catch (err) {
        if (!(err instanceof AppError)) console.error(`[bot] Lỗi nhận treo thưởng ${id} qua ${interaction.customId}:`, err);
        lines.push(`❌ ${title} — ${err instanceof AppError ? err.message : 'Có lỗi xảy ra, thử lại sau'}`);
      }
    }
    await interaction.editReply(fitLines(lines, REPLY_MAX));
  } catch (err) {
    await answerError(interaction, interaction.customId, err);
  }
}

/** Nối các dòng; quá `max` ký tự thì bớt dòng cuối và ghi "… và X mục nữa". */
function fitLines(lines: string[], max: number): string {
  for (let shown = lines.length; shown > 0; shown -= 1) {
    const hidden = lines.length - shown;
    const text = lines.slice(0, shown).join('\n') + (hidden > 0 ? `\n… và ${hidden} mục nữa` : '');
    if (text.length <= max) return text;
  }
  return `${lines.length} mục`;
}

/** Giá trị menu đã chọn → memberId; không phải số nguyên dương chính tắc → NaN để `castVote` từ chối (VALIDATION). */
function nomineeIdOf(values: readonly string[]): number {
  const raw = values[0];
  return raw !== undefined && POSITIVE_INT.test(raw) ? Number(raw) : Number.NaN;
}

// ---------------------------------------------------------------------------
// Lệnh slash
// ---------------------------------------------------------------------------

async function handleCommand(ctx: Ctx, interaction: CommandInteractionLike): Promise<void> {
  const name = interaction.commandName;
  if (name !== COMMAND.report && name !== COMMAND.leaderboard && name !== COMMAND.profile) {
    console.warn(`[bot] Bỏ qua lệnh lạ: /${name}`);
    return;
  }
  if (!isMainGuild(ctx, interaction) || !interaction.inCachedGuild()) {
    await interaction.reply({ content: NOT_MAIN_GUILD, ...EPHEMERAL });
    return;
  }

  switch (name) {
    case COMMAND.report:
      await handleReport(ctx, interaction);
      return;
    case COMMAND.leaderboard:
      await handleLeaderboard(ctx, interaction);
      return;
    case COMMAND.profile:
      await handleProfile(ctx, interaction);
      return;
  }
}

/**
 * `/baocao`: hồ sơ người gõ từ GuildMember → tra role (theo `key` từ autocomplete, hoặc
 * gõ tay đúng tên tiếng Việt) → đọc ngày → `submitReport` (mọi quy tắc khai nằm ở đó,
 * kể cả chỉ số phụ `so_lieu_phu` và chỉ số phạt `so_lieu_phat`: role không có mà điền ≠ 0 →
 * lỗi của service) → xác nhận ẩn `Đã gửi: … Chờ mod duyệt nhé!` (đọc "x + y − z" theo
 * `formatReportValue`: "4 mạng đã giết + 2 lần ám sát trong cuộc họp", "4 phát bắn trúng kẻ
 * xấu − 1 phát bắn sai").
 */
async function handleReport(ctx: Ctx, interaction: GuildCommandInteraction): Promise<void> {
  await interaction.deferReply(EPHEMERAL);
  try {
    const { member } = await upsertMemberFromGuild(ctx, toGuildMemberInfo(interaction.member));

    const role = await resolveRole(ctx, interaction.options.getString(OPTION.role) ?? '');
    if (!role) {
      await interaction.editReply(ROLE_NOT_FOUND);
      return;
    }
    const playedOn = parseDayInput(interaction.options.getString(OPTION.day) ?? undefined, toVnDate(ctx.now()));
    if (!playedOn) {
      await interaction.editReply('Ngày không hợp lệ (dùng dd/MM hoặc YYYY-MM-DD)');
      return;
    }

    // `so_lieu` là bắt buộc; thiếu (client bị sửa) → NaN để service từ chối như giá trị sai.
    const value = interaction.options.getInteger(OPTION.value) ?? Number.NaN;
    // `so_lieu_phu` không bắt buộc; bỏ trống → 0 (như web).
    const extraValue = interaction.options.getInteger(OPTION.extraValue) ?? 0;
    // `so_lieu_phat` cũng không bắt buộc; bỏ trống → 0.
    const penaltyValue = interaction.options.getInteger(OPTION.penaltyValue) ?? 0;
    const report = await submitReport(ctx, member.id, { roleId: role.id, value, extraValue, penaltyValue, playedOn, note: interaction.options.getString(OPTION.note) });
    await interaction.editReply(
      `Đã gửi: ${role.icon} ${role.nameVi} — ${formatReportValue(report, role)} ngày ${formatVnDay(playedOn)}. Chờ mod duyệt nhé!`,
    );
  } catch (err) {
    await answerError(interaction, `/${interaction.commandName}`, err);
  }
}

/** `/bxh`: top 10 của role trong mùa hiện tại, embed công khai (không cần hồ sơ người gõ). */
async function handleLeaderboard(ctx: Ctx, interaction: GuildCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const role = await resolveRole(ctx, interaction.options.getString(OPTION.role) ?? '');
    if (!role) {
      await interaction.editReply(ROLE_NOT_FOUND);
      return;
    }
    const seasonId = currentSeason(ctx);
    const rows = await getRoleLeaderboard(ctx, role.id, seasonId);
    await interaction.editReply({ embeds: [leaderboardEmbed(role, seasonId, rows)] });
  } catch (err) {
    await answerError(interaction, `/${interaction.commandName}`, err);
  }
}

/** `/hoso`: hồ sơ người gõ (tạo nếu chưa có) → mã thành viên, role đang giữ mùa này, link web; ẩn. */
async function handleProfile(ctx: Ctx, interaction: GuildCommandInteraction): Promise<void> {
  await interaction.deferReply(EPHEMERAL);
  try {
    const { member } = await upsertMemberFromGuild(ctx, toGuildMemberInfo(interaction.member));
    const seasonId = currentSeason(ctx);
    const held = await getHeldRoles(ctx, member.id, seasonId);
    await interaction.editReply(profileText(member, seasonId, held, ctx.config.publicUrl));
  } catch (err) {
    await answerError(interaction, `/${interaction.commandName}`, err);
  }
}

/**
 * Role từ chuỗi người dùng đưa: đúng `key` (giá trị autocomplete), nếu không thì đúng
 * tên tiếng Việt không phân biệt hoa thường/dấu (gõ tay). Tra cả role đang tắt để
 * `submitReport` báo "Role này đang tắt" thay cho "không tìm thấy"; trùng tên thì ưu
 * tiên role đang bật. Không có → null.
 */
async function resolveRole(ctx: Ctx, input: string): Promise<RoleDto | null> {
  const roles = await listRoles(ctx, { includeInactive: true });
  const typed = input.trim();
  const byKey = roles.find((r) => r.key === typed);
  if (byKey) return byKey;

  const name = normalizeText(typed);
  if (name === '') return null;
  const byName = roles.filter((r) => normalizeText(r.nameVi) === name);
  return byName.find((r) => r.active) ?? byName[0] ?? null;
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

/**
 * Gợi ý role đang bật cho chuỗi đang gõ (lệnh nào cũng chỉ có một tuỳ chọn autocomplete
 * là `role`). Không defer được nên trả thẳng; lỗi gì cũng chỉ ghi log và trả danh sách
 * rỗng — người dùng vẫn gõ tay được tên role.
 */
async function handleAutocomplete(ctx: Ctx, interaction: AutocompleteInteractionLike): Promise<void> {
  try {
    if (!isMainGuild(ctx, interaction)) {
      await interaction.respond([]);
      return;
    }
    const roles = await listRoles(ctx);
    await interaction.respond(filterRoleChoices(roles, interaction.options.getFocused()));
  } catch (err) {
    console.error(`[bot] Lỗi gợi ý role cho /${interaction.commandName}:`, err);
    try {
      await interaction.respond([]);
    } catch {
      // Đã quá 3 giây hoặc đã trả lời rồi — không còn gì để làm.
    }
  }
}

// ---------------------------------------------------------------------------

function isMainGuild(ctx: Ctx, interaction: { guildId: string | null }): boolean {
  return interaction.guildId === ctx.config.discord.guildId;
}

/** Mùa hiện tại theo giờ VN. */
function currentSeason(ctx: Ctx): string {
  return seasonIdOf(toVnDate(ctx.now()));
}

/**
 * Lỗi nghiệp vụ (`AppError`: hết chỗ, buổi đã đóng, tự vote, giá trị quá giới hạn…)
 * trả đúng thông báo của nó; lỗi khác chỉ ghi log kèm `label` (custom id hay tên lệnh),
 * người dùng thấy câu chung.
 */
async function answerError(interaction: { editReply(payload: string): Promise<unknown> }, label: string, err: unknown): Promise<void> {
  if (err instanceof AppError) {
    await interaction.editReply(err.message);
    return;
  }
  console.error(`[bot] Lỗi xử lý tương tác ${label}:`, err);
  await interaction.editReply('Có lỗi xảy ra, thử lại sau');
}
