/**
 * Bảng xếp hạng theo role, top mỗi phe và Đại sảnh hoá thân (spec §4.6, §4.7).
 *
 * Điểm của một người ở một role trong một mùa = tổng giá trị các lần khai đã duyệt có
 * ngày chơi thuộc mùa đó — theo `playedOn`, không theo ngày duyệt, nên trận cuối tháng
 * duyệt đầu tháng sau vẫn tính cho mùa cũ. `games` = số lần khai đã duyệt. Xếp theo điểm
 * giảm dần; hoà thì ai đạt mức điểm đó trước (lần duyệt gần nhất sớm hơn) xếp trên; vẫn
 * hoà thì theo id thành viên để thứ tự luôn xác định. Hạng 1..n liên tiếp, không đồng hạng.
 * Top mỗi phe (`getFactionTop`) xếp các cặp (người, role) của cùng phe theo điểm × hệ số
 * của role (`rolePointWeight`), cùng cách phân hoà, thêm id role ở cuối.
 *
 * Chỉ người có điểm > 0 mới lên bảng: role mà mọi lần khai đã duyệt đều 0 thì chưa ai hoá
 * thân (§4.7 chỉ lưu top 1 "có điểm > 0"), và nhờ vậy `getRoleLeaderboard(...)[0]` luôn
 * chính là người đang hoá thân role đó. Người đã rời server vẫn giữ điểm và chỗ trên bảng
 * (không xoá lịch sử); tên và ảnh lấy từ dòng `members` hiện tại.
 *
 * Mọi hàm nhận `seasonId` dạng `YYYY-MM`; sai dạng → `VALIDATION`. `reports.ts` dùng
 * `getRoleLeader` + `announceHolderChange` khi duyệt; file này không import ngược lại.
 * `seasons/service.ts` dùng `computeSeasonLeaders` với client giao dịch khi chốt mùa (vòng
 * import hai chiều với file đó chỉ gồm lời gọi hàm lúc chạy, không dùng gì ở cấp module).
 */

import type { Faction, Prisma, PrismaClient } from '@prisma/client';
import type { FactionTopDto, FactionTopRowDto, HallDto, HallHolderDto, HallPreviousDto, RoleDto } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { dateOnlyToDb, seasonDateRange } from '../../lib/time.js';
import { listRoles } from '../roles/service.js';
import { checkSeasonId, isSeasonClosed } from '../seasons/service.js';

/** Client thường hoặc client trong giao dịch — phần gộp điểm chạy được với cả hai. */
type DbClient = PrismaClient | Prisma.TransactionClient;

export interface LeaderboardRow {
  rank: number;
  memberId: number;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  games: number;
  /** Lần duyệt gần nhất của người này ở role trong mùa — mốc phân hoà. */
  lastApprovedAt: Date;
}

const DEFAULT_LIMIT = 10;
/** Giới hạn trên của `limit`; lớn hơn bị cắt (như `listMyReports`). */
const MAX_LIMIT = 100;
const INT32_MAX = 2_147_483_647;

/** Id hợp lệ để tra DB; id lạ (lẻ, âm, quá int32) coi như không có. */
function isId(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= INT32_MAX;
}

// ---------------------------------------------------------------------------
// Gộp điểm
// ---------------------------------------------------------------------------

/** Một ô (role, người) đã gộp từ các lần khai đã duyệt trong mùa. */
interface Agg {
  roleId: number;
  memberId: number;
  score: number;
  games: number;
  lastApprovedAt: Date;
}

/** Điểm giảm dần → đạt trước xếp trên → id nhỏ trước. */
function compareAgg(x: Agg, y: Agg): number {
  return y.score - x.score || x.lastApprovedAt.getTime() - y.lastApprovedAt.getTime() || x.memberId - y.memberId;
}

/**
 * Gộp các lần khai đã duyệt có ngày chơi trong mùa theo (role, người) bằng MỘT truy vấn
 * GROUP BY; `roleId` để thu hẹp về một role. Bỏ ô 0 điểm; trả về đã sắp theo thứ tự xếp hạng.
 */
