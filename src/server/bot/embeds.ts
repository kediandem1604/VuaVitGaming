/**
 * Dựng tin Discord của một buổi chơi (embed + hàng nút) từ `SessionView`, tin vote
 * một hạng mục (embed + menu chọn) từ `VotePrompt` và tin treo thưởng của một buổi (embed +
 * menu chọn nhiều) từ `BountyBoardView`. Hàm thuần, trả JSON thuần (kiểu
 * API của Discord) nên test không cần kết nối; `DiscordJsNotifier` gửi/sửa đúng
 * payload này. Các giới hạn của Discord (field 1024 ký tự, tiêu đề 256, nhãn menu
 * 100, tối đa 25 lựa chọn) được tôn trọng ở đây để tin không bao giờ bị từ chối.
 */

import { ButtonStyle, ComponentType } from 'discord.js';
import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIEmbed,
  APIEmbedField,
  APIStringSelectComponent,
} from 'discord.js';
import { escapeDiscordMarkdown } from '../lib/discord-text.js';
import { formatVnDay, formatVnTime } from '../lib/time.js';
import type { BountyBoardView, SessionView, VotePrompt } from '../ports.js';
import { encodeCustomId } from './custom-ids.js';

export interface SessionMessage {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent>[];
}

export interface VoteMessage {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIStringSelectComponent>[];
}

/** Xanh ngỗng (global constraints) khi đang mở; xám khi huỷ; xanh lá khi đã kết thúc. */
const COLOURS: Record<SessionView['status'], number> = {
  scheduled: 0x2f80ed,
  cancelled: 0x6b7280,
  ended: 0x22c55e,
};

const TITLE_PREFIX: Record<SessionView['status'], string> = {
  scheduled: '',
  cancelled: '❌ ĐÃ HUỶ — ',
  ended: '✅ Đã kết thúc — ',
};

const EMBED_TITLE_MAX = 256;
const FIELD_VALUE_MAX = 1024;

export function buildSessionMessage(view: SessionView): SessionMessage {
  const when = `${formatVnTime(view.startsAt)} ${formatVnDay(view.startsAt)}`;
  const title = `${TITLE_PREFIX[view.status]}🪿 Buổi chơi ${view.modeName} — ${when}`;

  const fields: APIEmbedField[] = [
    {
      name: `Người tham gia (${view.attendees.length}/${view.capacity})`,
      value: attendeeList(view.attendees.map((a) => a.displayName)),
    },
  ];
  if (view.roomCode) fields.push({ name: 'Mã phòng', value: view.roomCode });

  const embed: APIEmbed = { title: clip(title, EMBED_TITLE_MAX), color: COLOURS[view.status], fields };
  if (view.note) embed.description = view.note;

  return { embeds: [embed], components: view.status === 'scheduled' ? [buttonRow(view)] : [] };
}

/**
 * Tên nối bằng ", ". Quá 1024 ký tự thì bớt dần tên cuối danh sách và ghi
 * "… và X người nữa" (bớt ít nhất có thể). Chưa ai → "Chưa có ai".
 */
function attendeeList(names: string[]): string {
  if (names.length === 0) return 'Chưa có ai';
  for (let shown = names.length; shown > 0; shown -= 1) {
    const hidden = names.length - shown;
    const text = names.slice(0, shown).join(', ') + (hidden > 0 ? `… và ${hidden} người nữa` : '');
    if (text.length <= FIELD_VALUE_MAX) return text;
  }
  // Ngay tên đầu đã quá dài — không xảy ra với tên Discord (≤ 32 ký tự), nhưng vẫn phải hợp lệ.
  return `${names.length} người`;
}

/** Tham gia (xanh lá; khi đủ người thì tắt và ghi "Đã đủ người") và Huỷ (xám). */
function buttonRow(view: SessionView): APIActionRowComponent<APIButtonComponent> {
  const full = view.attendees.length >= view.capacity;
  const join: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Success,
    label: full ? 'Đã đủ người' : 'Tham gia',
    custom_id: encodeCustomId({ kind: 'att', action: 'join', sessionId: view.id }),
    ...(full ? { disabled: true } : {}),
  };
  const leave: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Secondary,
    label: 'Huỷ',
    custom_id: encodeCustomId({ kind: 'att', action: 'leave', sessionId: view.id }),
  };
  return { type: ComponentType.ActionRow, components: [join, leave] };
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// Tin vote
// ---------------------------------------------------------------------------

/** Vàng — màu tin vote. */
const VOTE_COLOUR = 0xf5b700;
/** Giới hạn của menu chọn Discord: nhãn 100 ký tự, tối đa 25 lựa chọn. */
const SELECT_LABEL_MAX = 100;
const SELECT_OPTIONS_MAX = 25;

/**
 * Tin vote một hạng mục: embed vàng (tên hạng mục; mô tả nếu có; nhãn buổi; giờ đóng
 * VN) và một menu chọn đúng một người trong số người có mặt, theo thứ tự tham gia,
 * giá trị lựa chọn là memberId. Sức chứa buổi ≤ 25 nên không bao giờ quá 25 lựa
 * chọn, nhưng vẫn cắt phòng hờ. Không có ứng viên là lỗi lập trình: Discord từ chối
 * menu rỗng, service không bao giờ gọi tới đây trong trường hợp đó.
 */
