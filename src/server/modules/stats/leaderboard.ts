/**
 * Bảng xếp hạng theo role, top mỗi phe và Đại sảnh hoá thân (spec §4.6, §4.7).
 *
 * Điểm của một người ở một role trong một mùa = tổng điểm các lần khai đã duyệt có ngày
 * chơi thuộc mùa đó — theo `playedOn`, không theo ngày duyệt, nên trận cuối tháng duyệt
 * đầu tháng sau vẫn tính cho mùa cũ. Điểm một lần khai = `(value × points + extraValue ×
 * extraPoints) × m − penaltyValue × penaltyPoints + bonusPoints` (spec điểm role §3; `m` = hệ số
 * của ngày chơi nếu là ngày nhân điểm, không thì 1 — spec ngày nhân điểm §3) theo điểm và hệ số
 * HIỆN TẠI: admin đổi điểm hay hệ số là bảng của mùa chưa chốt đổi theo; mùa đã chốt giữ
 * `role_titles.score`. `games` = số lần khai đã duyệt do chính người chơi khai (`source =
 * self`; mục trừ điểm do báo cáo không đếm). Xếp theo điểm giảm dần; hoà thì ai đạt mức
 * điểm đó trước (lần duyệt gần nhất sớm hơn) xếp trên; vẫn hoà thì theo id thành viên để
 * thứ tự luôn xác định. Hạng 1..n liên tiếp, không đồng hạng. Top mỗi phe (`getFactionTop`)
 * xếp các cặp (người, role) của cùng phe theo đúng điểm mùa đó (luật ×5 cũ đã bỏ — điểm
 * cao hơn của role bắn giờ nằm trong `points` của role), cùng cách phân hoà, thêm id role ở
 * cuối. Tổng điểm theo phe (`getFactionTotals`) cộng các cặp đó theo người cho từng phe và
 * cho cả ba phe.
 *
 * Treo thưởng (spec treo thưởng §4 "Điểm"): lần nhận `approved` có ngày chơi trong mùa cộng
 * `points` CHÉP trên lần nhận (sửa mục sau đó không đổi) vào ô (role chép trên lần nhận, người) —
 * nên có mặt ở mọi bảng dùng điểm mùa (bảng role, hoá thân, Đại sảnh, Top 3 mỗi phe, Tổng điểm
 * theo phe, chốt mùa) — nhưng KHÔNG tăng `games`. Lần nhận không có role chỉ cộng vào bảng tổng
 * "Cả 3 phe". Mốc phân hoà gồm cả `reviewedAt` của lần nhận.
 *
 * Báo cáo người chơi độc lập (spec 2026-10-31 §B): mỗi báo cáo `report_id IS NULL` ở trạng thái
 * `approved` có ngày chơi trong mùa cộng +1 cho người gửi — CHỈ vào bảng tổng "Cả 3 phe" (cùng đường
 * với lần nhận treo thưởng không role), mốc phân hoà là `reviewedAt` của báo cáo. Báo cáo cũ gắn lần
 * khai vẫn tính qua `bonusPoints` của lần khai.
 *
 * Chỉ người có điểm > 0 mới lên bảng (điểm mùa có thể âm khi bị trừ nhiều hơn được cộng):
 * role mà mọi lần khai đã duyệt gộp lại ≤ 0 thì chưa ai hoá thân (§4.7 chỉ lưu top 1 "có
 * điểm > 0"), và nhờ vậy `getRoleLeaderboard(...)[0]` luôn chính là người đang hoá thân
 * role đó. Người đã rời server vẫn giữ điểm và chỗ trên bảng
 * (không xoá lịch sử); tên và ảnh lấy từ dòng `members` hiện tại.
 *
 * Mọi hàm nhận `seasonId` dạng `YYYY-MM`; sai dạng → `VALIDATION`. `reports.ts` dùng
 * `getRoleLeader` + `announceHolderChange` khi duyệt; file này không import ngược lại.
 * `seasons/service.ts` dùng `computeSeasonLeaders` với client giao dịch khi chốt mùa (vòng
 * import hai chiều với file đó chỉ gồm lời gọi hàm lúc chạy, không dùng gì ở cấp module).
 */

