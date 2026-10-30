/**
 * Nhắc giờ (spec §4.4): gửi "còn {lead} phút" (`pre15`) và "vào game thôi" (`start`)
 * qua email và DM Discord cho người đang tham gia buổi. Bộ hẹn giờ (Task 11) gọi
 * `runReminders` mỗi phút.
 *
 * Không bao giờ gửi trùng: trước khi gửi, ghi một dòng `notification_log` với khoá
 * chính `(buổi, người, loại, kênh)`; dòng đã có (`ON CONFLICT DO NOTHING` không chèn gì)
 * nghĩa là lần chạy khác đã lo rồi → bỏ qua. Gửi lỗi thì ghi `error` vào dòng đó và KHÔNG
 * thử lại ở lần sau (một DM lỗi không thành mười DM lỗi); người khác vẫn nhận bình thường.
 *
 * Cửa sổ nửa mở (`./windows.ts`): `pre15` khi `startsAt − lead ≤ now < startsAt`, `start`
 * khi `startsAt ≤ now < startsAt + 10 phút`. Khởi động lại sau cửa sổ thì nhắc đó mất
 * luôn (quá 10 phút sau giờ bắt đầu, nhắc "vào game" không còn ý nghĩa).
 *
 * Admin đổi giờ buổi (`updateSession`) thì log của các loại nhắc chưa tới hạn theo giờ mới
 * bị xoá để nhắc lại đúng giờ mới. Vì vậy dòng log chỉ được ghi khi buổi VẪN `scheduled`
 * và vẫn đúng giờ bắt đầu mà lần chạy này đã đọc — xem `deliver`.
 */

import type { Channel, ReminderKind } from '@prisma/client';
import type { Ctx } from '../../ctx.js';
import { getSessionView } from '../sessions/service.js';
import { getSettings } from '../settings/service.js';
import { buildReminder } from './messages.js';
import type { ReminderMessage } from './messages.js';
import { START_WINDOW_MS, reminderKindsDue } from './windows.js';

export { reminderKindsDue } from './windows.js';

/** Cột `error` của notification_log giữ tối đa chừng này ký tự. */
const ERROR_MAX_CHARS = 500;

const MINUTE_MS = 60 * 1000;

/**
 * Một lần gửi: tới ai, loại gì, kênh nào (địa chỉ = email hoặc discordId tuỳ kênh), cho
 * buổi bắt đầu lúc `startsAt` (giờ đã đọc lúc quyết định gửi).
 */
interface Delivery {
  sessionId: number;
  startsAt: Date;
  memberId: number;
  kind: ReminderKind;
  channel: Channel;
  address: string;
}

type MemberContact = { discordId: string; email: string | null; notifyEmail: boolean; notifyDm: boolean };

/**
 * Gửi mọi nhắc đang đến hạn. Trả về số gửi thành công / thất bại (bỏ qua không tính).
 * Lỗi gửi được nuốt (ghi log + cột `error`); lỗi database thì ném ra cho bộ hẹn giờ ghi log.
 */
