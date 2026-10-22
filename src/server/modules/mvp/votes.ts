/**
 * Vote MVP (spec §4.5): mở đợt vote khi buổi kết thúc, đăng mỗi hạng mục một tin
 * Discord có menu chọn người có mặt, nhận phiếu, đóng đợt (tự động sau
 * `voteDurationHours` hoặc sớm hơn), tính người thắng và công bố kết quả; Sảnh tri
 * ân đọc kết quả theo ngày VN của buổi chơi.
 *
 * Discord không bao giờ chặn nghiệp vụ và mọi tin lỗi đều được đăng bù (spec §9):
 * - Đợt vote và các dòng `vote_messages` được tạo trong giao dịch kết thúc buổi;
 *   tin menu đăng sau, tin nào chưa có `discordMessageId` thì `vote-sync` đăng bù.
 * - Đóng đợt ghi kết quả vào DB rồi mới gọi Discord; `announcePending` (đợt) và
 *   `resultPending` (từng tin) chỉ tắt khi Discord đã nhận, nên thông báo và các tin
 *   kết quả cũng được `vote-sync` đăng bù, dựng lại y nguyên từ DB.
 * - Không bao giờ gọi Discord với menu rỗng: không có người tham gia thì không mở
 *   vote, tin chưa đăng mà hết ứng viên thì chờ.
 *
 * Trạng thái DB là sự thật: `closeVoteRound` đổi `open → closed` có điều kiện trong
 * giao dịch, nên hai bên đóng cùng lúc chỉ có một bên đi tiếp; mọi lời gọi Discord
 * của module chạy nối đuôi nhau trong tiến trình và đọc lại cờ trước khi gửi, nên
 * một tin không bao giờ đăng hai lần.
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { formatVnDay, formatVnTime, toVnDate, vnDayRange } from '../../lib/time.js';
import { MessageGoneError } from '../../ports.js';
import type { SessionView, VotePrompt } from '../../ports.js';
import type { HallOfDayDto, HallSessionDto } from '../../../shared/api-types.js';
import { getSessionView } from '../sessions/service.js';
import { getSettings } from '../settings/service.js';

const HOUR_MS = 60 * 60 * 1000;

/** Chữ hiện khi một hạng mục không có phiếu nào (thông báo và tin vote). */
const NO_VOTES = 'Không ai được vote';

// ---------------------------------------------------------------------------
// Mở đợt vote
// ---------------------------------------------------------------------------

/**
 * Tạo đợt vote cho buổi trong giao dịch `tx` với các hạng mục `categoryIds` (trùng
 * được lọc): `opensAt = now`, `closesAt = now + voteDurationHours`, một dòng
 * `vote_messages` mỗi hạng mục. Trả về id đợt; trả `null` — không tạo gì — khi không
 * có hạng mục nào hoặc buổi không có người tham gia còn trong server (Discord từ chối
 * menu rỗng). Buổi đã có đợt thì trả về đợt đó, không tạo thêm.
 *
 * `endSession` gọi hàm này trong cùng giao dịch với việc đổi trạng thái buổi, nên
 * không bao giờ có buổi "đã kết thúc mà không có vote" vì lỗi giữa chừng.
 */
export async function createRoundTx(
  tx: Prisma.TransactionClient,
  sessionId: number,
  categoryIds: number[],
  now: Date,
  voteDurationHours: number,
): Promise<number | null> {
  const existing = await tx.voteRound.findUnique({ where: { sessionId }, select: { id: true } });
  if (existing) return existing.id;

  const ids = [...new Set(categoryIds)];
  if (ids.length === 0) return null;
  const nominees = await tx.attendance.count({
    where: { sessionId, status: 'going', member: { status: 'active' } },
  });
  if (nominees === 0) return null;

  const round = await tx.voteRound.create({
    data: { sessionId, opensAt: now, closesAt: new Date(now.getTime() + voteDurationHours * HOUR_MS) },
    select: { id: true },
  });
  await tx.voteMessage.createMany({ data: ids.map((categoryId) => ({ roundId: round.id, categoryId })) });
  return round.id;
}

/**
 * Mở đợt vote cho buổi (xem `createRoundTx`) trong giao dịch riêng, rồi đăng tin
 * Discord; đăng lỗi thì bộ hẹn giờ đăng bù. Hai bên mở cùng lúc cho một buổi thì
 * bên thua cuộc đua trả về đợt bên thắng vừa tạo.
 */
