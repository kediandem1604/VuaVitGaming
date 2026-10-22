/**
 * Kết thúc buổi chơi (spec §4.3, §4.5): admin bấm "Kết thúc buổi" (chọn hạng mục) hoặc
 * bộ hẹn giờ tự kết thúc sau `autoEndHours` kể từ giờ bắt đầu (chỉ hạng mục tick sẵn).
 * Buổi chuyển `ended`, tin Discord của buổi được sửa, rồi mở đợt vote MVP.
 *
 * Tách khỏi `sessions/service.ts` để module buổi chơi không import module MVP
 * (MVP import `getSessionView` của buổi chơi — tránh import vòng tròn).
 */

import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { defaultCategoryIds, listApplicableCategories } from '../mvp/categories.js';
import { openVoteRound } from '../mvp/votes.js';
import { getSettings } from '../settings/service.js';
import { syncSessionMessage } from './service.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Kết thúc một buổi còn `scheduled` rồi mở vote với `categoryIds` (bỏ trống → hạng
 * mục mặc định: always + mode khớp). Hạng mục được kiểm tra TRƯỚC khi đổi trạng thái:
 * id trùng được lọc; id không có, đã ẩn hoặc không áp dụng cho chế độ của buổi →
 * `VALIDATION`, buổi giữ nguyên. Danh sách rỗng tường minh → kết thúc nhưng không mở vote.
 *
 * Đổi `scheduled → ended` có điều kiện trong một câu lệnh (hai admin bấm cùng lúc
 * chỉ một bên đi tiếp): không đổi được → `SESSION_NOT_OPEN`, buổi không có → `NOT_FOUND`.
 * Cùng câu lệnh ghi `endedAt = now` và `discordDirty = true` — chết giữa chừng thì bộ
 * hẹn giờ vẫn sửa tin. Rồi sửa tin Discord (không ném lỗi) và mở vote; buổi không có
 * người tham gia → không mở vote, không gọi Discord với menu rỗng.
 */
export async function endSession(ctx: Ctx, sessionId: number, categoryIds?: number[]): Promise<void> {
  const session = await ctx.db.gameSession.findUnique({ where: { id: sessionId }, select: { modeId: true } });
  if (!session) throw appError('NOT_FOUND');
  const chosen =
    categoryIds === undefined
      ? await defaultCategoryIds(ctx, session.modeId)
      : await checkChosen(ctx, session.modeId, categoryIds);

  const { count } = await ctx.db.gameSession.updateMany({
    where: { id: sessionId, status: 'scheduled' },
    data: { status: 'ended', endedAt: ctx.now(), discordDirty: true },
  });
  if (count === 0) {
    const exists = await ctx.db.gameSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    throw appError(exists ? 'SESSION_NOT_OPEN' : 'NOT_FOUND');
  }

  await syncSessionMessage(ctx, sessionId);
  await openVoteRound(ctx, sessionId, chosen);
}

/** Lọc trùng và bảo đảm mọi id đều là hạng mục áp dụng được cho chế độ `modeId`. */
async function checkChosen(ctx: Ctx, modeId: number, categoryIds: number[]): Promise<number[]> {
  const chosen = [...new Set(categoryIds)];
  if (chosen.length === 0) return chosen;
  const applicable = new Set((await listApplicableCategories(ctx, modeId)).map((c) => c.id));
  if (chosen.some((id) => !applicable.has(id))) throw appError('VALIDATION', 'Hạng mục không hợp lệ');
  return chosen;
}

/**
 * Tự kết thúc mọi buổi `scheduled` có `startsAt + autoEndHours ≤ now` với hạng mục
 * mặc định, từng buổi một; một buổi lỗi được ghi log, các buổi khác vẫn kết thúc.
 */
export async function autoEndSessions(ctx: Ctx): Promise<void> {
  const { autoEndHours } = await getSettings(ctx);
  const cutoff = new Date(ctx.now().getTime() - autoEndHours * HOUR_MS);
  const due = await ctx.db.gameSession.findMany({
    where: { status: 'scheduled', startsAt: { lte: cutoff } },
    select: { id: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  for (const { id } of due) {
    try {
      await endSession(ctx, id);
    } catch (err) {
      console.error(`[sessions] Không tự kết thúc được buổi ${id}: ${messageOf(err)}`);
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