export function buildVoteMessage(prompt: VotePrompt): VoteMessage {
  if (prompt.nominees.length === 0) throw new Error(`Tin vote đợt ${prompt.roundId} không có ứng viên`);

  const lines = [`Buổi: ${prompt.sessionLabel}`, `Đóng lúc ${formatVnTime(prompt.closesAt)} ${formatVnDay(prompt.closesAt)}`];
  if (prompt.description) lines.unshift(prompt.description);
  const embed: APIEmbed = {
    title: clip(`🏆 ${prompt.categoryName}`, EMBED_TITLE_MAX),
    description: lines.join('\n'),
    color: VOTE_COLOUR,
  };

  const menu: APIStringSelectComponent = {
    type: ComponentType.StringSelect,
    custom_id: encodeCustomId({ kind: 'vote', roundId: prompt.roundId, categoryId: prompt.categoryId }),
    placeholder: 'Chọn người xứng đáng',
    min_values: 1,
    max_values: 1,
    options: prompt.nominees
      .slice(0, SELECT_OPTIONS_MAX)
      .map((n) => ({ label: clipLabel(n.displayName), value: String(n.memberId) })),
  };
  return { embeds: [embed], components: [{ type: ComponentType.ActionRow, components: [menu] }] };
}

/**
 * Cắt nhãn về ≤ 100 đơn vị UTF-16 (Discord đếm như `String.length`) rồi thêm "…",
 * không bao giờ cắt giữa một cặp surrogate (emoji). Tên Discord ≤ 32 ký tự nên
 * hiếm khi cần, nhưng tin không được bị từ chối vì một cái tên.
 */
function clipLabel(s: string): string {
  if (s.length <= SELECT_LABEL_MAX) return s;
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > SELECT_LABEL_MAX - 1) break;
    out += ch;
  }
  return `${out}…`;
}

// ---------------------------------------------------------------------------
// Tin treo thưởng
// ---------------------------------------------------------------------------

export interface BountyBoardMessage {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIStringSelectComponent>[];
}

/** Cam — màu tin treo thưởng; xám khi buổi huỷ (như tin buổi). */
const BOUNTY_COLOUR = 0xf97316;
const EMBED_DESCRIPTION_MAX = 4096;

/**
 * Tin treo thưởng của một buổi (spec treo thưởng §7): tiêu đề "🎯 Treo thưởng — {chế độ} {giờ} {ngày}",
 * mỗi mục một dòng `{icon} **{tên}** +{điểm}` (mô tả, nếu có, ở dòng ngay dưới; tên và mô tả escape
 * Markdown) và menu chọn nhiều "Tôi đã hoàn thành…" (giá trị là id mục). Menu Discord có tối đa 25
 * lựa chọn: hơn 25 mục thì menu có 25 mục đầu và chân tin ghi rõ (danh sách vẫn đủ). Danh sách dài
 * quá giới hạn mô tả embed thì bớt mục cuối và ghi "… và X mục nữa". Buổi huỷ → "Buổi đã huỷ", không
 * menu. Không có mục nào là lỗi lập trình (service không đăng tin khi đó; Discord từ chối menu rỗng).
 */
export function buildBountyBoardMessage(view: BountyBoardView): BountyBoardMessage {
  const title = clip(`🎯 Treo thưởng — ${view.modeName} ${formatVnTime(view.startsAt)} ${formatVnDay(view.startsAt)}`, EMBED_TITLE_MAX);
  if (view.status === 'cancelled') {
    return { embeds: [{ title, description: 'Buổi đã huỷ', color: COLOURS.cancelled }], components: [] };
  }
  if (view.bounties.length === 0) throw new Error(`Tin treo thưởng buổi ${view.sessionId} không có mục nào`);

  const embed: APIEmbed = { title, description: bountyList(view.bounties), color: BOUNTY_COLOUR };
  const inMenu = view.bounties.slice(0, SELECT_OPTIONS_MAX);
  if (inMenu.length < view.bounties.length) {
    embed.footer = { text: `Menu chỉ có ${inMenu.length}/${view.bounties.length} mục đầu — nhận các mục còn lại trên web` };
  }

  const menu: APIStringSelectComponent = {
    type: ComponentType.StringSelect,
    custom_id: encodeCustomId({ kind: 'bounty', sessionId: view.sessionId }),
    placeholder: 'Tôi đã hoàn thành…',
    min_values: 1,
    max_values: inMenu.length,
    options: inMenu.map((b) => ({ label: clipLabel(`${b.icon} ${b.title}`), value: String(b.id), description: `+${b.points}` })),
  };
  return { embeds: [embed], components: [{ type: ComponentType.ActionRow, components: [menu] }] };
}

/** Các dòng mục; quá 4096 ký tự thì bớt mục cuối (ít nhất có thể) và ghi "… và X mục nữa". */
function bountyList(bounties: BountyBoardView['bounties']): string {
  const blocks = bounties.map((b) => {
    const head = `${b.icon} **${escapeDiscordMarkdown(b.title)}** +${b.points}`;
    return b.description ? `${head}\n${descriptionLine(b.description)}` : head;
  });
  for (let shown = blocks.length; shown > 0; shown -= 1) {
    const hidden = blocks.length - shown;
    const text = blocks.slice(0, shown).join('\n') + (hidden > 0 ? `\n… và ${hidden} mục nữa` : '');
    if (text.length <= EMBED_DESCRIPTION_MAX) return text;
  }
  return `${blocks.length} mục`;
}

/**
 * Mô tả mục thành một dòng: gộp xuống dòng thành dấu cách, escape Markdown, và chèn `\` trước ký tự
 * chỉ có nghĩa ở đầu dòng (`#`, `>`, `-`, `1.`) — mô tả đứng đầu dòng nên sẽ thành tiêu đề/trích dẫn/danh sách.
 */
function descriptionLine(description: string): string {
  return escapeDiscordMarkdown(description.replace(/\s+/g, ' ').trim()).replace(/^([#>-]|\d+\.)/, '\\$1');
}