export async function runReminders(ctx: Ctx): Promise<{ sent: number; failed: number }> {
  const now = ctx.now();
  const { reminderLeadMinutes: lead } = await getSettings(ctx);

  // Một truy vấn cho mọi buổi có thể đến hạn, kèm người đang tham gia còn trong server.
  const sessions = await ctx.db.gameSession.findMany({
    where: {
      status: 'scheduled',
      startsAt: {
        gte: new Date(now.getTime() - START_WINDOW_MS),
        lte: new Date(now.getTime() + lead * MINUTE_MS),
      },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      startsAt: true,
      attendances: {
        where: { status: 'going', member: { status: 'active' } },
        orderBy: [{ updatedAt: 'asc' }, { memberId: 'asc' }],
        select: {
          memberId: true,
          updatedAt: true,
          member: { select: { discordId: true, email: true, notifyEmail: true, notifyDm: true } },
        },
      },
    },
  });

  const result = { sent: 0, failed: 0 };
  for (const session of sessions) {
    // Người tham gia sau mốc startsAt − lead không nhận `pre15` (chỉ nhận `start`).
    const preCutoff = session.startsAt.getTime() - lead * MINUTE_MS;

    for (const kind of reminderKindsDue(session.startsAt, now, lead)) {
      const deliveries = session.attendances.flatMap((a) => {
        if (kind === 'pre15' && a.updatedAt.getTime() > preCutoff) return [];
        return channelsFor(a.member).map((c) => ({
          sessionId: session.id,
          startsAt: session.startsAt,
          memberId: a.memberId,
          kind,
          ...c,
        }));
      });
      if (deliveries.length === 0) continue;

      const message = buildReminder(kind, await getSessionView(ctx, session.id), lead, ctx.config.publicUrl);
      // Tuần tự, không song song: Discord giới hạn tốc độ DM.
      for (const delivery of deliveries) {
        const outcome = await deliver(ctx, delivery, message);
        if (outcome !== 'skipped') result[outcome] += 1;
      }
    }
  }
  return result;
}

/** Kênh người này nhận: email khi bật và có địa chỉ; DM khi bật. Kênh không áp dụng → không có gì (kể cả log). */
function channelsFor(m: MemberContact): { channel: Channel; address: string }[] {
  const channels: { channel: Channel; address: string }[] = [];
  if (m.notifyEmail && m.email) channels.push({ channel: 'email', address: m.email });
  if (m.notifyDm) channels.push({ channel: 'dm', address: m.discordId });
  return channels;
}

/**
 * Ghi log trước rồi gửi. Dòng log đã có → `skipped` (lần chạy khác đã gửi hoặc đã
 * thử); gửi lỗi → ghi `error` vào dòng đó, trả `failed`.
 *
 * Câu ghi log chỉ chèn khi buổi vẫn `scheduled` và vẫn bắt đầu lúc `d.startsAt`, đọc dòng
 * buổi với `FOR SHARE`: nếu admin đang đổi giờ / huỷ (giữ khoá dòng) thì câu này chờ họ
 * commit rồi xét lại điều kiện trên bản mới (READ COMMITTED) → không khớp → `skipped`.
 * Nhờ vậy lần chạy đã đọc giờ cũ không gửi nhắc theo giờ cũ sau khi giờ đã đổi, và
 * không để lại dòng log chặn mất nhắc theo giờ mới.
 */
async function deliver(ctx: Ctx, d: Delivery, message: ReminderMessage): Promise<'sent' | 'failed' | 'skipped'> {
  const key = { sessionId: d.sessionId, memberId: d.memberId, kind: d.kind, channel: d.channel };
  const inserted = await ctx.db.$queryRaw<{ sessionId: number }[]>`
    INSERT INTO notification_log (session_id, member_id, kind, channel, sent_at)
    SELECT id, ${d.memberId}, ${d.kind}::"ReminderKind", ${d.channel}::"Channel", ${ctx.now()}::timestamptz
    FROM game_sessions
    WHERE id = ${d.sessionId} AND status = 'scheduled' AND starts_at = ${d.startsAt}::timestamptz
    FOR SHARE
    ON CONFLICT DO NOTHING
    RETURNING session_id AS "sessionId"
  `;
  if (inserted.length === 0) return 'skipped';

  try {
    if (d.channel === 'email') await ctx.mailer.send(d.address, message.subject, message.text);
    else await ctx.notifier.sendDm(d.address, message.text);
    return 'sent';
  } catch (err) {
    const error = messageOf(err);
    console.error(
      `[reminders] Không gửi được nhắc ${d.kind} qua ${d.channel} cho thành viên ${d.memberId} (buổi ${d.sessionId}): ${error}`,
    );
    await ctx.db.notificationLog.update({
      where: { sessionId_memberId_kind_channel: key },
      data: { error: error.slice(0, ERROR_MAX_CHARS) },
    });
    return 'failed';
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
