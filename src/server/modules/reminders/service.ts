/**
 * Nhắc giờ (spec §4.4): gửi "còn {lead} phút" (`pre15`) và "vào game thôi" (`start`)
 * qua email và DM Discord cho người đang tham gia buổi. Bộ hẹn giờ (Task 11) gọi
 * `runReminders` mỗi phút.
 *
 * Không bao giờ gửi trùng: trước khi gửi, ghi một dòng `notification_log` với khoá
 * chính `(buổi, người, loại, kênh)`; dòng đã có (`P2002`) nghĩa là lần chạy khác đã
 * lo rồi → bỏ qua. Gửi lỗi thì ghi `error` vào dòng đó và KHÔNG thử lại ở lần sau
 * (một DM lỗi không thành mười DM lỗi); người khác vẫn nhận bình thường.
 *
 * Cửa sổ nửa mở: `pre15` khi `startsAt − lead ≤ now < startsAt`, `start` khi
 * `startsAt ≤ now < startsAt + 10 phút`. Khởi động lại sau cửa sổ thì nhắc đó mất
 * luôn (quá 10 phút sau giờ bắt đầu, nhắc "vào game" không còn ý nghĩa).
 */

import { Prisma } from '@prisma/client';
import type { Channel, ReminderKind } from '@prisma/client';
import type { Ctx } from '../../ctx.js';
import { getSessionView } from '../sessions/service.js';
import { getSettings } from '../settings/service.js';
import { buildReminder } from './messages.js';
import type { ReminderMessage } from './messages.js';

/** Sau giờ bắt đầu bao lâu thì thôi không nhắc `start` nữa. */
const START_WINDOW_MS = 10 * 60 * 1000;
/** Cột `error` của notification_log giữ tối đa chừng này ký tự. */
const ERROR_MAX_CHARS = 500;

const MINUTE_MS = 60 * 1000;

/** Loại nhắc đang đến hạn tại `now` cho buổi bắt đầu lúc `startsAt` (tối đa một loại). */
export function reminderKindsDue(startsAt: Date, now: Date, leadMinutes: number): ReminderKind[] {
  const s = startsAt.getTime();
  const t = now.getTime();
  if (s - leadMinutes * MINUTE_MS <= t && t < s) return ['pre15'];
  if (s <= t && t < s + START_WINDOW_MS) return ['start'];
  return [];
}

/** Một lần gửi: tới ai, loại gì, kênh nào (địa chỉ = email hoặc discordId tuỳ kênh). */
interface Delivery {
  sessionId: number;
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
        return channelsFor(a.member).map((c) => ({ sessionId: session.id, memberId: a.memberId, kind, ...c }));
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
 */
async function deliver(ctx: Ctx, d: Delivery, message: ReminderMessage): Promise<'sent' | 'failed' | 'skipped'> {
  const key = { sessionId: d.sessionId, memberId: d.memberId, kind: d.kind, channel: d.channel };
  try {
    await ctx.db.notificationLog.create({ data: { ...key, sentAt: ctx.now() } });
  } catch (err) {
    if (isUniqueViolation(err)) return 'skipped';
    throw err;
  }

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

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