export async function openVoteRound(ctx: Ctx, sessionId: number, categoryIds: number[]): Promise<number | null> {
  const { voteDurationHours } = await getSettings(ctx);
  const now = ctx.now();

  let roundId: number | null;
  try {
    roundId = await ctx.db.$transaction((tx) => createRoundTx(tx, sessionId, categoryIds, now, voteDurationHours));
  } catch (err) {
    // Bên kia vừa mở đợt cho buổi này (sessionId là unique): dùng đợt của họ.
    if (!isUniqueViolation(err)) throw err;
    const winner = await ctx.db.voteRound.findUnique({ where: { sessionId }, select: { id: true } });
    if (!winner) throw err;
    return winner.id;
  }

  if (roundId !== null) await publishPendingVoteMessages(ctx);
  return roundId;
}

// ---------------------------------------------------------------------------
// Hàng đợi Discord trong tiến trình
// ---------------------------------------------------------------------------

/**
 * Mọi lời gọi Discord của module (đăng menu, công bố kết quả, sửa tin) chạy nối đuôi
 * nhau trong tiến trình (web + bot + bộ hẹn giờ chung một tiến trình): admin kết thúc
 * / đóng sớm và `vote-sync` có thể trùng nhịp, mà mỗi lượt đều đọc lại cờ trong DB
 * trước khi gửi, nên một tin không bao giờ đăng hai lần.
 */
let discordQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = discordQueue.then(task);
  discordQueue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Đăng tin vote (đăng ngay và đăng bù)
// ---------------------------------------------------------------------------

/**
 * Đăng mọi tin vote chưa có `discordMessageId` của các đợt còn `open` và chưa qua
 * giờ đóng (tin của đợt đã hết hạn không còn ý nghĩa). Ứng viên = người đang tham
 * gia còn trong server, theo thứ tự tham gia; không có ứng viên thì chưa đăng.
 * Mỗi tin độc lập: một tin lỗi được ghi log, các tin khác vẫn đăng. Không ném lỗi Discord.
 */
export function publishPendingVoteMessages(ctx: Ctx): Promise<void> {
  return enqueue(() => publishPendingNow(ctx));
}

async function publishPendingNow(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  const pending = await ctx.db.voteMessage.findMany({
    where: { discordMessageId: null, round: { status: 'open', closesAt: { gt: now } } },
    orderBy: [{ roundId: 'asc' }, { category: { sortOrder: 'asc' } }, { categoryId: 'asc' }],
    select: {
      roundId: true,
      categoryId: true,
      category: { select: { name: true, description: true } },
      round: { select: { sessionId: true, closesAt: true } },
    },
  });

  // Một buổi thường có nhiều tin: đọc buổi một lần cho cả nhóm.
  const views = new Map<number, SessionView>();
  for (const m of pending) {
    try {
      let view = views.get(m.round.sessionId);
      if (!view) {
        view = await getSessionView(ctx, m.round.sessionId);
        views.set(m.round.sessionId, view);
      }
      if (view.attendees.length === 0) continue; // Discord từ chối menu rỗng — chờ lượt sau.
      // Đợt có thể vừa đóng (đóng sớm) sau truy vấn ở trên: kiểm tra lại ngay trước khi đăng
      // để không treo thêm menu cho đợt đã đóng. Tin đã gửi đi mà đợt đóng đúng lúc đó vẫn
      // được lưu id và sẽ được sửa thành kết quả nhờ cờ `resultPending`.
      if (!(await isRoundOpen(ctx, m.roundId))) continue;

      const prompt: VotePrompt = {
        roundId: m.roundId,
        categoryId: m.categoryId,
        categoryName: m.category.name,
        description: m.category.description,
        sessionLabel: sessionLabel(view),
        closesAt: m.round.closesAt,
        nominees: view.attendees,
      };
      const messageId = await ctx.notifier.publishVote(prompt);
      await ctx.db.voteMessage.updateMany({
        where: { roundId: m.roundId, categoryId: m.categoryId, discordMessageId: null },
        data: { discordMessageId: messageId },
      });
    } catch (err) {
      console.error(
        `[mvp] Không đăng được tin vote hạng mục ${m.categoryId} của đợt ${m.roundId}: ${messageOf(err)}`,
      );
    }
  }
}

