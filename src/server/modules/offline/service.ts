/**
 * Tổ chức offline (spec offline): mod/admin tạo sự kiện gặp mặt ngoài đời; thành viên vote "đi được"
 * hoặc "không đi được" trên trang Hôm nay.
 *
 * Giờ: form gửi giờ VN dạng `YYYY-MM-DDTHH:mm` (giá trị của ô `datetime-local`), server đổi sang UTC
 * bằng `lib/time.ts` — web không tự làm toán múi giờ. Hạn vote (tuỳ chọn) phải ≤ giờ sự kiện, kiểm
 * tra trên giá trị SAU khi sửa (gửi một trong hai cũng so với giá trị đang lưu của cái kia).
 *
 * Vote được khi chưa `closed` và chưa tới hạn — hạn vote, không đặt hạn thì giờ sự kiện (sự kiện đã
 * bắt đầu thì danh sách đã chốt). Mỗi người một dòng `offline_votes`; vote lại thì đổi `going`.
 *
 * "Sắp tới" = `starts_at` ≥ đầu ngày hôm nay (giờ VN): sự kiện đã bắt đầu trong ngày vẫn hiện (danh
 * sách người đi) tới hết ngày.
 *
 * Discord (#thông-báo, `ctx.notifier.announce` — không ping ai; chữ người nhập escape Markdown): tạo →
 * "🎉 Offline: **{tên}** — {Thứ} {dd/mm} {HH:mm} tại {địa điểm}" + mô tả + link web, ghi
 * `announcedAt`. Đăng theo kiểu "giành rồi gửi" như ngày nhân điểm: đặt `announcedAt` có điều kiện
 * `IS NULL` TRƯỚC khi gửi (request web và bộ hẹn giờ không đăng trùng), gửi lỗi thì trả cờ về NULL
 * để bộ hẹn giờ đăng bù (`jobs.ts`) — chỉ khi sự kiện chưa diễn ra. Sửa/xoá không đăng thêm tin.
 */

import { Prisma } from '@prisma/client';
import type { OfflineEvent } from '@prisma/client';
import { z } from 'zod';
import type { AdminOfflineEventDto, OfflineEventDto, OfflineEventInput, OfflineEventPatch, OfflinePersonDto } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { escapeDiscordMarkdown } from '../../lib/discord-text.js';
import { appError } from '../../lib/errors.js';
import { formatVnDay, formatVnTime, formatVnWeekday, toVnDate, vnDateTimeToUtc, vnDayRange } from '../../lib/time.js';

export const TITLE_MAX = 80;
export const PLACE_MAX = 120;
export const DESCRIPTION_MAX = 500;

const TITLE_MESSAGE = 'Tên 1–80 ký tự';
const PLACE_MESSAGE = 'Địa điểm 1–120 ký tự';
const DESCRIPTION_MESSAGE = 'Mô tả tối đa 500 ký tự';
const DEADLINE_ORDER_MESSAGE = 'Hạn vote phải trước giờ sự kiện';
const STARTS_AT_MESSAGE = 'Thời gian không hợp lệ';
const DEADLINE_MESSAGE = 'Hạn vote không hợp lệ';

// ---------------------------------------------------------------------------
// Kiểm tra dữ liệu
// ---------------------------------------------------------------------------

/** Thiếu hoặc sai kiểu cũng báo đúng câu của trường đó. */
const typeErrors = (message: string) => ({ invalid_type_error: message, required_error: message });

const titleSchema = z.string(typeErrors(TITLE_MESSAGE)).trim().min(1, TITLE_MESSAGE).max(TITLE_MAX, TITLE_MESSAGE);
const placeSchema = z.string(typeErrors(PLACE_MESSAGE)).trim().min(1, PLACE_MESSAGE).max(PLACE_MAX, PLACE_MESSAGE);
const descriptionSchema = z.string(typeErrors(DESCRIPTION_MESSAGE)).trim().max(DESCRIPTION_MAX, DESCRIPTION_MESSAGE).nullish();
const startsAtSchema = z.string(typeErrors(STARTS_AT_MESSAGE));
const deadlineSchema = z.string(typeErrors(DEADLINE_MESSAGE)).nullish();