import type { Faction, Prisma, PrismaClient } from '@prisma/client';
import type {
  FactionTopDto,
  FactionTopRowDto,
  FactionTotalRowDto,
  FactionTotalsDto,
  HallDto,
  HallHolderDto,
  HallPreviousDto,
  RoleDto,
  TotalsScope,
} from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { dateOnlyToDb, seasonDateRange } from '../../lib/time.js';
import { multiplierDaysInRange } from '../multipliers/service.js';
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
 * Điểm không gắn role của một người trong mùa (chỉ vào bảng tổng "Cả 3 phe"): treo thưởng không role
 * và +1 mỗi báo cáo người chơi độc lập được duyệt đúng.
 */
interface Unassigned {
  memberId: number;
  score: number;
  lastApprovedAt: Date;
}

/**
 * Gộp các lần khai đã duyệt có ngày chơi trong mùa theo (role, người) bằng MỘT truy vấn
 * GROUP BY theo (role, người, nguồn) — tổng `value`, `extraValue`, `penaltyValue`,
 * `bonusPoints`, số dòng và lần duyệt gần nhất; tách theo `source` để `games` chỉ đếm lần khai
 * `self` mà vẫn một truy vấn. `roleId` để thu hẹp về một role. Điểm ô = Σ value × points +
 * Σ extraValue × extraPoints − Σ penaltyValue × penaltyPoints + Σ bonusPoints theo điểm hiện
 * tại của role — thêm đúng một truy vấn lấy điểm của các role có ô (không có ô nào thì không
 * truy vấn). Ngày nhân điểm: `boostedPlus` cộng thêm (m − 1) × phần cộng (một truy vấn tra ngày nhân
 * của mùa, thêm một truy vấn gộp khi mùa có ngày nhân). Mặc định bỏ ô ≤ 0 điểm (chỉ người có
 * điểm > 0 lên bảng); `keepNonPositive` giữ
 * cả ô âm/0 cho nơi cần cộng dồn qua nhiều role rồi mới lọc (Tổng điểm theo phe — bị trừ ở
 * một role phải kéo tổng xuống). Trả về đã sắp theo thứ tự xếp hạng. Phần treo thưởng: xem
 * `aggregateSeasonCells`.
 */
async function aggregateSeason(db: DbClient, seasonId: string, roleId?: number, opts: { keepNonPositive?: boolean } = {}): Promise<Agg[]> {
  return (await aggregateSeasonCells(db, seasonId, roleId, opts)).cells;
}

/**
 * Như `aggregateSeason`, cộng thêm lần nhận treo thưởng đã duyệt của mùa — đúng MỘT truy vấn gộp
 * nữa (GROUP BY role, người trên `bounty_claims`): lần nhận có role cộng `points` vào ô (role,
 * người) mà không tăng `games` (ô chỉ có lần nhận vẫn được tạo, 0 trận); lần nhận không role trả
 * riêng trong `unassigned` theo người (chỉ bảng tổng "Cả 3 phe" dùng). Không có `roleId` thì thêm
 * MỘT truy vấn gộp báo cáo độc lập đã duyệt theo người gửi (+1 mỗi báo cáo, cũng vào `unassigned`).
 * Có `roleId` thì chỉ lấy lần nhận của role đó (`unassigned` rỗng).
 */
