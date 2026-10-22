/**
 * Dựng tin Discord của một buổi chơi (embed + hàng nút) từ `SessionView`.
 * Hàm thuần, trả JSON thuần (kiểu API của Discord) nên test không cần kết nối;
 * `DiscordJsNotifier` gửi/sửa đúng payload này. Các giới hạn của Discord (field
 * 1024 ký tự, tiêu đề 256) được tôn trọng ở đây để tin không bao giờ bị từ chối.
 */

import { ButtonStyle, ComponentType } from 'discord.js';
import type { APIActionRowComponent, APIButtonComponent, APIEmbed, APIEmbedField } from 'discord.js';
import { formatVnDay, formatVnTime } from '../lib/time.js';
import type { SessionView } from '../ports.js';
import { encodeCustomId } from './custom-ids.js';

export interface SessionMessage {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent>[];
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
