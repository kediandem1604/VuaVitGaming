/**
 * Ván đấu (spec 2026-11-01 game rounds §2, §4, §5 phần đọc): mỗi buổi chơi có các ván — ảnh kết quả do
 * mod/admin up kèm phe thắng (Phe thứ 3 thắng thì tick người thắng). Lần khai theo ván là `stat_reports`
 * có `round_id`; điểm thắng/thua tính lúc đọc (`leaderboard.ts`, `reports.ts`) nên đổi phe thắng là mọi
 * bảng đổi theo.
 *
 * - Số ván: `game_sessions.round_seq + 1`, cấp bằng MỘT câu UPDATE có điều kiện (khoá dòng buổi) nên hai
 *   lần thêm cùng lúc không trùng số; xoá ván cuối thì số đó không bị cấp lại, xoá ván giữa thì các ván
 *   khác giữ số (không đánh lại). Buổi đã huỷ → không thêm ván.
 * - Ảnh: PNG/JPG/WebP nhận diện theo nội dung (không tin content-type), tối đa 5 MB; lưu trong DB kèm
 *   `image_updated_at` (ETag và `?v=` của URL ảnh — đổi ảnh thì người đang xem tải ảnh mới).
 * - Sửa phe thắng / người thắng: người thắng phải là người đã khai role Phe thứ 3 ở ván đó (lần khai
 *   `pending`/`approved`); đặt phe khác neutral → xoá danh sách người thắng. Mùa của buổi đã chốt →
 *   `SEASON_CLOSED` (danh hiệu đã trao không được lệch với bảng). Ghi trong giao dịch khoá dòng `seasons`
 *   như duyệt/huỷ duyệt, rồi kiểm tra người hoá thân của mọi role có lần khai đã duyệt ở ván — đổi người
 *   thì đăng như khi duyệt (`announceIfLeaderChanged`, mỗi role một lần).
 * - Xoá ván: chỉ khi chưa có lần khai `pending`/`approved`; lần khai bị từ chối/huỷ duyệt của ván được gỡ
 *   `round_id` (giữ lịch sử, không tính điểm) rồi mới xoá. Lần khai chen vào đúng lúc xoá → khoá ngoại
 *   chặn (`ROUND_HAS_REPORTS`).
 */

import { Prisma } from '@prisma/client';
import type { Faction } from '@prisma/client';
import { z } from 'zod';
import type { ReportDto, RoundDto, RoundReportDto, SessionRoundsDto } from '../../../shared/api-types.js';
import { roundWon } from '../../../shared/rounds.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { dbToDateOnly, seasonIdOf, toVnDate } from '../../lib/time.js';
import { HOT_TX } from '../../lib/tx.js';
import { detectImageMime } from '../roles/image.js';
import type { ImageMime } from '../roles/image.js';
import { ensureSeason, isSeasonClosed } from '../seasons/service.js';
import { getRoleLeader } from '../stats/leaderboard.js';
import type { LeaderboardRow } from '../stats/leaderboard.js';
import { announceIfLeaderChanged, getReportDtos, isId, lockOpenSeason } from '../stats/reports.js';

/** 5 MiB — "Ảnh tối đa 5 MB" (spec ván §4). */
export const ROUND_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ROUND_IMAGE_TOO_LARGE_MESSAGE = 'Ảnh tối đa 5 MB';
export const ROUND_IMAGE_TYPE_MESSAGE = 'Chỉ nhận ảnh PNG, JPG hoặc WebP';
export const ROUND_WINNER_INVALID_MESSAGE = 'Người thắng phải là người đã khai role Phe thứ 3 ở ván này';
export const ROUND_WINNERS_NOT_NEUTRAL_MESSAGE = 'Chỉ chọn người thắng khi Phe thứ 3 thắng';
export const ROUND_SESSION_CANCELLED_MESSAGE = 'Buổi chơi đã bị huỷ';