async function aggregateSeasonCells(
  db: DbClient,
  seasonId: string,
  roleId?: number,
  opts: { keepNonPositive?: boolean } = {},
): Promise<{ cells: Agg[]; unassigned: Unassigned[] }> {
  const { first, last } = seasonDateRange(seasonId);
  const playedOn = { gte: dateOnlyToDb(first), lte: dateOnlyToDb(last) };
  const claimGroups = await db.bountyClaim.groupBy({
    by: ['roleId', 'memberId'],
    where: { status: 'approved', ...(roleId === undefined ? {} : { roleId }), playedOn },
    _sum: { points: true },
    _max: { reviewedAt: true },
  });
  const groups = await db.statReport.groupBy({
    by: ['roleId', 'memberId', 'source'],
    where: {
      status: 'approved',
      ...(roleId === undefined ? {} : { roleId }),
      playedOn,
    },
    _sum: { value: true, extraValue: true, penaltyValue: true, bonusPoints: true },
    _count: { _all: true },
    _max: { reviewedAt: true },
  });
  const points = await pointsByRole(db, groups.map((g) => g.roleId));
  const boosted = await boostedPlus(db, first, last, roleId);

  // Ghép hai nguồn (self, accusation) của cùng một ô.
  const cells = new Map<string, Agg>();
  for (const g of groups) {
    const p = points.get(g.roleId);
    // Khoá ngoại đảm bảo role luôn có; phòng hờ dữ liệu lạ thì bỏ nhóm đó.
    if (!p) continue;
    // Role đã tắt chỉ số phụ/phạt (điểm null) mà lần khai còn giá trị: phần đó tính 0.
    const score =
      (g._sum.value ?? 0) * p.points +
      (g._sum.extraValue ?? 0) * (p.extraPoints ?? 0) -
      (g._sum.penaltyValue ?? 0) * (p.penaltyPoints ?? 0) +
      (g._sum.bonusPoints ?? 0);
    const games = g.source === 'self' ? g._count._all : 0;
    // Lần khai đã duyệt luôn có reviewedAt (reviewReport ghi cùng lúc); phòng hờ dữ liệu lạ.
    const lastApprovedAt = g._max.reviewedAt ?? new Date(0);
    const key = `${g.roleId}:${g.memberId}`;
    const cell = cells.get(key);
    if (!cell) cells.set(key, { roleId: g.roleId, memberId: g.memberId, score, games, lastApprovedAt });
    else {
      cell.score += score;
      cell.games += games;
      if (lastApprovedAt > cell.lastApprovedAt) cell.lastApprovedAt = lastApprovedAt;
    }
  }

  // Ngày nhân điểm: cộng thêm (m − 1) × phần cộng của các lần khai chơi ngày đó (điểm trừ, bonus không nhân).
  for (const b of boosted) {
    const p = points.get(b.roleId);
    const cell = cells.get(`${b.roleId}:${b.memberId}`);
    // Lần khai ngày nhân luôn nằm trong nhóm gộp ở trên (cùng điều kiện, hẹp hơn); phòng hờ.
    if (!p || !cell) continue;
    cell.score += (b.multiplier - 1) * (b.value * p.points + b.extraValue * (p.extraPoints ?? 0));
  }

  // Lần nhận treo thưởng: có role → cộng vào ô (không thêm trận); không role → riêng theo người.
  const unassigned: Unassigned[] = [];
  for (const g of claimGroups) {
    const score = g._sum.points ?? 0;
    // Lần nhận đã duyệt luôn có reviewedAt; phòng hờ dữ liệu lạ.
    const lastApprovedAt = g._max.reviewedAt ?? new Date(0);
    if (g.roleId === null) {
      if (roleId === undefined) unassigned.push({ memberId: g.memberId, score, lastApprovedAt });
      continue;
    }
    const key = `${g.roleId}:${g.memberId}`;
    const cell = cells.get(key);
    if (!cell) cells.set(key, { roleId: g.roleId, memberId: g.memberId, score, games: 0, lastApprovedAt });
    else {
      cell.score += score;
      if (lastApprovedAt > cell.lastApprovedAt) cell.lastApprovedAt = lastApprovedAt;
    }
  }

  // Báo cáo người chơi độc lập đúng: +1 mỗi báo cáo cho người gửi, không role.
  if (roleId === undefined) {
    const accusationGroups = await db.playerAccusation.groupBy({
      by: ['reporterId'],
      where: { reportId: null, status: 'approved', playedOn },
      _count: { _all: true },
      _max: { reviewedAt: true },
    });
    for (const g of accusationGroups) {
      unassigned.push({ memberId: g.reporterId, score: g._count._all, lastApprovedAt: g._max.reviewedAt ?? new Date(0) });
    }
  }

  const all = [...cells.values()];
  return { cells: (opts.keepNonPositive ? all : all.filter((g) => g.score > 0)).sort(compareAgg), unassigned };
}

/**
 * Tổng chỉ số chính/phụ của các lần khai đã duyệt chơi đúng ngày nhân điểm trong mùa, theo (role,
 * người, ngày), kèm hệ số HIỆN TẠI của ngày đó (spec ngày nhân điểm §3). Một truy vấn lấy các ngày
 * nhân của mùa; mùa có ngày nhân thì thêm đúng MỘT truy vấn gộp (không có thì không). Ngày nhân thuộc
 * mùa theo chính ngày đó, nên ngày 1 hay cuối tháng chỉ nhân lần khai của mùa chứa nó.
 */
