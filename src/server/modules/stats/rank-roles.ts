/**
 * Role Discord "Top 1–3" của mỗi phe (Ngỗng, Vịt, Phe thứ 3), theo bảng "Tổng điểm theo phe"
 * của mùa đang diễn ra — đúng thứ hạng web hiện. Bộ hẹn giờ gọi `syncRankRoles` mỗi lượt:
 * role chưa có thì bot tự tạo (ID lưu ở `app_settings` để admin đổi tên/màu role vẫn giữ được),
 * rồi gắn cho người đang giữ hạng và gỡ khỏi mọi người khác — kể cả role ai đó tự gắn tay.
 * Chỉ gọi Discord khi có thay đổi, nên chạy lại bao nhiêu lần cũng vậy.
 *
 * Mỗi người mang tối đa MỘT role — thành tích tốt nhất (xem `assignRanks`); chỗ họ nhường ở
 * phe khác và chỗ của người đã rời hội được đôn người kế tiếp lên, nên mỗi phe vẫn đủ 3 role.
 *
 * Bot thiếu quyền (chưa có Manage Roles, hay role của bot nằm dưới các role này) thì chỉ ghi
 * một cảnh báo cho tới khi đồng bộ lại được, không báo lỗi mỗi phút.
 */

import type { Faction } from '@prisma/client';
import type { Ctx } from '../../ctx.js';
import { seasonIdOf, toVnDate } from '../../lib/time.js';
import { RankRolePermissionError } from '../../ports.js';
import type { RankRoleSpec } from '../../ports.js';
import { getFactionTotalBoards } from './leaderboard.js';

const FACTIONS: readonly Faction[] = ['goose', 'duck', 'neutral'];

/** Số hạng có role riêng ở mỗi phe. */
export const RANK_ROLE_TOP = 3;

const FACTION_NAME: Record<Faction, string> = { goose: '🪿 Top {n} Ngỗng', duck: '🦆 Top {n} Vịt', neutral: '🐦 Top {n} Phe thứ 3' };

/** Màu theo hạng 1, 2, 3: màu phe (như web) nhạt dần. */
const FACTION_COLORS: Record<Faction, readonly [number, number, number]> = {
  goose: [0x2f80ed, 0x7cb8ff, 0xb3d4ff],
  duck: [0xe5484d, 0xff8a8f, 0xffbdc0],
  neutral: [0x8e4ec6, 0xc9a2f2, 0xe2cff8],
};

/** Role của hạng `rank` (1-based) trong phe; chỉ Top 1 hiện tách nhóm trong danh sách thành viên. */
export function rankRoleSpec(faction: Faction, rank: number): RankRoleSpec {
  return {
    name: FACTION_NAME[faction].replace('{n}', String(rank)),
    color: FACTION_COLORS[faction][rank - 1] ?? FACTION_COLORS[faction][2],
    hoist: rank === 1,
  };
}

/** Khoá `app_settings` giữ ID role Discord của một hạng. */
function settingKey(faction: Faction, rank: number): string {
  return `rank_role_${faction}_${rank}`;
}

/**
 * Người giữ từng hạng của mỗi phe (`undefined` = bỏ trống vì phe hết người), mỗi người tối đa một
 * hạng. Xét lần lượt hạng 1, 2, 3: ở mỗi hạng, ứng viên của một phe là người đầu bảng phe đó chưa
 * nhận hạng nào. Một người là ứng viên ở nhiều phe cùng lúc thì nhận phe họ nhiều điểm hơn (bằng
 * điểm → theo thứ tự Ngỗng, Vịt, Phe thứ 3); các phe còn lại xét người kế tiếp. Vì hạng nhỏ xét
 * trước, ai cũng nhận hạng tốt nhất họ có thể có — vd Top 1 Vịt và Top 2 Ngỗng → giữ Top 1 Vịt,
 * Top 2 Ngỗng về người hạng 3 phe Ngỗng.
 */
