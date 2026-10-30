/**
 * Tin treo thưởng của từng buổi trong `#treo-thưởng` (spec treo thưởng §7).
 *
 * Mỗi buổi `scheduled` có ít nhất một mục áp dụng → một tin (tiêu đề theo buổi, danh sách mục, menu
 * "Tôi đã hoàn thành…"). Mục đổi, buổi đổi giờ hay bị huỷ → nơi đổi bật cờ `bounty_dirty` trong cùng
 * giao dịch; bộ hẹn giờ gọi `syncDirtyBountyBoards` mỗi lượt để đăng/sửa tin (giống `discordDirty` của
 * tin buổi). Chưa đặt `DISCORD_BOUNTY_CHANNEL_ID` → không đăng gì và giữ nguyên cờ, nên khi đặt biến
 * về sau các buổi đang có mục được đăng bù.
 *
 * Quyết định cho một buổi (theo trạng thái lúc đồng bộ):
 * - `scheduled`, có mục → sửa tin đã có (cùng kênh), không thì đăng tin mới;
 * - `scheduled`, hết mục (tắt/xoá hết) → xoá tin đã có;
 * - `cancelled` → sửa tin đã có thành "Buổi đã huỷ" (không menu); chưa có tin thì thôi;
 * - `ended` → giữ nguyên tin (menu vẫn dùng được để nhận trong hạn 3 ngày).
 * Tin cũ ở kênh khác (đổi `DISCORD_BOUNTY_CHANNEL_ID`) coi như chưa có. Tin đã bị xoá tay
 * (`MessageGoneError`) → đăng tin mới ngay.
 *
 * Cờ chỉ được xoá khi dòng buổi chưa bị ghi gì kể từ lúc đọc (`xmin`, như `syncSessionMessage`):
 * thay đổi chen vào giữa lúc đang gửi Discord để lại cờ cho lượt sau.
 */

import type { Ctx } from '../../ctx.js';
import { MessageGoneError } from '../../ports.js';
import type { BountyBoardView } from '../../ports.js';
import { bountiesForSession } from './admin.js';

/** Icon của mục không gắn role. */
const NO_ROLE_ICON = '🎯';

/** Đồng bộ mọi buổi còn `bounty_dirty` (bộ hẹn giờ). Chưa cấu hình kênh → không làm gì. Không bao giờ ném lỗi. */
export async function syncDirtyBountyBoards(ctx: Ctx): Promise<void> {
  if (ctx.config.discord.bountyChannelId === null) return;
  const dirty = await ctx.db.gameSession.findMany({ where: { bountyDirty: true }, select: { id: true }, orderBy: { id: 'asc' } });
  for (const { id } of dirty) await syncBountyBoard(ctx, id);
}

/**
 * Đăng/sửa/xoá tin treo thưởng của một buổi theo trạng thái hiện tại. Không bao giờ ném lỗi; lỗi →
 * ghi log và bật lại cờ để lượt sau thử lại. Chưa cấu hình kênh → không làm gì.
 */
export async function syncBountyBoard(ctx: Ctx, sessionId: number): Promise<void> {
  const channelId = ctx.config.discord.bountyChannelId;
  if (channelId === null) return;
  try {
    const rows = await ctx.db.$queryRaw<{ version: string }[]>`
      SELECT xmin::text AS version FROM game_sessions WHERE id = ${sessionId}
    `;
    const version = rows[0]?.version;
    const session =
      version === undefined
        ? null
        : await ctx.db.gameSession.findUnique({
            where: { id: sessionId },
            select: { status: true, startsAt: true, bountyChannelId: true, bountyMessageId: true, mode: { select: { nameVi: true } } },
          });
    if (version === undefined || !session) {
      console.error(`[bounties] Không đồng bộ được tin treo thưởng: không có buổi ${sessionId}`);
      return;
    }

    if (session.status === 'ended') {
      // Buổi đã kết thúc: giữ nguyên tin (menu vẫn nhận được trong hạn), chỉ xoá cờ.
      await ctx.db.$executeRaw`
        UPDATE game_sessions SET bounty_dirty = false
        WHERE id = ${sessionId} AND bounty_dirty AND xmin::text = ${version}
      `;
      return;
    }

    // Tin ở kênh khác (đổi kênh cấu hình) coi như chưa có.
    const existing = session.bountyMessageId !== null && session.bountyChannelId === channelId ? session.bountyMessageId : null;
    const bounties = session.status === 'scheduled' ? await bountiesForSession(ctx, sessionId) : [];
    const view: BountyBoardView = {
      sessionId,
      startsAt: session.startsAt,
      modeName: session.mode.nameVi,
      status: session.status,
      bounties: bounties.map((b) => ({ id: b.id, title: b.title, description: b.description, points: b.points, icon: b.role?.icon ?? NO_ROLE_ICON })),
    };

    let messageId: string | null = null;
    if (session.status === 'cancelled') {
      // Buổi huỷ: sửa tin đã có (nếu còn); không đăng tin mới cho buổi đã huỷ.
      if (existing !== null && (await updateExisting(ctx, channelId, existing, view))) messageId = existing;
    } else if (bounties.length === 0) {
      // Hết mục: bỏ tin (nếu có).
      if (existing !== null) await ctx.notifier.deleteMessage(channelId, existing);
    } else if (existing !== null && (await updateExisting(ctx, channelId, existing, view))) {
      messageId = existing;
    } else {
      messageId = await ctx.notifier.publishBountyBoard(channelId, view);
    }

    // Lưu vị trí tin và xoá cờ trong CÙNG một câu: một lần ghi riêng sẽ đổi `xmin` và che mất dấu
    // "cần sửa lại" ghi chen vào lúc đang gửi Discord.
    const storedChannel = messageId === null ? null : channelId;
    await ctx.db.$executeRaw`
      UPDATE game_sessions
      SET bounty_channel_id = ${storedChannel},
          bounty_message_id = ${messageId},
          bounty_dirty = CASE WHEN xmin::text = ${version} THEN false ELSE bounty_dirty END
      WHERE id = ${sessionId}
    `;
  } catch (err) {
    console.error(`[bounties] Không đồng bộ được tin treo thưởng của buổi ${sessionId}: ${messageOf(err)}`);
    try {
      await ctx.db.gameSession.updateMany({ where: { id: sessionId }, data: { bountyDirty: true } });
    } catch (markErr) {
      console.error(`[bounties] Không đánh dấu được bounty_dirty cho buổi ${sessionId}: ${messageOf(markErr)}`);
    }
  }
}

/** Sửa tin đã đăng; tin không còn (`MessageGoneError`) → false để đăng tin mới. Lỗi khác ném tiếp. */
async function updateExisting(ctx: Ctx, channelId: string, messageId: string, view: BountyBoardView): Promise<boolean> {
  try {
    await ctx.notifier.updateBountyBoard(channelId, messageId, view);
    return true;
  } catch (err) {
    if (!(err instanceof MessageGoneError)) throw err;
    console.warn(`[bounties] Tin treo thưởng ${messageId} của buổi ${view.sessionId} không còn tồn tại — đăng tin mới`);
    return false;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