async function boostedPlus(
  db: DbClient,
  first: string,
  last: string,
  roleId: number | undefined,
): Promise<{ roleId: number; memberId: number; multiplier: number; value: number; extraValue: number }[]> {
  const days = await multiplierDaysInRange(db, first, last);
  if (days.length === 0) return [];
  const byDay = new Map(days.map((d) => [d.day.getTime(), d.multiplier]));
  const groups = await db.statReport.groupBy({
    by: ['roleId', 'memberId', 'playedOn'],
    where: {
      status: 'approved',
      // Chỉ lần khai của chính người chơi — mục trừ điểm do báo cáo không có phần cộng để nhân
      // (khớp `toReportDto`).
      source: 'self',
      ...(roleId === undefined ? {} : { roleId }),
      playedOn: { in: days.map((d) => d.day) },
    },
    _sum: { value: true, extraValue: true },
  });
  return groups.map((g) => ({
    roleId: g.roleId,
    memberId: g.memberId,
    multiplier: byDay.get(g.playedOn.getTime()) ?? 1,
    value: g._sum.value ?? 0,
    extraValue: g._sum.extraValue ?? 0,
  }));
}

/** Điểm hiện tại của một role: điểm mỗi đơn vị chính, phụ (null nếu không có), phạt (null nếu không có). */
type RolePoints = { points: number; extraPoints: number | null; penaltyPoints: number | null };