const createSchema = z
  .object({ title: titleSchema, startsAt: startsAtSchema, place: placeSchema, description: descriptionSchema, voteDeadline: deadlineSchema })
  .strict();
const patchSchema = z
  .object({
    title: titleSchema.optional(),
    startsAt: startsAtSchema.optional(),
    place: placeSchema.optional(),
    description: descriptionSchema,
    voteDeadline: deadlineSchema,
    closed: z.boolean().optional(),
  })
  .strict();

/** Lỗi zod không có thông báo riêng (sai kiểu…) → thông báo chung tiếng Việt. */
const defaultErrorMap: z.ZodErrorMap = () => ({ message: 'Dữ liệu không hợp lệ' });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  return parsed.data;
}

const VN_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/** Giờ VN `YYYY-MM-DDTHH:mm` → mốc UTC; sai dạng hoặc ngày/giờ không có thật → `VALIDATION` với `message`. */
function vnDateTime(value: string, message: string): Date {
  const match = VN_DATETIME.exec(value);
  if (!match) throw appError('VALIDATION', message);
  try {
    return vnDateTimeToUtc(match[1] as string, match[2] as string);
  } catch {
    throw appError('VALIDATION', message);
  }
}

/** Hạn vote: vắng mặt → `undefined` (giữ nguyên), rỗng/null → `null` (bỏ hạn), còn lại đổi sang UTC. */
function deadlineOf(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  return vnDateTime(value, DEADLINE_MESSAGE);
}

function checkDeadline(startsAt: Date, voteDeadline: Date | null): void {
  if (voteDeadline !== null && voteDeadline.getTime() > startsAt.getTime()) throw appError('VALIDATION', DEADLINE_ORDER_MESSAGE);
}