async function isRoundOpen(ctx: Ctx, roundId: number): Promise<boolean> {
  const round = await ctx.db.voteRound.findUnique({ where: { id: roundId }, select: { status: true, closesAt: true } });
  return round?.status === 'open' && round.closesAt.getTime() > ctx.now().getTime();
}

/** `{chế độ} {HH:mm} {dd/MM}` giờ VN — nhãn buổi trên tin vote và thông báo kết quả. */
function sessionLabel(s: { modeName: string; startsAt: Date }): string {
  return `${s.modeName} ${formatVnTime(s.startsAt)} ${formatVnDay(s.startsAt)}`;
}

// ---------------------------------------------------------------------------
// Bỏ phiếu
// ---------------------------------------------------------------------------

export interface VoteInput {
  roundId: number;
  categoryId: number;
  voterId: number;
  nomineeId: number;
}

const voteSchema = z.object({
  roundId: z.number().int(),
  categoryId: z.number().int(),
  voterId: z.number().int(),
  nomineeId: z.number().int(),
});

/** Tên để trả lời người vừa vote ("Đã vote {nomineeName} cho “{categoryName}”"). */
export interface VoteReceipt {
  nomineeName: string;
  categoryName: string;
}

/**
 * Bỏ (hoặc đổi) phiếu: mỗi người một phiếu cho mỗi hạng mục của đợt. Kiểm tra theo
 * thứ tự: đợt có (`NOT_FOUND`) → còn mở và chưa tới giờ đóng (`ROUND_CLOSED`) → hạng
 * mục thuộc đợt (`CATEGORY_NOT_IN_ROUND`) → người vote còn trong server (`FORBIDDEN`)
 * → không tự vote (`SELF_VOTE`) → người được vote đang tham gia buổi và còn trong
 * server (`NOT_NOMINEE`). Trả về tên người được vote và hạng mục (đọc trong cùng giao dịch).
 *
 * Khoá dòng đợt (`FOR UPDATE`) trong giao dịch để phiếu bỏ đúng lúc đóng đợt không
 * lọt ra ngoài bảng kết quả: hoặc phiếu vào trước và được tính, hoặc thấy đợt đã đóng.
 */