async function aggregateSeason(db: DbClient, seasonId: string, roleId?: number): Promise<Agg[]> {
  const { first, last } = seasonDateRange(seasonId);
  const groups = await db.statReport.groupBy({
    by: ['roleId', 'memberId'],
    where: {
      status: 'approved',
      ...(roleId === undefined ? {} : { roleId }),
      playedOn: { gte: dateOnlyToDb(first), lte: dateOnlyToDb(last) },
    },
    _sum: { value: true },
    _count: { _all: true },
    _max: { reviewedAt: true },
  });
  return groups
    .map((g) => ({
      roleId: g.roleId,
      memberId: g.memberId,
      score: g._sum.value ?? 0,
      games: g._count._all,
      // Lần khai đã duyệt luôn có reviewedAt (reviewReport ghi cùng lúc); phòng hờ dữ liệu lạ.
      lastApprovedAt: g._max.reviewedAt ?? new Date(0),
    }))
    .filter((g) => g.score > 0)
    .sort(compareAgg);
}

type MemberInfo = { displayName: string; avatarUrl: string | null };

/** Tên và ảnh của các thành viên — một truy vấn cho cả bảng, không tra từng người. */
async function membersById(db: DbClient, ids: number[]): Promise<Map<number, MemberInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await db.member.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true, avatarUrl: true },
  });
  return new Map(rows.map((m) => [m.id, { displayName: m.displayName, avatarUrl: m.avatarUrl }]));
}

function toRow(agg: Agg, rank: number, members: Map<number, MemberInfo>): LeaderboardRow {
  // Khoá ngoại đảm bảo luôn có dòng members (không xoá cứng thành viên).
  const m = members.get(agg.memberId);
  return {
    rank,
    memberId: agg.memberId,
    displayName: m?.displayName ?? '',
    avatarUrl: m?.avatarUrl ?? null,
    score: agg.score,
    games: agg.games,
    lastApprovedAt: agg.lastApprovedAt,
  };
}

// ---------------------------------------------------------------------------
// Bảng xếp hạng
// ---------------------------------------------------------------------------

/**
 * Top `limit` của một role trong một mùa (mặc định 10, tối đa 100 — lớn hơn bị cắt;
 * không nguyên hoặc < 1 → `VALIDATION`). Role không có → `NOT_FOUND`; role đang tắt vẫn
 * xem được (lịch sử).
 */
export async function getRoleLeaderboard(ctx: Ctx, roleId: number, seasonId: string, limit = DEFAULT_LIMIT): Promise<LeaderboardRow[]> {
  checkSeasonId(seasonId);
  if (!Number.isInteger(limit) || limit < 1) throw appError('VALIDATION', 'Giới hạn không hợp lệ');
  const role = isId(roleId) ? await ctx.db.role.findUnique({ where: { id: roleId }, select: { id: true } }) : null;
  if (!role) throw appError('NOT_FOUND');

  const aggs = (await aggregateSeason(ctx.db, seasonId, roleId)).slice(0, Math.min(limit, MAX_LIMIT));
  const members = await membersById(ctx.db, aggs.map((x) => x.memberId));
  return aggs.map((x, i) => toRow(x, i + 1, members));
}

/** Người đang hoá thân (top 1, điểm > 0) của một role trong một mùa; chưa ai → `null`. */
export async function getRoleLeader(ctx: Ctx, roleId: number, seasonId: string): Promise<LeaderboardRow | null> {
  checkSeasonId(seasonId);
  const [top] = await aggregateSeason(ctx.db, seasonId, roleId);
  if (!top) return null;
  return toRow(top, 1, await membersById(ctx.db, [top.memberId]));
}

/** Top 1 của mọi role có người trong mùa, từ một truy vấn gộp: roleId → dòng hạng 1. */
export async function getSeasonLeaders(ctx: Ctx, seasonId: string): Promise<Map<number, LeaderboardRow>> {
  checkSeasonId(seasonId);
  return computeSeasonLeaders(ctx.db, seasonId);
}

/**
 * Phần tính của `getSeasonLeaders`, nhận thẳng client DB để chốt mùa gọi được trong cùng
 * giao dịch với việc ghi `role_titles`. Không kiểm tra `seasonId` (người gọi đã kiểm tra).
 */
export async function computeSeasonLeaders(db: DbClient, seasonId: string): Promise<Map<number, LeaderboardRow>> {
  // Đã sắp theo thứ tự xếp hạng chung, nên ô đầu tiên gặp của mỗi role là top 1 của role đó.
  const tops = new Map<number, Agg>();
  for (const agg of await aggregateSeason(db, seasonId)) {
    if (!tops.has(agg.roleId)) tops.set(agg.roleId, agg);
  }
  const members = await membersById(db, [...tops.values()].map((x) => x.memberId));
  return new Map([...tops].map(([roleId, agg]) => [roleId, toRow(agg, 1, members)]));
}

