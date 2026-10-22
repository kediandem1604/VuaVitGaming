/**
 * Vote MVP (spec §4.5): mở đợt vote khi buổi kết thúc, đăng mỗi hạng mục một tin
 * Discord có menu chọn người có mặt, nhận phiếu, đóng đợt (tự động sau
 * `voteDurationHours` hoặc sớm hơn), tính người thắng và công bố kết quả; Sảnh tri
 * ân đọc kết quả theo ngày VN của buổi chơi.
 *
 * Discord không bao giờ chặn nghiệp vụ: đợt vote và các dòng `vote_messages` được
 * lưu trước, tin Discord đăng sau (đăng bù mỗi phút qua `publishPendingVoteMessages`
 * khi lần đầu lỗi). Không bao giờ gọi Discord với menu rỗng: không có người tham gia
 * thì không mở vote, tin chưa đăng mà hết ứng viên thì chờ.
 *
 * Trạng thái DB là sự thật: `closeVoteRound` đổi `open → closed` có điều kiện trong
 * giao dịch rồi mới gọi Discord, nên hai bên đóng cùng lúc chỉ có một bên công bố;
 * lỗi Discord sau khi đã lưu chỉ được ghi log.
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { formatVnDay, formatVnTime, toVnDate, vnDayRange } from '../../lib/time.js';
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
 * Mở đợt vote cho buổi với các hạng mục `categoryIds` (trùng được lọc). Trả về id đợt;
 * trả `null` — không tạo gì, không gọi Discord — khi không có hạng mục nào hoặc buổi
 * không có người tham gia còn trong server (Discord từ chối menu rỗng). Buổi đã có
 * đợt thì trả về đợt đó, không tạo thêm (kể cả khi hai bên mở cùng lúc).
 *
 * `closesAt = now + voteDurationHours` (cài đặt). Đợt và các dòng `vote_messages`
 * được ghi trong một giao dịch, rồi đăng tin Discord; đăng lỗi thì bộ hẹn giờ đăng bù.
 */
export async function openVoteRound(ctx: Ctx, sessionId: number, categoryIds: number[]): Promise<number | null> {
  const existing = await ctx.db.voteRound.findUnique({ where: { sessionId }, select: { id: true } });
  if (existing) return existing.id;

  const ids = [...new Set(categoryIds)];
  if (ids.length === 0) return null;
  const nominees = await ctx.db.attendance.count({
    where: { sessionId, status: 'going', member: { status: 'active' } },
  });
  if (nominees === 0) return null;

  const { voteDurationHours } = await getSettings(ctx);
  const now = ctx.now();
  const closesAt = new Date(now.getTime() + voteDurationHours * HOUR_MS);

  let roundId: number;
  try {
    roundId = await ctx.db.$transaction(async (tx) => {
      const round = await tx.voteRound.create({ data: { sessionId, opensAt: now, closesAt }, select: { id: true } });
      await tx.voteMessage.createMany({ data: ids.map((categoryId) => ({ roundId: round.id, categoryId })) });
      return round.id;
    });
  } catch (err) {
    // Bên kia vừa mở đợt cho buổi này (sessionId là unique): dùng đợt của họ.
    if (!isUniqueViolation(err)) throw err;
    const winner = await ctx.db.voteRound.findUnique({ where: { sessionId }, select: { id: true } });
    if (!winner) throw err;
    return winner.id;
  }

  await publishPendingVoteMessages(ctx);
  return roundId;
}

// ---------------------------------------------------------------------------
// Đăng tin vote (đăng ngay và đăng bù)
// ---------------------------------------------------------------------------

/**
 * Đăng mọi tin vote chưa có `discordMessageId` của các đợt còn `open` và chưa qua
 * giờ đóng (tin của đợt đã hết hạn không còn ý nghĩa). Ứng viên = người đang tham
 * gia còn trong server, theo thứ tự tham gia; không có ứng viên thì chưa đăng.
 * Mỗi tin độc lập: một tin lỗi được ghi log, các tin khác vẫn đăng. Không ném lỗi Discord.
 *
 * Các lời gọi trong tiến trình chạy nối đuôi nhau (admin kết thúc buổi và bộ hẹn giờ
 * có thể trùng nhịp) để một tin không bị đăng hai lần.
 */
export function publishPendingVoteMessages(ctx: Ctx): Promise<void> {
  const run = publishQueue.then(() => publishPendingNow(ctx));
  publishQueue = run.catch(() => undefined);
  return run;
}

let publishQueue: Promise<void> = Promise.resolve();

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

/**
 * Bỏ (hoặc đổi) phiếu: mỗi người một phiếu cho mỗi hạng mục của đợt. Kiểm tra theo
 * thứ tự: đợt có (`NOT_FOUND`) → còn mở và chưa tới giờ đóng (`ROUND_CLOSED`) → hạng
 * mục thuộc đợt (`CATEGORY_NOT_IN_ROUND`) → người vote còn trong server (`FORBIDDEN`)
 * → không tự vote (`SELF_VOTE`) → người được vote đang tham gia buổi và còn trong
 * server (`NOT_NOMINEE`).
 *
 * Khoá dòng đợt (`FOR UPDATE`) trong giao dịch để phiếu bỏ đúng lúc đóng đợt không
 * lọt ra ngoài bảng kết quả: hoặc phiếu vào trước và được tính, hoặc thấy đợt đã đóng.
 */