const factionSchema = z.enum(['goose', 'duck', 'neutral']);
const patchSchema = z
  .object({
    winnerFaction: factionSchema.nullable().optional(),
    winnerIds: z.array(z.number().int().min(1).max(2_147_483_647)).max(50).optional(),
  })
  .strict();

/** Chuẩn hoá phe thắng gửi kèm khi thêm ván (`?winnerFaction=`); rỗng/vắng → null; sai → `VALIDATION`. */
export function parseWinnerFaction(raw: unknown): Faction | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = factionSchema.safeParse(raw);
  if (!parsed.success) throw appError('VALIDATION', 'Phe thắng không hợp lệ');
  return parsed.data;
}

/** Ảnh ván: quá 5 MB → "Ảnh tối đa 5 MB"; không phải PNG/JPG/WebP (kể cả rỗng) → "Chỉ nhận ảnh PNG, JPG hoặc WebP". */
export function checkRoundImage(buf: Buffer): ImageMime {
  if (buf.length > ROUND_IMAGE_MAX_BYTES) throw appError('INVALID_IMAGE', ROUND_IMAGE_TOO_LARGE_MESSAGE);
  const mime = detectImageMime(buf);
  if (mime === null) throw appError('INVALID_IMAGE', ROUND_IMAGE_TYPE_MESSAGE);
  return mime;
}

/** Xem `roles/image.ts`: Prisma 6 nhận Bytes là `Uint8Array` trên `ArrayBuffer` thường. */
function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const { buffer, byteOffset, byteLength } = buf;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer, byteOffset, byteLength);
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