export function assignRanks(
  boards: Record<Faction, readonly { memberId: number; points: number }[]>,
  top: number,
): Record<Faction, (number | undefined)[]> {
  const result: Record<Faction, (number | undefined)[]> = { goose: [], duck: [], neutral: [] };
  const cursor: Record<Faction, number> = { goose: 0, duck: 0, neutral: 0 };
  const taken = new Set<number>();
  const candidate = (faction: Faction) => {
    const board = boards[faction];
    while (cursor[faction] < board.length && taken.has(board[cursor[faction]]!.memberId)) cursor[faction] += 1;
    return board[cursor[faction]];
  };

  for (let rank = 0; rank < top; rank += 1) {
    let open = [...FACTIONS];
    while (open.length > 0) {
      // Mỗi người chọn một phe trong các phe đang đề cử họ; phe không còn ai thì bỏ trống hạng này.
      const choice = new Map<number, { faction: Faction; points: number }>();
      for (const faction of open) {
        const c = candidate(faction);
        if (!c) continue;
        const prev = choice.get(c.memberId);
        if (!prev || c.points > prev.points) choice.set(c.memberId, { faction, points: c.points });
      }
      for (const [memberId, { faction }] of choice) {
        result[faction][rank] = memberId;
        taken.add(memberId);
      }
      const filled = new Set([...choice.values()].map((c) => c.faction));
      open = open.filter((faction) => !filled.has(faction) && candidate(faction) !== undefined);
    }
  }
  return result;
}

/** Đã cảnh báo thiếu quyền và chưa đồng bộ lại được lần nào từ đó. */
let warnedPermission = false;

export async function syncRankRoles(ctx: Ctx): Promise<void> {
  try {
    await syncAll(ctx);
    warnedPermission = false;
  } catch (err) {
    if (!(err instanceof RankRolePermissionError)) throw err;
    if (!warnedPermission) {
      console.warn(`[rank-roles] ${err.message}. Server Settings → Roles: bật Manage Roles cho role của bot và kéo nó lên trên các role Top.`);
    }
    warnedPermission = true;
  }
}

async function syncAll(ctx: Ctx): Promise<void> {
  const seasonId = seasonIdOf(toVnDate(ctx.now()));
  const boards = await getFactionTotalBoards(ctx, seasonId);

  // Người đã rời hội không gắn được role — bỏ khỏi bảng để người kế tiếp được đôn lên.
  const members = await ctx.db.member.findMany({
    where: { id: { in: [...new Set(FACTIONS.flatMap((f) => boards[f].map((t) => t.memberId)))] }, status: 'active' },
    select: { id: true, discordId: true },
  });
  const discordIdOf = new Map(members.map((m) => [m.id, m.discordId]));
  const active = (faction: Faction) => boards[faction].filter((t) => discordIdOf.has(t.memberId));
  const leaders = assignRanks({ goose: active('goose'), duck: active('duck'), neutral: active('neutral') }, RANK_ROLE_TOP);

  const keys = FACTIONS.flatMap((f) => Array.from({ length: RANK_ROLE_TOP }, (_, i) => settingKey(f, i + 1)));
  const rows = await ctx.db.appSetting.findMany({ where: { key: { in: keys } } });
  const storedIds = new Map(rows.map((r) => [r.key, r.value]));

  for (const faction of FACTIONS) {
    for (let rank = 1; rank <= RANK_ROLE_TOP; rank += 1) {
      const key = settingKey(faction, rank);
      const knownId = storedIds.get(key) ?? null;
      const roleId = await ctx.rankRoles.ensureRole(rankRoleSpec(faction, rank), knownId);
      if (roleId !== knownId) {
        await ctx.db.appSetting.upsert({ where: { key }, create: { key, value: roleId }, update: { value: roleId } });
      }

      const memberId = leaders[faction][rank - 1];
      const want = memberId === undefined ? undefined : discordIdOf.get(memberId);
      const have = await ctx.rankRoles.holders(roleId);
      for (const discordId of have) {
        if (discordId !== want) await ctx.rankRoles.removeRole(discordId, roleId);
      }
      if (want !== undefined && !have.includes(want)) await ctx.rankRoles.addRole(want, roleId);
    }
  }
}