function emptyToNull(s: string | null | undefined): string | null {
  return s ? s : null;
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** Đầu ngày hôm nay (giờ VN): ranh giới "sắp tới" / "đã qua". */
function startOfTodayVn(now: Date): Date {
  return vnDayRange(toVnDate(now)).start;
}

/** Còn vote được lúc `now`: chưa đóng và chưa tới hạn (hạn vote, không có thì giờ sự kiện). */
function isOpen(e: Pick<OfflineEvent, 'closed' | 'startsAt' | 'voteDeadline'>, now: Date): boolean {
  const deadline = e.voteDeadline ?? e.startsAt;
  return !e.closed && now.getTime() < deadline.getTime();
}

function baseFields(e: OfflineEvent) {
  return {
    id: e.id,
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    place: e.place,
    description: e.description,
    voteDeadline: e.voteDeadline?.toISOString() ?? null,
    closed: e.closed,
  };
}

/** Số vote đi được / không đi được của từng sự kiện — một truy vấn gộp cho cả danh sách. */
async function voteCounts(ctx: Ctx, ids: number[]): Promise<Map<number, { going: number; notGoing: number }>> {
  const counts = new Map<number, { going: number; notGoing: number }>();
  if (ids.length === 0) return counts;
  const groups = await ctx.db.offlineVote.groupBy({ by: ['eventId', 'going'], where: { eventId: { in: ids } }, _count: { _all: true } });
  for (const g of groups) {
    const c = counts.get(g.eventId) ?? { going: 0, notGoing: 0 };
    if (g.going) c.going += g._count._all;
    else c.notGoing += g._count._all;
    counts.set(g.eventId, c);
  }
  return counts;
}

async function toAdminDtos(ctx: Ctx, rows: OfflineEvent[]): Promise<AdminOfflineEventDto[]> {
  const counts = await voteCounts(ctx, rows.map((r) => r.id));
  const boundary = startOfTodayVn(ctx.now()).getTime();
  return rows.map((r) => {
    const c = counts.get(r.id);
    return { ...baseFields(r), past: r.startsAt.getTime() < boundary, goingCount: c?.going ?? 0, notGoingCount: c?.notGoing ?? 0 };
  });
}

const VOTES_WITH_MEMBER = {
  select: { eventId: true, memberId: true, going: true, member: { select: { displayName: true, avatarUrl: true } } },
  // Theo thứ tự vote (đổi ý thì tính lại từ lúc đổi), rồi id cho ổn định.
  orderBy: [{ updatedAt: 'asc' }, { memberId: 'asc' }],
} satisfies Prisma.OfflineVoteFindManyArgs;

/** Thẻ trang Hôm nay của các sự kiện `rows` (giữ thứ tự), nhìn từ người xem `viewerId` — một truy vấn vote. */
async function toMemberDtos(ctx: Ctx, viewerId: number, rows: OfflineEvent[]): Promise<OfflineEventDto[]> {
  const votes =
    rows.length === 0 ? [] : await ctx.db.offlineVote.findMany({ ...VOTES_WITH_MEMBER, where: { eventId: { in: rows.map((r) => r.id) } } });
  const now = ctx.now();
  return rows.map((r) => {
    const mine = votes.filter((v) => v.eventId === r.id);
    const person = (v: (typeof mine)[number]): OfflinePersonDto => ({ memberId: v.memberId, displayName: v.member.displayName, avatarUrl: v.member.avatarUrl });
    return {
      ...baseFields(r),
      open: isOpen(r, now),
      going: mine.filter((v) => v.going).map(person),
      notGoing: mine.filter((v) => !v.going).map(person),
      myVote: mine.find((v) => v.memberId === viewerId)?.going ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

/** Danh sách quản trị: sắp tới (từ đầu hôm nay VN, gần nhất trước), rồi đã qua (mới nhất trước). */
export async function listOfflineEventsAdmin(ctx: Ctx): Promise<AdminOfflineEventDto[]> {
  const boundary = startOfTodayVn(ctx.now());
  const [upcoming, past] = await Promise.all([
    ctx.db.offlineEvent.findMany({ where: { startsAt: { gte: boundary } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] }),
    ctx.db.offlineEvent.findMany({ where: { startsAt: { lt: boundary } }, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] }),
  ]);
  return toAdminDtos(ctx, [...upcoming, ...past]);
}

/** Sự kiện chưa diễn ra (`starts_at` ≥ đầu ngày hôm nay VN), gần nhất trước, nhìn từ `viewerId`. */
export async function listUpcomingOfflineEvents(ctx: Ctx, viewerId: number): Promise<OfflineEventDto[]> {
  const rows = await ctx.db.offlineEvent.findMany({
    where: { startsAt: { gte: startOfTodayVn(ctx.now()) } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  return toMemberDtos(ctx, viewerId, rows);
}

// ---------------------------------------------------------------------------
// Tạo / sửa / xoá
// ---------------------------------------------------------------------------

/** Tạo sự kiện rồi đăng tin tạo (lỗi Discord chỉ ghi log, bộ hẹn giờ đăng bù). */
export async function createOfflineEvent(ctx: Ctx, createdById: number, input: OfflineEventInput): Promise<AdminOfflineEventDto> {
  const p = parse(createSchema, input);
  const startsAt = vnDateTime(p.startsAt, STARTS_AT_MESSAGE);
  const voteDeadline = deadlineOf(p.voteDeadline) ?? null;
  checkDeadline(startsAt, voteDeadline);
  const row = await ctx.db.offlineEvent.create({
    data: { title: p.title, startsAt, place: p.place, description: emptyToNull(p.description), voteDeadline, createdById },
  });
  await announceOfflineEvent(ctx, row.id);
  return (await toAdminDtos(ctx, [row]))[0] as AdminOfflineEventDto;
}

/** Sửa các trường được gửi (vắng mặt giữ nguyên); `closed` để Đóng vote / Mở lại. Không có → `NOT_FOUND`. */
export async function updateOfflineEvent(ctx: Ctx, id: number, patch: OfflineEventPatch): Promise<AdminOfflineEventDto> {
  const p = parse(patchSchema, patch);
  const existing = await ctx.db.offlineEvent.findUnique({ where: { id } });
  if (!existing) throw appError('NOT_FOUND');
  const startsAt = p.startsAt === undefined ? existing.startsAt : vnDateTime(p.startsAt, STARTS_AT_MESSAGE);
  const newDeadline = deadlineOf(p.voteDeadline);
  checkDeadline(startsAt, newDeadline === undefined ? existing.voteDeadline : newDeadline);

  const data: Prisma.OfflineEventUpdateInput = {};
  if (p.title !== undefined) data.title = p.title;
  if (p.startsAt !== undefined) data.startsAt = startsAt;
  if (p.place !== undefined) data.place = p.place;
  if (p.description !== undefined) data.description = emptyToNull(p.description);
  if (newDeadline !== undefined) data.voteDeadline = newDeadline;
  if (p.closed !== undefined) data.closed = p.closed;
  try {
    const row = await ctx.db.offlineEvent.update({ where: { id }, data });
    return (await toAdminDtos(ctx, [row]))[0] as AdminOfflineEventDto;
  } catch (err) {
    if (isNotFound(err)) throw appError('NOT_FOUND');
    throw err;
  }
}

/** Xoá sự kiện (vote xoá theo, `ON DELETE CASCADE`). Không có → `NOT_FOUND`. */
export async function deleteOfflineEvent(ctx: Ctx, id: number): Promise<void> {
  try {
    await ctx.db.offlineEvent.delete({ where: { id } });
  } catch (err) {
    if (isNotFound(err)) throw appError('NOT_FOUND');
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

/**
 * Vote (hoặc đổi vote) của `memberId`; trả thẻ mới của sự kiện. Không có → `NOT_FOUND`; đã đóng / quá
 * hạn / đã bắt đầu → `OFFLINE_VOTE_CLOSED` ("Đã hết hạn vote").
 */
export async function voteOfflineEvent(ctx: Ctx, memberId: number, eventId: number, going: boolean): Promise<OfflineEventDto> {
  const event = await ctx.db.offlineEvent.findUnique({ where: { id: eventId } });
  if (!event) throw appError('NOT_FOUND');
  if (!isOpen(event, ctx.now())) throw appError('OFFLINE_VOTE_CLOSED');
  try {
    await ctx.db.offlineVote.upsert({
      where: { eventId_memberId: { eventId, memberId } },
      create: { eventId, memberId, going },
      update: { going },
    });
  } catch (err) {
    // Sự kiện vừa bị xoá giữa lúc đọc và lúc ghi (khoá ngoại).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw appError('NOT_FOUND');
    throw err;
  }
  return (await toMemberDtos(ctx, memberId, [event]))[0] as OfflineEventDto;
}

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

/** "🎉 Offline: **{tên}** — {Thứ} {dd/mm} {HH:mm} tại {địa điểm}" + mô tả (nếu có) + link web. */
export function announcementText(e: Pick<OfflineEvent, 'title' | 'startsAt' | 'place' | 'description'>, publicUrl: string): string {
  const day = toVnDate(e.startsAt);
  const lines = [
    `🎉 Offline: **${escapeDiscordMarkdown(e.title)}** — ${formatVnWeekday(day)} ${formatVnDay(day)} ${formatVnTime(e.startsAt)} tại ${escapeDiscordMarkdown(e.place)}`,
  ];
  if (e.description) lines.push(escapeDiscordMarkdown(e.description));
  lines.push(`Vote đi được hay không trên web: ${publicUrl}`);
  return lines.join('\n');
}

/**
 * Đăng tin tạo của sự kiện `id` nếu chưa đăng và chưa diễn ra: giành cờ (`announcedAt IS NULL` → bây
 * giờ) rồi mới gửi; gửi lỗi → trả cờ về NULL (lượt sau đăng bù). Không bao giờ ném lỗi Discord.
 */
export async function announceOfflineEvent(ctx: Ctx, id: number): Promise<void> {
  const at = ctx.now();
  const { count } = await ctx.db.offlineEvent.updateMany({ where: { id, announcedAt: null, startsAt: { gt: at } }, data: { announcedAt: at } });
  if (count === 0) return;
  const row = await ctx.db.offlineEvent.findUnique({ where: { id } });
  if (!row) return;
  try {
    await ctx.notifier.announce(announcementText(row, ctx.config.publicUrl));
  } catch (err) {
    console.error(`[offline] Không đăng được tin sự kiện ${id} (sẽ đăng bù): ${err instanceof Error ? err.message : String(err)}`);
    await ctx.db.offlineEvent.updateMany({ where: { id, announcedAt: at }, data: { announcedAt: null } });
  }
}