const ROUND_SELECT = {
  id: true,
  sessionId: true,
  number: true,
  winnerFaction: true,
  imageUpdatedAt: true,
  winners: { select: { memberId: true }, orderBy: { memberId: 'asc' } },
  statReports: {
    // Chỉ lần khai còn hiệu lực do người chơi khai (spec ván §5); cũ trước.
    where: { source: 'self', status: { in: ['pending', 'approved'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      status: true,
      member: { select: { id: true, displayName: true, avatarUrl: true } },
      role: { select: { id: true, nameVi: true, icon: true, faction: true } },
    },
  },
} satisfies Prisma.GameRoundSelect;

type RoundRow = Prisma.GameRoundGetPayload<{ select: typeof ROUND_SELECT }>;

/** URL ảnh của ván — `?v=` đổi theo mỗi lần thay ảnh. */
export function roundImageUrl(id: number, imageUpdatedAt: Date): string {
  return `/api/rounds/${id}/image?v=${imageUpdatedAt.getTime()}`;
}

/** DTO các ván; lần khai của `viewerId` kèm đủ `ReportDto` (một lượt tra cho mọi ván). */
async function toRoundDtos(ctx: Ctx, rows: RoundRow[], viewerId: number): Promise<RoundDto[]> {
  const mineIds = rows.flatMap((r) => r.statReports.filter((s) => s.member.id === viewerId).map((s) => s.id));
  const mine = new Map<number, ReportDto>((await getReportDtos(ctx, mineIds)).map((d) => [d.id, d]));
  return rows.map((r) => {
    const winners = new Set(r.winners.map((w) => w.memberId));
    return {
      id: r.id,
      sessionId: r.sessionId,
      number: r.number,
      winnerFaction: r.winnerFaction,
      winnerIds: r.winners.map((w) => w.memberId),
      imageUrl: roundImageUrl(r.id, r.imageUpdatedAt),
      imageUpdatedAt: r.imageUpdatedAt.toISOString(),
      reports: r.statReports.map(
        (s): RoundReportDto => ({
          id: s.id,
          member: s.member,
          role: s.role,
          // Chỉ chọn hai trạng thái này ở `ROUND_SELECT`.
          status: s.status as 'pending' | 'approved',
          won: roundWon(s.role.faction, r.winnerFaction, winners.has(s.member.id)),
          mine: mine.get(s.id) ?? null,
        }),
      ),
    };
  });
}

/**
 * Trang buổi (`GET /api/sessions/:id/rounds`, mọi thành viên): buổi và các ván theo số tăng dần, mỗi ván
 * kèm lần khai công khai. Buổi không có → `NOT_FOUND`. Ba truy vấn cố định (buổi, ván + lần khai, lần khai
 * của người xem) cộng phần của `getReportDtos`.
 */
export async function listSessionRounds(ctx: Ctx, sessionId: number, viewerId: number): Promise<SessionRoundsDto> {
  const session = isId(sessionId)
    ? await ctx.db.gameSession.findUnique({
        where: { id: sessionId },
        select: { id: true, startsAt: true, status: true, mode: { select: { nameVi: true } } },
      })
    : null;
  if (!session) throw appError('NOT_FOUND');
  const rows = await ctx.db.gameRound.findMany({ where: { sessionId }, select: ROUND_SELECT, orderBy: { number: 'asc' } });
  return {
    session: { id: session.id, startsAt: session.startsAt.toISOString(), modeName: session.mode.nameVi, status: session.status },
    rounds: await toRoundDtos(ctx, rows, viewerId),
  };
}

/** Một ván dạng DTO (API trả về sau khi thêm/sửa/đổi ảnh); không có → `NOT_FOUND`. */
export async function getRoundDto(ctx: Ctx, roundId: number, viewerId: number): Promise<RoundDto> {
  const row = isId(roundId) ? await ctx.db.gameRound.findUnique({ where: { id: roundId }, select: ROUND_SELECT }) : null;
  if (!row) throw appError('NOT_FOUND');
  const [dto] = await toRoundDtos(ctx, [row], viewerId);
  return dto!;
}

/** Mốc đổi ảnh và mime của ván (không tải ảnh) — đủ để trả 304; không có → null. */
export async function getRoundImageMeta(ctx: Ctx, roundId: number): Promise<{ mime: string; updatedAt: Date } | null> {
  if (!isId(roundId)) return null;
  const row = await ctx.db.gameRound.findUnique({ where: { id: roundId }, select: { imageMime: true, imageUpdatedAt: true } });
  return row ? { mime: row.imageMime, updatedAt: row.imageUpdatedAt } : null;
}

/** Ảnh của ván kèm mime và mốc đổi ảnh; không có → null. */
export async function getRoundImage(ctx: Ctx, roundId: number): Promise<{ buf: Buffer; mime: string; updatedAt: Date } | null> {
  if (!isId(roundId)) return null;
  const row = await ctx.db.gameRound.findUnique({ where: { id: roundId }, select: { image: true, imageMime: true, imageUpdatedAt: true } });
  if (!row) return null;
  return { buf: Buffer.from(row.image.buffer, row.image.byteOffset, row.image.byteLength), mime: row.imageMime, updatedAt: row.imageUpdatedAt };
}

// ---------------------------------------------------------------------------
// Ghi (mod/admin — route đã `requireMod`)
// ---------------------------------------------------------------------------

/**
 * Thêm ván số tiếp theo cho buổi `sessionId` với ảnh `image` và phe thắng tuỳ chọn. Ảnh sai →
 * `INVALID_IMAGE` (câu của spec); buổi không có → `NOT_FOUND`; buổi đã huỷ → `SESSION_NOT_OPEN`
 * "Buổi chơi đã bị huỷ". Trả về DTO của ván mới.
 */
export async function createRound(ctx: Ctx, actorId: number, sessionId: number, image: Buffer, winnerFaction: Faction | null): Promise<RoundDto> {
  const mime = checkRoundImage(image);
  if (!isId(sessionId)) throw appError('NOT_FOUND');
  const id = await ctx.db.$transaction(async (tx) => {
    // Cấp số và khoá dòng buổi trong một câu: hai lần thêm cùng lúc xếp hàng, không trùng số.
    const [seq] = await tx.$queryRaw<{ round_seq: number }[]>`
      UPDATE game_sessions SET round_seq = round_seq + 1
      WHERE id = ${sessionId} AND status <> 'cancelled'
      RETURNING round_seq`;
    if (!seq) {
      const exists = await tx.gameSession.findUnique({ where: { id: sessionId }, select: { id: true } });
      throw exists ? appError('SESSION_NOT_OPEN', ROUND_SESSION_CANCELLED_MESSAGE) : appError('NOT_FOUND');
    }
    const round = await tx.gameRound.create({
      data: {
        sessionId,
        number: seq.round_seq,
        image: toBytes(image),
        imageMime: mime,
        imageUpdatedAt: ctx.now(),
        winnerFaction,
        createdById: actorId,
        createdAt: ctx.now(),
      },
      select: { id: true },
    });
    return round.id;
  });
  return getRoundDto(ctx, id, actorId);
}

/** Đổi ảnh của ván (`imageUpdatedAt = now`); ảnh sai → `INVALID_IMAGE`; ván không có → `NOT_FOUND`. */
export async function replaceRoundImage(ctx: Ctx, actorId: number, roundId: number, image: Buffer): Promise<RoundDto> {
  const mime = checkRoundImage(image);
  if (!isId(roundId)) throw appError('NOT_FOUND');
  const { count } = await ctx.db.gameRound.updateMany({
    where: { id: roundId },
    data: { image: toBytes(image), imageMime: mime, imageUpdatedAt: ctx.now() },
  });
  if (count === 0) throw appError('NOT_FOUND');
  return getRoundDto(ctx, roundId, actorId);
}

/**
 * Sửa phe thắng / người thắng (spec ván §4). `winnerFaction` vắng mặt giữ nguyên, `null` = chưa chọn.
 * `winnerIds` chỉ nhận khi phe thắng (sau khi sửa) là neutral (`VALIDATION` nếu không), thay toàn bộ danh
 * sách; vắng mặt thì giữ danh sách cũ khi vẫn là neutral. Phe thắng khác neutral → danh sách bị xoá. Mỗi
 * người thắng phải có lần khai `pending`/`approved` role Phe thứ 3 ở ván (`VALIDATION`). Mùa của buổi đã
 * chốt → `SEASON_CLOSED`. Sau khi lưu: role nào có lần khai đã duyệt ở ván mà đổi người hoá thân thì đăng
 * thông báo (mỗi role một lần; không đổi người → không đăng).
 */
export async function updateRound(ctx: Ctx, actorId: number, roundId: number, raw: unknown): Promise<RoundDto> {
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) throw appError('VALIDATION');
  const patch = parsed.data;

  const round = isId(roundId)
    ? await ctx.db.gameRound.findUnique({
        where: { id: roundId },
        select: { id: true, winnerFaction: true, session: { select: { startsAt: true } }, winners: { select: { memberId: true } } },
      })
    : null;
  if (!round) throw appError('NOT_FOUND');

  const faction = patch.winnerFaction === undefined ? round.winnerFaction : patch.winnerFaction;
  if (patch.winnerIds !== undefined && faction !== 'neutral') throw appError('VALIDATION', ROUND_WINNERS_NOT_NEUTRAL_MESSAGE);
  // Danh sách người thắng sau khi sửa: gửi mới → dùng; vẫn neutral → giữ; phe khác → rỗng.
  const winnerIds =
    faction !== 'neutral' ? [] : patch.winnerIds !== undefined ? [...new Set(patch.winnerIds)] : round.winners.map((w) => w.memberId);
  if (patch.winnerIds !== undefined && winnerIds.length > 0) {
    const eligible = await ctx.db.statReport.findMany({
      where: { roundId, source: 'self', status: { in: ['pending', 'approved'] }, memberId: { in: winnerIds }, role: { faction: 'neutral' } },
      select: { memberId: true },
    });
    const ok = new Set(eligible.map((e) => e.memberId));
    if (winnerIds.some((id) => !ok.has(id))) throw appError('VALIDATION', ROUND_WINNER_INVALID_MESSAGE);
  }

  const seasonId = seasonIdOf(toVnDate(round.session.startsAt));
  if (await isSeasonClosed(ctx, seasonId)) throw appError('SEASON_CLOSED');

  // Người hoá thân TRƯỚC khi đổi, của mọi role có lần khai đã duyệt ở ván (mỗi role một lần).
  const affected = await affectedRoles(ctx, roundId);
  const before = new Map<string, LeaderboardRow | null>();
  for (const a of affected) before.set(keyOf(a), await getRoleLeader(ctx, a.roleId, a.seasonId));

  await ensureSeason(ctx, seasonId);
  await ctx.db.$transaction(async (tx) => {
    await lockOpenSeason(tx, seasonId);
    // `select` hẹp: không kéo ảnh (tới 5 MB) về khi đang giữ khoá dòng mùa.
    await tx.gameRound.update({ where: { id: roundId }, data: { winnerFaction: faction }, select: { id: true } });
    await tx.gameRoundWinner.deleteMany({ where: { roundId } });
    if (winnerIds.length > 0) await tx.gameRoundWinner.createMany({ data: winnerIds.map((memberId) => ({ roundId, memberId })) });
  }, HOT_TX);

  for (const a of affected) await announceIfLeaderChanged(ctx, a.roleId, a.roleName, a.seasonId, before.get(keyOf(a)) ?? null);
  return getRoundDto(ctx, roundId, actorId);
}

type AffectedRole = { roleId: number; roleName: string; seasonId: string };

function keyOf(a: AffectedRole): string {
  return `${a.roleId}:${a.seasonId}`;
}

/** Các (role, mùa của ngày chơi) có lần khai đã duyệt ở ván — một truy vấn, đã bỏ trùng. */
async function affectedRoles(ctx: Ctx, roundId: number): Promise<AffectedRole[]> {
  const rows = await ctx.db.statReport.findMany({
    where: { roundId, status: 'approved' },
    select: { roleId: true, playedOn: true, role: { select: { nameVi: true } } },
    distinct: ['roleId', 'playedOn'],
  });
  const out = new Map<string, AffectedRole>();
  for (const r of rows) {
    const a = { roleId: r.roleId, roleName: r.role.nameVi, seasonId: seasonIdOf(dbToDateOnly(r.playedOn)) };
    out.set(keyOf(a), a);
  }
  return [...out.values()];
}

/**
 * Xoá ván (spec ván §4): còn lần khai `pending`/`approved` → `ROUND_HAS_REPORTS`; ván không có →
 * `NOT_FOUND`. Lần khai bị từ chối/huỷ duyệt của ván được gỡ `round_id` (giữ lịch sử) trong cùng giao
 * dịch; người thắng xoá theo (CASCADE). Số của ván không bị cấp lại (`round_seq` không lùi).
 */
export async function deleteRound(ctx: Ctx, roundId: number): Promise<void> {
  if (!isId(roundId)) throw appError('NOT_FOUND');
  try {
    await ctx.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM game_rounds WHERE id = ${roundId} FOR UPDATE`;
      if (locked.length === 0) throw appError('NOT_FOUND');
      const live = await tx.statReport.count({ where: { roundId, status: { in: ['pending', 'approved'] } } });
      if (live > 0) throw appError('ROUND_HAS_REPORTS');
      await tx.statReport.updateMany({ where: { roundId }, data: { roundId: null } });
      await tx.gameRound.delete({ where: { id: roundId }, select: { id: true } });
    });
  } catch (err) {
    // Lần khai mới chen vào đúng lúc xoá (đã ghi xong trước câu DELETE): khoá ngoại RESTRICT chặn.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw appError('ROUND_HAS_REPORTS');
    throw err;
  }
}