/** Điểm hiện tại của các role được hỏi (một truy vấn); không có role nào thì không truy vấn. */
async function pointsByRole(db: DbClient, roleIds: number[]): Promise<Map<number, RolePoints>> {
  const ids = [...new Set(roleIds)];
  if (ids.length === 0) return new Map();
  const roles = await db.role.findMany({ where: { id: { in: ids } }, select: { id: true, points: true, extraPoints: true, penaltyPoints: true } });
  return new Map(roles.map((r) => [r.id, { points: r.points, extraPoints: r.extraPoints, penaltyPoints: r.penaltyPoints }]));
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

const FACTIONS: readonly Faction[] = ['goose', 'duck', 'neutral'];

/** Một ô (role, người) đã gộp, kèm phần role của dòng top phe — để xếp hạng trong phe. */
interface FactionAgg extends Agg {
  role: FactionTopRowDto['role'];
}

/** Điểm giảm dần → đạt trước xếp trên → id thành viên nhỏ trước → id role nhỏ trước. */
function compareFactionAgg(x: FactionAgg, y: FactionAgg): number {
  return y.score - x.score || x.lastApprovedAt.getTime() - y.lastApprovedAt.getTime() || x.memberId - y.memberId || x.roleId - y.roleId;
}

/**
 * Mọi ô (người, role) của mùa kèm phần role, chia theo phe của role — phần gộp dùng chung của
 * "Top mỗi phe" (chỉ ô điểm > 0) và "Tổng điểm theo phe" (`keepNonPositive`: giữ cả ô âm/0 để
 * cộng dồn). Điểm xếp hạng là đúng điểm mùa của ô (không còn hệ số ×5). Mọi role tính cho phe
 * của chính nó, kể cả role chế độ đặc biệt và role đã tắt (lịch sử). Đúng một truy vấn gộp lần
 * khai và một truy vấn gộp lần nhận treo thưởng (`aggregateSeasonCells` không lọc role) cộng
 * một truy vấn lấy role của các ô. Kèm `unassigned`: điểm treo thưởng không role theo người.
 * Mỗi phe đã sắp theo `compareFactionAgg`.
 */
async function aggsByFaction(
  db: DbClient,
  seasonId: string,
  opts: { keepNonPositive?: boolean } = {},
): Promise<{ perFaction: Record<Faction, FactionAgg[]>; unassigned: Unassigned[] }> {
  const { cells: aggs, unassigned } = await aggregateSeasonCells(db, seasonId, undefined, opts);
  const roles = await db.role.findMany({
    where: { id: { in: [...new Set(aggs.map((x) => x.roleId))] } },
    select: {
      id: true,
      faction: true,
      nameVi: true,
      icon: true,
      metricLabel: true,
      points: true,
      extraMetricLabel: true,
      extraPoints: true,
      penaltyMetricLabel: true,
      penaltyMaxPerGame: true,
      penaltyPoints: true,
    },
  });
  const roleById = new Map(roles.map((r) => [r.id, r]));

  const perFaction: Record<Faction, FactionAgg[]> = { goose: [], duck: [], neutral: [] };
  for (const agg of aggs) {
    // Khoá ngoại đảm bảo role luôn có; phòng hờ dữ liệu lạ thì bỏ ô đó.
    const role = roleById.get(agg.roleId);
    if (!role) continue;
    perFaction[role.faction].push({
      ...agg,
      role: {
        id: role.id,
        nameVi: role.nameVi,
        icon: role.icon,
        metricLabel: role.metricLabel,
        points: role.points,
        extraMetricLabel: role.extraMetricLabel,
        extraPoints: role.extraPoints,
        penaltyMetricLabel: role.penaltyMetricLabel,
        penaltyMaxPerGame: role.penaltyMaxPerGame,
        penaltyPoints: role.penaltyPoints,
        faction: role.faction,
      },
    });
  }
  for (const faction of FACTIONS) perFaction[faction].sort(compareFactionAgg);
  return { perFaction, unassigned };
}

/**
 * Top `limit` của mỗi phe trong một mùa (mặc định 3, tối đa 100 — lớn hơn bị cắt; không
 * nguyên hoặc < 1 → `VALIDATION`). Mỗi dòng là một cặp (người, role) có điểm mùa > 0; `value`
 * và `points` của dòng đều là điểm mùa đó (đã gồm chỉ số phụ, phạt, bonus); một người có thể
 * có nhiều dòng trong cùng phe. Phe và truy vấn: xem `aggsByFaction`.
 */
export async function getFactionTop(ctx: Ctx, seasonId: string, limit = 3): Promise<FactionTopDto> {
  checkSeasonId(seasonId);
  if (!Number.isInteger(limit) || limit < 1) throw appError('VALIDATION', 'Giới hạn không hợp lệ');
  const take = Math.min(limit, MAX_LIMIT);

  const { perFaction } = await aggsByFaction(ctx.db, seasonId);
  for (const faction of FACTIONS) perFaction[faction] = perFaction[faction].slice(0, take);

  const shown = FACTIONS.flatMap((faction) => perFaction[faction]);
  const members = await membersById(ctx.db, [...new Set(shown.map((x) => x.memberId))]);
  const toFactionRow = (x: FactionAgg, i: number): FactionTopRowDto => {
    const m = members.get(x.memberId);
    return {
      rank: i + 1,
      memberId: x.memberId,
      displayName: m?.displayName ?? '',
      avatarUrl: m?.avatarUrl ?? null,
      role: x.role,
      value: x.score,
      points: x.score,
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
// Tổng điểm theo phe
// ---------------------------------------------------------------------------

/** Số dòng đầu của mỗi bảng tổng điểm. */
const TOTALS_TOP = 20;

const TOTALS_SCOPES: readonly TotalsScope[] = ['all', ...FACTIONS];

/** Tổng điểm mùa của một người trong một bảng, kèm mốc phân hoà. */
interface Total {
  memberId: number;
  points: number;
  /** Lần duyệt gần nhất trong các cặp được cộng — người đạt mức điểm đó sau xếp dưới. */
  lastApprovedAt: Date;
}

/** Điểm giảm dần → đạt trước xếp trên → id thành viên nhỏ trước. */
function compareTotal(x: Total, y: Total): number {
  return y.points - x.points || x.lastApprovedAt.getTime() - y.lastApprovedAt.getTime() || x.memberId - y.memberId;
}

/**
 * Cộng các ô theo người (bỏ qua role), kể cả ô âm/0 — bị trừ ở một role kéo tổng xuống; chỉ giữ
 * người có tổng > 0, xếp theo `compareTotal`.
 */
function sumByMember(aggs: readonly Pick<Agg, 'memberId' | 'score' | 'lastApprovedAt'>[]): Total[] {
  const totals = new Map<number, Total>();
  for (const agg of aggs) {
    const t = totals.get(agg.memberId);
    if (!t) totals.set(agg.memberId, { memberId: agg.memberId, points: agg.score, lastApprovedAt: agg.lastApprovedAt });
    else {
      t.points += agg.score;
      if (agg.lastApprovedAt > t.lastApprovedAt) t.lastApprovedAt = agg.lastApprovedAt;
    }
  }
  return [...totals.values()]
    .filter((t) => t.points > 0)
    .sort(compareTotal);
}

/**
 * Tổng điểm theo phe của một mùa cho người xem `viewerId`: bốn bảng ("Cả 3 phe" và từng
 * phe), điểm của một người trong bảng = tổng điểm mùa của MỌI cặp (người, role) thuộc phe
 * đó, kể cả cặp âm/0 (bị trừ ở một role kéo tổng xuống — khác "Top 3 mỗi phe" chỉ xếp cặp
 * > 0; role tính cho phe của chính nó). Chỉ người có TỔNG > 0; xếp điểm giảm dần → lần duyệt
 * gần nhất (trong các cặp được cộng) sớm hơn xếp
 * trên → id nhỏ trước; hạng 1..n. Mỗi bảng trả `TOTALS_TOP` dòng đầu và `me` — dòng của người
 * xem nếu họ có điểm ở bảng đó (kể cả đã trong top), không thì `null`. Đúng một truy vấn gộp
 * lần khai và một truy vấn gộp lần nhận treo thưởng (`aggsByFaction`); "Cả 3 phe" cộng thêm điểm
 * treo thưởng không gắn role.
 */
export async function getFactionTotals(ctx: Ctx, seasonId: string, viewerId: number): Promise<FactionTotalsDto> {
  checkSeasonId(seasonId);
  const { perFaction, unassigned } = await aggsByFaction(ctx.db, seasonId, { keepNonPositive: true });
  const ranked: Record<TotalsScope, Total[]> = {
    // "Cả 3 phe" cộng thêm điểm treo thưởng không gắn role.
    all: sumByMember([...FACTIONS.flatMap((faction) => perFaction[faction]), ...unassigned]),
    goose: sumByMember(perFaction.goose),
    duck: sumByMember(perFaction.duck),
    neutral: sumByMember(perFaction.neutral),
  };

  // Một truy vấn tên/ảnh cho mọi dòng sẽ hiện (top bốn bảng + dòng của người xem).
  const shownIds = new Set<number>();
  for (const scope of TOTALS_SCOPES) {
    for (const t of ranked[scope].slice(0, TOTALS_TOP)) shownIds.add(t.memberId);
    if (ranked[scope].some((t) => t.memberId === viewerId)) shownIds.add(viewerId);
  }
  const members = await membersById(ctx.db, [...shownIds]);
  const toTotalRow = (t: Total, index: number): FactionTotalRowDto => {
    const m = members.get(t.memberId);
    return { rank: index + 1, memberId: t.memberId, displayName: m?.displayName ?? '', avatarUrl: m?.avatarUrl ?? null, points: t.points };
  };
  const board = (totals: Total[]): FactionTotalsDto['boards'][TotalsScope] => {
    const mine = totals.findIndex((t) => t.memberId === viewerId);
    return {
      top: totals.slice(0, TOTALS_TOP).map(toTotalRow),
      me: mine === -1 ? null : toTotalRow(totals[mine] as Total, mine),
    };
  };
  return {
    seasonId,
    boards: { all: board(ranked.all), goose: board(ranked.goose), duck: board(ranked.duck), neutral: board(ranked.neutral) },
  };
}

/** Bảng tổng điểm đầy đủ của từng phe (người có tổng > 0) — đúng thứ tự `getFactionTotals`. */
export async function getFactionTotalBoards(ctx: Ctx, seasonId: string): Promise<Record<Faction, { memberId: number; points: number }[]>> {
  checkSeasonId(seasonId);
  const { perFaction } = await aggsByFaction(ctx.db, seasonId, { keepNonPositive: true });
  const board = (faction: Faction) => sumByMember(perFaction[faction]).map(({ memberId, points }) => ({ memberId, points }));
  return { goose: board('goose'), duck: board('duck'), neutral: board('neutral') };
}

// ---------------------------------------------------------------------------
// Đại sảnh hoá thân
// ---------------------------------------------------------------------------

/**
 * Đại sảnh một mùa: mọi role đang bật theo thứ tự danh mục. Mùa đã chốt lấy người giữ
 * từ `role_titles`; mùa đang mở (hoặc chưa có dòng `seasons`) tính trực tiếp — đúng một
 * truy vấn gộp lần khai (và một gộp lần nhận treo thưởng). Role chưa ai hoá thân kèm `previous`: người giữ ở mùa ĐÃ CHỐT
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
