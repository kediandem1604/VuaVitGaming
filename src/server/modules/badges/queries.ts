/**
 * Đọc danh hiệu cho web (spec huy hiệu §7): tường vinh danh `GET /api/badges` và trang thành
 * viên công khai `GET /api/members/:id`. Chỉ đọc — `member_badges` do job `badges` ghi
 * (monthly.ts, milestones.ts) và không bao giờ sửa/xoá.
 *
 * Thứ tự "mới nhất trước" là `awardedAt` giảm dần rồi `id` giảm dần (index `[awardedAt, id]`).
 * Mọi danh hiệu của một tháng chia chung một `awardedAt`, nên phân trang theo mốc thời gian
 * đơn thuần sẽ lặp hay sót dòng; `before` là id dòng cuối trang trước, và trang kế là các dòng
 * đứng SAU nó trong thứ tự trên: `awardedAt < X.awardedAt`, hoặc cùng `awardedAt` và `id < X.id`.
 */

import type { Prisma } from '@prisma/client';
import type { BadgeDto, PublicMemberDto } from '../../../shared/api-types.js';
import { BADGES } from '../../../shared/badges.js';
import type { BadgeKind } from '../../../shared/badges.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';

/** Số dòng mỗi trang của tường vinh danh khi client không gửi `limit`. */
export const DEFAULT_LIMIT = 50;
/** Trần của `limit` — route cũng chặn ở đây. */
export const MAX_LIMIT = 100;

/** Id hợp lệ để tra DB (số nguyên dương vừa Int); id lạ (lẻ, âm, quá int32) coi như không có. */
function isId(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 2_147_483_647;
}

/** `kind` theo khoá trong danh mục; khoá nào cũng có trong `BADGES`. */
const KIND_BY_KEY: ReadonlyMap<string, BadgeKind> = new Map(BADGES.map((b) => [b.key, b.kind]));

/** Cột đọc cho một dòng danh hiệu kèm người nhận — đúng những gì DTO cần, không hơn. */
const BADGE_SELECT = {
  id: true,
  badgeKey: true,
  periodId: true,
  title: true,
  icon: true,
  detail: true,
  awardedAt: true,
  member: { select: { id: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.MemberBadgeSelect;

type BadgeRow = Prisma.MemberBadgeGetPayload<{ select: typeof BADGE_SELECT }>;

/** Mới nhất trước: `awardedAt` giảm dần, rồi `id` giảm dần (khớp index `[awardedAt, id]`). */
const NEWEST_FIRST: Prisma.MemberBadgeOrderByWithRelationInput[] = [{ awardedAt: 'desc' }, { id: 'desc' }];

/**
 * `kind` của một dòng: tra danh mục theo `badgeKey`. Dòng là chữ đóng băng và không bao giờ
 * xoá, nên nếu một khoá sau này rời khỏi danh mục thì vẫn phải hiện được: khi đó suy từ
 * `periodId` (`''` = cột mốc, `YYYY-MM` = danh hiệu tháng — quy ước ghi của job trao).
 */
function kindOf(row: Pick<BadgeRow, 'badgeKey' | 'periodId'>): BadgeKind {
  return KIND_BY_KEY.get(row.badgeKey) ?? (row.periodId === '' ? 'milestone' : 'monthly');
}

function toBadgeDto(row: BadgeRow): BadgeDto {
  return {
    id: row.id,
    badgeKey: row.badgeKey,
    kind: kindOf(row),
    periodId: row.periodId,
    title: row.title,
    icon: row.icon,
    detail: row.detail,
    awardedAt: row.awardedAt.toISOString(),
    member: { id: row.member.id, displayName: row.member.displayName, avatarUrl: row.member.avatarUrl },
  };
}

export interface ListBadgesOptions {
  /** Id dòng cuối trang trước; bỏ trống → trang đầu. Id không có trong `member_badges` → `VALIDATION`. */
  before?: number;
  /** 1..`MAX_LIMIT`; bỏ trống → `DEFAULT_LIMIT`. */
  limit?: number;
}

/**
 * Một trang của tường vinh danh: mọi danh hiệu của mọi người, mới nhất trước. Trang sau
 * `before` là các dòng đứng sau dòng đó trong thứ tự `(awardedAt desc, id desc)` — ổn định
 * kể cả khi cả trăm dòng cùng `awardedAt` (một tháng trao) và khi có dòng mới chen vào
 * đầu danh sách giữa hai lần gọi. `before` lạ → `VALIDATION` (không lặng lẽ trả trang đầu).
 */
export async function listBadges(ctx: Ctx, opts: ListBadgesOptions = {}): Promise<BadgeDto[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw appError('VALIDATION', 'Giới hạn không hợp lệ');

  const rows = await ctx.db.memberBadge.findMany({
    where: opts.before === undefined ? undefined : await afterCursor(ctx, opts.before),
    orderBy: NEWEST_FIRST,
    take: limit,
    select: BADGE_SELECT,
  });
  return rows.map(toBadgeDto);
}

/** Điều kiện "đứng sau dòng `before`" trong thứ tự mới nhất trước; dòng không có → `VALIDATION`. */
async function afterCursor(ctx: Ctx, before: number): Promise<Prisma.MemberBadgeWhereInput> {
  const cursor = isId(before) ? await ctx.db.memberBadge.findUnique({ where: { id: before }, select: { id: true, awardedAt: true } }) : null;
  if (!cursor) throw appError('VALIDATION', 'Mốc phân trang không hợp lệ');
  return { OR: [{ awardedAt: { lt: cursor.awardedAt } }, { awardedAt: cursor.awardedAt, id: { lt: cursor.id } }] };
}

/**
 * Trang thành viên công khai: tên, avatar, ngày vào server, đã rời hay chưa và mọi danh hiệu
 * (mới nhất trước). Chỉ chọn đúng các cột công khai — không bao giờ đọc email, quyền hay
 * Discord id ra khỏi DB ở đây. Id lạ hay không có → `NOT_FOUND`. Người đã rời server vẫn có
 * trang (danh hiệu không mất).
 */
export async function getPublicMember(ctx: Ctx, memberId: number): Promise<PublicMemberDto> {
  const member = isId(memberId)
    ? await ctx.db.member.findUnique({
        where: { id: memberId },
        select: { id: true, displayName: true, avatarUrl: true, joinedAt: true, status: true },
      })
    : null;
  if (!member) throw appError('NOT_FOUND');

  const rows = await ctx.db.memberBadge.findMany({ where: { memberId: member.id }, orderBy: NEWEST_FIRST, select: BADGE_SELECT });
  return {
    id: member.id,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
    joinedAt: member.joinedAt.toISOString(),
    left: member.status === 'left',
    badges: rows.map(toBadgeDto),
  };
}