export async function castVote(ctx: Ctx, input: VoteInput): Promise<void> {
  const parsed = voteSchema.safeParse(input);
  if (!parsed.success) throw appError('VALIDATION');
  const { roundId, categoryId, voterId, nomineeId } = parsed.data;

  await ctx.db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM vote_rounds WHERE id = ${roundId} FOR UPDATE`;
    if (locked.length === 0) throw appError('NOT_FOUND');
    const round = await tx.voteRound.findUniqueOrThrow({
      where: { id: roundId },
      select: { status: true, closesAt: true, sessionId: true },
    });
    if (round.status !== 'open' || ctx.now().getTime() >= round.closesAt.getTime()) throw appError('ROUND_CLOSED');

    const inRound = await tx.voteMessage.findUnique({
      where: { roundId_categoryId: { roundId, categoryId } },
      select: { categoryId: true },
    });
    if (!inRound) throw appError('CATEGORY_NOT_IN_ROUND');

    const voter = await tx.member.findUnique({ where: { id: voterId }, select: { status: true } });
    if (voter?.status !== 'active') throw appError('FORBIDDEN');
    if (voterId === nomineeId) throw appError('SELF_VOTE');

    const nominee = await tx.attendance.findUnique({
      where: { sessionId_memberId: { sessionId: round.sessionId, memberId: nomineeId } },
      select: { status: true, member: { select: { status: true } } },
    });
    if (nominee?.status !== 'going' || nominee.member.status !== 'active') throw appError('NOT_NOMINEE');

    // Ghi rõ updatedAt = ctx.now() để đè @updatedAt (đồng hồ thật).
    const now = ctx.now();
    await tx.vote.upsert({
      where: { roundId_categoryId_voterId: { roundId, categoryId, voterId } },
      create: { roundId, categoryId, voterId, nomineeId, updatedAt: now },
      update: { nomineeId, updatedAt: now },
    });
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

interface ClosedCategory {
  name: string;
  discordMessageId: string | null;
  winners: { displayName: string; voteCount: number }[];
}

/**
 * Đóng đợt vote: trong một giao dịch đổi `open → closed` có điều kiện (đợt đã đóng
 * hoặc không có → không làm gì, kể cả khi hai bên đóng cùng lúc), tính người thắng
 * từng hạng mục của đợt và ghi `awards`. Sau đó công bố kết quả vào kênh thông báo
 * (một lần cho cả đợt) và sửa từng tin vote đã đăng thành kết quả. Lỗi Discord sau
 * khi đã lưu chỉ được ghi log — không ném, không hoàn tác.
 */
export async function closeVoteRound(ctx: Ctx, roundId: number): Promise<void> {
  const closed = await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.voteRound.updateMany({
      where: { id: roundId, status: 'open' },
      data: { status: 'closed' },
    });
    if (count === 0) return null;

    const round = await tx.voteRound.findUniqueOrThrow({
      where: { id: roundId },
      select: {
        session: { select: { startsAt: true, mode: { select: { nameVi: true } } } },
        messages: {
          select: { categoryId: true, discordMessageId: true, category: { select: { name: true } } },
          orderBy: [{ category: { sortOrder: 'asc' } }, { categoryId: 'asc' }],
        },
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
    const tallied = round.messages.map((m) => ({
      ...m,
      winners: tallyWinners(nomineesByCategory.get(m.categoryId) ?? []),
    }));

    const awards = tallied.flatMap((c) =>
      c.winners.map((w) => ({ roundId, categoryId: c.categoryId, memberId: w.memberId, voteCount: w.voteCount })),
    );
    if (awards.length > 0) await tx.award.createMany({ data: awards, skipDuplicates: true });

    const names = await displayNames(tx, awards.map((a) => a.memberId));
    const categories: ClosedCategory[] = tallied.map((c) => ({
      name: c.category.name,
      discordMessageId: c.discordMessageId,
      winners: c.winners.map((w) => ({
        displayName: names.get(w.memberId) ?? `#${w.memberId}`,
        voteCount: w.voteCount,
      })),
    }));
    const label = sessionLabel({ modeName: round.session.mode.nameVi, startsAt: round.session.startsAt });
    return { label, categories };
  });
  if (!closed) return;

  try {
    await ctx.notifier.announce(buildAnnouncement(closed.label, closed.categories));
  } catch (err) {
    console.error(`[mvp] Không công bố được kết quả đợt vote ${roundId}: ${messageOf(err)}`);
  }
  for (const c of closed.categories) {
    if (!c.discordMessageId) continue; // Tin chưa từng đăng được (Discord sập lúc mở) — không có gì để sửa.
    try {
      await ctx.notifier.closeVote(c.discordMessageId, resultText(c.winners));
    } catch (err) {
      console.error(`[mvp] Không đóng được tin vote ${c.discordMessageId} của đợt ${roundId}: ${messageOf(err)}`);
    }
  }
}

async function displayNames(tx: Prisma.TransactionClient, memberIds: number[]): Promise<Map<number, string>> {
  if (memberIds.length === 0) return new Map();
  const rows = await tx.member.findMany({
    where: { id: { in: [...new Set(memberIds)] } },
    select: { id: true, displayName: true },
  });
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/** `{tên1}, {tên2} ({n} phiếu)` — hoặc "Không ai được vote". */
function winnersText(winners: { displayName: string; voteCount: number }[]): string {
  const first = winners[0];
  if (!first) return NO_VOTES;
  return `${winners.map((w) => w.displayName).join(', ')} (${first.voteCount} phiếu)`;
}

/** Thông báo kết quả cả đợt vào kênh thông báo. */
function buildAnnouncement(label: string, categories: ClosedCategory[]): string {
  return [`🏆 Kết quả tri ân buổi ${label}`, ...categories.map((c) => `• ${c.name}: ${winnersText(c.winners)}`)].join(
    '\n',
  );
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