/** Các role đang bật mà người này đang hoá thân trong mùa, theo thứ tự danh mục. */
export async function getHeldRoles(ctx: Ctx, memberId: number, seasonId: string): Promise<{ role: RoleDto; score: number }[]> {
  checkSeasonId(seasonId);
  const roles = await listRoles(ctx);
  const leaders = await getSeasonLeaders(ctx, seasonId);
  return roles.flatMap((role) => {
    const leader = leaders.get(role.id);
    return leader && leader.memberId === memberId ? [{ role, score: leader.score }] : [];
  });
}

// ---------------------------------------------------------------------------
// Top mỗi phe
// ---------------------------------------------------------------------------

/** Hệ số điểm của role tối đa 1 mỗi trận (Dân phòng, Vệ sĩ, Chim đa đa…). */
const SINGLE_PER_GAME_WEIGHT = 5;

/**
 * Hệ số nhân điểm của một role khi xếp hạng chung trong phe: role chỉ ghi được tối đa 1
 * mỗi trận (`maxPerGame === 1`) nhân 5, còn lại nhân 1 — để một phát bắn trúng của Dân
 * phòng không thua một mạng chém của Kiếm sĩ. Quy tắc đi theo `maxPerGame` nên admin đổi
 * giới hạn của role là hệ số đổi theo. Đây là nơi DUY NHẤT định nghĩa hệ số.
 */
export function rolePointWeight(role: { maxPerGame: number }): number {
  return role.maxPerGame === 1 ? SINGLE_PER_GAME_WEIGHT : 1;
}

const FACTIONS: readonly Faction[] = ['goose', 'duck', 'neutral'];

/** Một ô (role, người) đã gộp, kèm role và điểm có hệ số — để xếp hạng trong phe. */
interface WeightedAgg extends Agg {
  role: FactionTopRowDto['role'];
  weight: number;
  points: number;
}

/** Điểm có hệ số giảm dần → đạt trước xếp trên → id thành viên nhỏ trước → id role nhỏ trước. */
function compareWeighted(x: WeightedAgg, y: WeightedAgg): number {
  return y.points - x.points || x.lastApprovedAt.getTime() - y.lastApprovedAt.getTime() || x.memberId - y.memberId || x.roleId - y.roleId;
}

/**
 * Top `limit` của mỗi phe trong một mùa (mặc định 3, tối đa 100 — lớn hơn bị cắt; không
 * nguyên hoặc < 1 → `VALIDATION`). Mỗi dòng là một cặp (người, role) có điểm thô > 0, điểm
 * xếp hạng = tổng giá trị thô × `rolePointWeight(role)`; một người có thể có nhiều dòng
 * trong cùng phe. Mọi role tính cho phe của chính nó, kể cả role chế độ đặc biệt và role
 * đã tắt (lịch sử). Đúng một truy vấn gộp lần khai (`aggregateSeason` không lọc role).
 */
export async function getFactionTop(ctx: Ctx, seasonId: string, limit = 3): Promise<FactionTopDto> {
  checkSeasonId(seasonId);
  if (!Number.isInteger(limit) || limit < 1) throw appError('VALIDATION', 'Giới hạn không hợp lệ');
  const take = Math.min(limit, MAX_LIMIT);

  const aggs = await aggregateSeason(ctx.db, seasonId);
  const roles = await ctx.db.role.findMany({
    where: { id: { in: [...new Set(aggs.map((x) => x.roleId))] } },
    select: { id: true, faction: true, maxPerGame: true, nameVi: true, icon: true, metricLabel: true },
  });
  const roleById = new Map(roles.map((r) => [r.id, r]));

  const perFaction: Record<Faction, WeightedAgg[]> = { goose: [], duck: [], neutral: [] };
  for (const agg of aggs) {
    // Khoá ngoại đảm bảo role luôn có; phòng hờ dữ liệu lạ thì bỏ ô đó.
    const role = roleById.get(agg.roleId);
    if (!role) continue;
    const weight = rolePointWeight(role);
    perFaction[role.faction].push({
      ...agg,
      role: { id: role.id, nameVi: role.nameVi, icon: role.icon, metricLabel: role.metricLabel, faction: role.faction },
      weight,
      points: agg.score * weight,
    });
  }
  for (const faction of FACTIONS) perFaction[faction] = perFaction[faction].sort(compareWeighted).slice(0, take);

  const shown = FACTIONS.flatMap((faction) => perFaction[faction]);
  const members = await membersById(ctx.db, [...new Set(shown.map((x) => x.memberId))]);
  const toFactionRow = (x: WeightedAgg, i: number): FactionTopRowDto => {
    const m = members.get(x.memberId);
    return {
      rank: i + 1,
      memberId: x.memberId,
      displayName: m?.displayName ?? '',
      avatarUrl: m?.avatarUrl ?? null,
      role: x.role,
      value: x.score,
      weight: x.weight,
      points: x.points,
      games: x.games,
    };
  };
  return {
    seasonId,
    factions: {
      goose: perFaction.goose.map(toFactionRow),
      duck: perFaction.duck.map(toFactionRow),
      neutral: perFaction.neutral.map(toFactionRow),
    },
  };
}