export async function castVote(ctx: Ctx, input: VoteInput): Promise<VoteReceipt> {
  const parsed = voteSchema.safeParse(input);
  if (!parsed.success) throw appError('VALIDATION');
  const { roundId, categoryId, voterId, nomineeId } = parsed.data;

  return ctx.db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM vote_rounds WHERE id = ${roundId} FOR UPDATE`;
    if (locked.length === 0) throw appError('NOT_FOUND');
    const round = await tx.voteRound.findUniqueOrThrow({
      where: { id: roundId },
      select: { status: true, closesAt: true, sessionId: true },
    });
    if (round.status !== 'open' || ctx.now().getTime() >= round.closesAt.getTime()) throw appError('ROUND_CLOSED');

    const inRound = await tx.voteMessage.findUnique({
      where: { roundId_categoryId: { roundId, categoryId } },
      select: { category: { select: { name: true } } },
    });
    if (!inRound) throw appError('CATEGORY_NOT_IN_ROUND');

    const voter = await tx.member.findUnique({ where: { id: voterId }, select: { status: true } });
    if (voter?.status !== 'active') throw appError('FORBIDDEN');
    if (voterId === nomineeId) throw appError('SELF_VOTE');

    const nominee = await tx.attendance.findUnique({
      where: { sessionId_memberId: { sessionId: round.sessionId, memberId: nomineeId } },
      select: { status: true, member: { select: { status: true, displayName: true } } },
    });
    if (nominee?.status !== 'going' || nominee.member.status !== 'active') throw appError('NOT_NOMINEE');

    // Ghi rõ updatedAt = ctx.now() để đè @updatedAt (đồng hồ thật).
    const now = ctx.now();
    await tx.vote.upsert({
      where: { roundId_categoryId_voterId: { roundId, categoryId, voterId } },
      create: { roundId, categoryId, voterId, nomineeId, updatedAt: now },
      update: { nomineeId, updatedAt: now },
    });
    return { nomineeName: nominee.member.displayName, categoryName: inRound.category.name };
  });
}

// ---------------------------------------------------------------------------
// Tính kết quả, đóng đợt
// ---------------------------------------------------------------------------

export interface Winner {
  memberId: number;
  voteCount: number;
}

/**
 * Người thắng từ danh sách người được vote (một phần tử = một phiếu): mọi người có
 * số phiếu cao nhất (hoà thì cùng nhận), theo số phiếu giảm dần rồi memberId tăng
 * dần (ruling R6). Không có phiếu → rỗng.
 */
export function tallyWinners(nomineeIds: number[]): Winner[] {
  const counts = new Map<number, number>();
  for (const id of nomineeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  if (max === 0) return [];
  return [...counts]
    .filter(([, voteCount]) => voteCount === max)
    .map(([memberId, voteCount]) => ({ memberId, voteCount }))
    .sort((a, b) => b.voteCount - a.voteCount || a.memberId - b.memberId);
}

/**
 * Đóng đợt vote. Trong một giao dịch: đổi `open → closed` có điều kiện (đợt đã đóng
 * hoặc không có → không làm gì, kể cả khi hai bên đóng cùng lúc), tính người thắng
 * từng hạng mục của đợt và ghi `awards`, bật `announcePending` cho đợt và
 * `resultPending` cho mọi tin của đợt. Sau khi lưu xong mới gọi Discord
 * (`deliverRoundResults`). Giao dịch đã lưu thì hàm không ném lỗi nữa: mọi lỗi của
 * bước đăng kết quả (Discord hay DB) chỉ ghi log — `vote-sync` đăng bù (ruling R27).
 */
export async function closeVoteRound(ctx: Ctx, roundId: number): Promise<void> {
  const closed = await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.voteRound.updateMany({
      where: { id: roundId, status: 'open' },
      data: { status: 'closed', announcePending: true },
    });
    if (count === 0) return false;

    const round = await tx.voteRound.findUniqueOrThrow({
      where: { id: roundId },
      select: {
        messages: { select: { categoryId: true } },
        votes: { select: { categoryId: true, nomineeId: true } },
      },
    });
    const nomineesByCategory = new Map<number, number[]>();
    for (const v of round.votes) {
      const list = nomineesByCategory.get(v.categoryId) ?? [];
      list.push(v.nomineeId);
      nomineesByCategory.set(v.categoryId, list);
    }
    // Chỉ hạng mục có trong `vote_messages` của đợt mới có kết quả.
    const awards = round.messages.flatMap((m) =>
      tallyWinners(nomineesByCategory.get(m.categoryId) ?? []).map((w) => ({
        roundId,
        categoryId: m.categoryId,
        memberId: w.memberId,
        voteCount: w.voteCount,
      })),
    );
    if (awards.length > 0) await tx.award.createMany({ data: awards, skipDuplicates: true });

    // Mọi tin của đợt chờ được sửa thành kết quả — kể cả tin chưa có id: tin đang gửi
    // đúng lúc này vẫn có thể nhận id ngay sau đây và sẽ được sửa ở lượt đăng bù.
    await tx.voteMessage.updateMany({ where: { roundId }, data: { resultPending: true } });
    return true;
  });
  if (!closed) return;

  try {
    await enqueue(() => deliverRoundResults(ctx, roundId));
  } catch (err) {
    console.error(`[mvp] Đợt vote ${roundId} đã đóng nhưng chưa đăng được kết quả (sẽ đăng bù): ${messageOf(err)}`);
  }
}

/**
 * Admin đóng sớm một đợt qua web: đợt không có → `NOT_FOUND`; đợt đã đóng → không
 * làm gì (bấm hai lần vô hại). Khác `closeVoteRound` (bộ hẹn giờ gọi, lặng lẽ bỏ qua
 * đợt không có) chỉ ở chỗ báo lỗi cho người dùng khi id sai.
 */
export async function closeVoteRoundEarly(ctx: Ctx, roundId: number): Promise<void> {
  const round = await ctx.db.voteRound.findUnique({ where: { id: roundId }, select: { id: true } });
  if (!round) throw appError('NOT_FOUND');
  await closeVoteRound(ctx, roundId);
}

/**
 * Đăng những gì Discord còn thiếu của một đợt đã đóng, dựng lại từ DB (`awards` +
 * hạng mục, nên lần đăng bù giống y lần đầu): thông báo kết quả nếu `announcePending`,
 * rồi sửa từng tin đã có id còn `resultPending`. Gửi thành công thì tắt cờ tương ứng;
 * lỗi Discord chỉ ghi log để lượt sau thử lại, các tin khác vẫn được gửi. Tin đã bị
 * xoá tay (`MessageGoneError`) coi như xong — không còn gì để sửa, kết quả vẫn nằm
 * trong thông báo (ruling R27).
 */
async function deliverRoundResults(ctx: Ctx, roundId: number): Promise<void> {
  const round = await ctx.db.voteRound.findUnique({
    where: { id: roundId },
    select: {
      status: true,
      announcePending: true,
      session: { select: { startsAt: true, mode: { select: { nameVi: true } } } },
      messages: {
        select: { categoryId: true, discordMessageId: true, resultPending: true, category: { select: { name: true } } },
        orderBy: [{ category: { sortOrder: 'asc' } }, { categoryId: 'asc' }],
      },
      awards: {
        select: { categoryId: true, voteCount: true, member: { select: { displayName: true } } },
        orderBy: [{ voteCount: 'desc' }, { memberId: 'asc' }],
      },
    },
  });
  if (round?.status !== 'closed') return;

  const results = round.messages.map((m) => ({
    ...m,
    winners: round.awards
      .filter((a) => a.categoryId === m.categoryId)
      .map((a) => ({ displayName: a.member.displayName, voteCount: a.voteCount })),
  }));

  if (round.announcePending) {
    const label = sessionLabel({ modeName: round.session.mode.nameVi, startsAt: round.session.startsAt });
    let announced = false;
    try {
      await ctx.notifier.announce(buildAnnouncement(label, results));
      announced = true;
    } catch (err) {
      console.error(`[mvp] Không công bố được kết quả đợt vote ${roundId}: ${messageOf(err)}`);
    }
    if (announced) await ctx.db.voteRound.updateMany({ where: { id: roundId }, data: { announcePending: false } });
  }

  for (const r of results) {
    if (!r.discordMessageId || !r.resultPending) continue;
    let delivered = false;
    try {
      await ctx.notifier.closeVote(r.discordMessageId, resultText(r.winners));
      delivered = true;
    } catch (err) {
      if (err instanceof MessageGoneError) {
        console.warn(`[mvp] Tin vote ${r.discordMessageId} của đợt ${roundId} đã bị xoá — bỏ qua việc ghi kết quả lên tin`);
        delivered = true;
      } else {
        console.error(`[mvp] Không đóng được tin vote ${r.discordMessageId} của đợt ${roundId}: ${messageOf(err)}`);
      }
    }
    if (delivered) {
      await ctx.db.voteMessage.updateMany({
        where: { roundId, categoryId: r.categoryId },
        data: { resultPending: false },
      });
    }
  }
}

/** `{tên1}, {tên2} ({n} phiếu)` — hoặc "Không ai được vote". */
function winnersText(winners: { displayName: string; voteCount: number }[]): string {
  const first = winners[0];
  if (!first) return NO_VOTES;
  return `${winners.map((w) => w.displayName).join(', ')} (${first.voteCount} phiếu)`;
}

/** Thông báo kết quả cả đợt vào kênh thông báo. */
function buildAnnouncement(
  label: string,
  categories: { category: { name: string }; winners: { displayName: string; voteCount: number }[] }[],
): string {
  return [
    `🏆 Kết quả tri ân buổi ${label}`,
    ...categories.map((c) => `• ${c.category.name}: ${winnersText(c.winners)}`),
  ].join('\n');
}

/** Kết quả thay cho menu chọn trên từng tin vote. */
function resultText(winners: { displayName: string; voteCount: number }[]): string {
  return winners.length === 0 ? NO_VOTES : `🏆 ${winnersText(winners)}`;
}

/** Đóng mọi đợt `open` đã tới giờ đóng, từng đợt một; một đợt lỗi được ghi log, các đợt khác vẫn đóng. */
export async function closeDueRounds(ctx: Ctx): Promise<void> {
  const due = await ctx.db.voteRound.findMany({
    where: { status: 'open', closesAt: { lte: ctx.now() } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const { id } of due) {
    try {
      await closeVoteRound(ctx, id);
    } catch (err) {
      console.error(`[mvp] Không đóng được đợt vote ${id}: ${messageOf(err)}`);
    }
  }
}

/**
 * Đăng bù kết quả của các đợt đã đóng mà Discord còn thiếu: thông báo chưa đăng được
 * (`announcePending`) hoặc tin đã có id nhưng chưa sửa thành kết quả (`resultPending`).
 * Từng đợt một; một đợt lỗi được ghi log, các đợt khác vẫn chạy.
 */
export async function retryRoundResults(ctx: Ctx): Promise<void> {
  const rounds = await ctx.db.voteRound.findMany({
    where: {
      status: 'closed',
      OR: [{ announcePending: true }, { messages: { some: { resultPending: true, discordMessageId: { not: null } } } }],
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const { id } of rounds) {
    try {
      await enqueue(() => deliverRoundResults(ctx, id));
    } catch (err) {
      console.error(`[mvp] Không đăng bù được kết quả đợt vote ${id}: ${messageOf(err)}`);
    }
  }
}

/** Việc `vote-sync` của bộ hẹn giờ: đăng bù menu vote còn thiếu, rồi đăng bù kết quả còn thiếu. */
export async function syncVotes(ctx: Ctx): Promise<void> {
  await publishPendingVoteMessages(ctx);
  await retryRoundResults(ctx);
}

// ---------------------------------------------------------------------------
// Sảnh tri ân
// ---------------------------------------------------------------------------

/**
 * Sảnh tri ân của một ngày VN: các buổi bắt đầu trong ngày đó đã đóng vote, theo giờ
 * bắt đầu; mỗi buổi liệt kê mọi hạng mục của đợt theo sortOrder (hạng mục không ai
 * được vote vẫn có, `winners` rỗng). Ngày sai định dạng → `VALIDATION`.
 */
export async function getDailyHall(ctx: Ctx, vnDate: string): Promise<HallOfDayDto> {
  let range: { start: Date; end: Date };
  try {
    range = vnDayRange(vnDate);
  } catch {
    throw appError('VALIDATION', 'Ngày không hợp lệ');
  }

  const rows = await ctx.db.gameSession.findMany({
    where: { startsAt: { gte: range.start, lt: range.end }, voteRound: { status: 'closed' } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      startsAt: true,
      mode: { select: { nameVi: true } },
      voteRound: {
        select: {
          messages: {
            select: { categoryId: true, category: { select: { name: true } } },
            orderBy: [{ category: { sortOrder: 'asc' } }, { categoryId: 'asc' }],
          },
          awards: {
            select: {
              categoryId: true,
              memberId: true,
              voteCount: true,
              member: { select: { displayName: true, avatarUrl: true } },
            },
            orderBy: [{ voteCount: 'desc' }, { memberId: 'asc' }],
          },
        },
      },
    },
  });

  const sessions: HallSessionDto[] = rows.map((s) => ({
    sessionId: s.id,
    label: `${s.mode.nameVi} ${formatVnTime(s.startsAt)}`,
    awards: (s.voteRound?.messages ?? []).map((m) => ({
      categoryName: m.category.name,
      winners: (s.voteRound?.awards ?? [])
        .filter((a) => a.categoryId === m.categoryId)
        .map((a) => ({
          memberId: a.memberId,
          displayName: a.member.displayName,
          avatarUrl: a.member.avatarUrl,
          voteCount: a.voteCount,
        })),
    })),
  }));
  return { date: vnDate, sessions };
}

/** Các ngày VN (mới nhất trước, tối đa `limit`) có buổi đã đóng vote — cho trang lịch sử tri ân. */
export async function listHallDates(ctx: Ctx, limit: number): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1) throw appError('VALIDATION', 'Giới hạn không hợp lệ');
  // Ngày VN tính trong code (chỉ lib/time.ts làm toán múi giờ), nên gom nhóm ở đây thay vì trong SQL.
  const rows = await ctx.db.gameSession.findMany({
    where: { voteRound: { status: 'closed' } },
    select: { startsAt: true },
    orderBy: { startsAt: 'desc' },
  });
  const dates: string[] = [];
  for (const { startsAt } of rows) {
    const date = toVnDate(startsAt);
    if (dates.at(-1) === date) continue;
    dates.push(date);
    if (dates.length === limit) break;
  }
  return dates;
}

// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