// ---------------------------------------------------------------------------
// Đại sảnh hoá thân
// ---------------------------------------------------------------------------

/**
 * Đại sảnh một mùa: mọi role đang bật theo thứ tự danh mục. Mùa đã chốt lấy người giữ
 * từ `role_titles`; mùa đang mở (hoặc chưa có dòng `seasons`) tính trực tiếp — đúng một
 * truy vấn gộp lần khai. Role chưa ai hoá thân kèm `previous`: người giữ ở mùa ĐÃ CHỐT
 * gần nhất trước mùa này có kết quả cho role đó (không có → `null`).
 */
export async function getHall(ctx: Ctx, seasonId: string): Promise<HallDto> {
  checkSeasonId(seasonId);
  const roles = await listRoles(ctx);
  const closed = await isSeasonClosed(ctx, seasonId);
  const holders = closed ? await titledHolders(ctx, seasonId) : await liveHolders(ctx, seasonId);
  const previous = await previousHolders(
    ctx,
    seasonId,
    roles.filter((r) => !holders.has(r.id)).map((r) => r.id),
  );
  return {
    seasonId,
    closed,
    roles: roles.map((role) => ({ role, holder: holders.get(role.id) ?? null, previous: previous.get(role.id) ?? null })),
  };
}

/** Người giữ từng role theo kết quả chốt mùa (`role_titles`). */
async function titledHolders(ctx: Ctx, seasonId: string): Promise<Map<number, HallHolderDto>> {
  const titles = await ctx.db.roleTitle.findMany({
    where: { seasonId },
    select: { roleId: true, memberId: true, score: true, member: { select: { displayName: true } } },
  });
  return new Map(titles.map((t) => [t.roleId, { memberId: t.memberId, displayName: t.member.displayName, score: t.score }]));
}

/** Người đang dẫn đầu từng role, tính trực tiếp từ lần khai đã duyệt. */
async function liveHolders(ctx: Ctx, seasonId: string): Promise<Map<number, HallHolderDto>> {
  const leaders = await getSeasonLeaders(ctx, seasonId);
  return new Map([...leaders].map(([roleId, l]) => [roleId, { memberId: l.memberId, displayName: l.displayName, score: l.score }]));
}

/**
 * Với các role được hỏi: kết quả ở mùa đã chốt gần nhất có mã nhỏ hơn `seasonId` (mã
 * `YYYY-MM` so chuỗi đúng bằng so thời gian). Mùa chưa chốt bị bỏ qua dù có dòng.
 */
async function previousHolders(ctx: Ctx, seasonId: string, roleIds: number[]): Promise<Map<number, HallPreviousDto>> {
  if (roleIds.length === 0) return new Map();
  const titles = await ctx.db.roleTitle.findMany({
    where: { roleId: { in: roleIds }, seasonId: { lt: seasonId }, season: { closedAt: { not: null } } },
    select: { seasonId: true, roleId: true, memberId: true, score: true, member: { select: { displayName: true } } },
    orderBy: [{ seasonId: 'desc' }],
    distinct: ['roleId'], // dòng đầu tiên theo thứ tự trên = mùa gần nhất của mỗi role
  });
  return new Map(
    titles.map((t) => [t.roleId, { memberId: t.memberId, displayName: t.member.displayName, score: t.score, seasonId: t.seasonId }]),
  );
}

// ---------------------------------------------------------------------------
// Thông báo đổi người hoá thân
// ---------------------------------------------------------------------------

/**
 * Đăng "👑 … đã hoá thân …" vào kênh thông báo. Discord lỗi chỉ ghi log, không ném —
 * lần duyệt đã lưu rồi, và không đăng bù (bảng xếp hạng trên web vẫn đúng).
 */
export async function announceHolderChange(ctx: Ctx, displayName: string, roleNameVi: string, seasonId: string): Promise<void> {
  try {
    await ctx.notifier.announce(`👑 ${displayName} đã hoá thân ${roleNameVi} mùa ${seasonId}!`);
  } catch (err) {
    console.error(`[stats] Không đăng được thông báo hoá thân ${roleNameVi} mùa ${seasonId}: ${messageOf(err)}`);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
