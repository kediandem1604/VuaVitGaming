/**
 * Ngày nhân điểm (spec ngày nhân điểm §2–§4, §6): admin đặt một ngày VN có hệ số ×2–×5; điểm CỘNG
 * của lần khai có ngày chơi là ngày đó được nhân lúc tính (`leaderboard.ts`, `reports.ts` đọc hệ số
 * HIỆN TẠI qua `multiplierDaysInRange` / `multipliersByDay`). Điểm trừ, +1 báo cáo và treo thưởng
 * không nhân.
 *
 * Quản trị: tạo cho hôm nay hoặc sau này (`MULTIPLIER_DAY_PAST`), mỗi ngày một dòng
 * (`MULTIPLIER_DAY_TAKEN`); ngày đã qua (trước hôm nay VN) không sửa/xoá được
 * (`MULTIPLIER_DAY_LOCKED`) — điểm của các trận đã chơi không bị đổi ngược.
 *
 * Discord (#thông-báo, `ctx.notifier.announce` — không ping ai; lời nhắn escape Markdown): tạo → tin
 * "🔥 {Thứ} {dd/mm}: điểm cộng ×{m}!" và ghi `announcedAt`; sửa hệ số/lời nhắn của ngày đã đăng → "✏️
 * Cập nhật …"; đổi sang ngày khác → "❌ Huỷ …" cho ngày cũ (nếu đã đăng) rồi đăng như ngày mới; xoá
 * ngày đã đăng → "❌ Huỷ ngày nhân điểm {dd/mm}". Lỗi Discord chỉ ghi log. Tin tạo đăng theo kiểu
 * "giành rồi gửi": đặt `announcedAt` có điều kiện `announcedAt IS NULL` TRƯỚC khi gửi (chỉ một bên
 * giành được — request web và bộ hẹn giờ đăng bù không đăng trùng), gửi lỗi thì trả cờ về NULL để bộ
 * hẹn giờ đăng bù (`jobs.ts`). Nhắc 9:00 đúng ngày dùng cùng cách trên `remindedAt`.
 *
 * Ngày tạo (hoặc đổi sang) đúng hôm nay sau 9:00 VN: tin tạo đã là lời nhắc trong ngày, nên
 * `remindedAt` ghi luôn — không đăng thêm "Hôm nay…" ngay sau đó.
 */

import { Prisma } from '@prisma/client';
import type { ScoreMultiplierDay } from '@prisma/client';
import { z } from 'zod';
import type { AdminMultiplierDayDto, MultiplierDayDto, MultiplierDayInput, MultiplierDayPatch } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { escapeDiscordMarkdown } from '../../lib/discord-text.js';
import { appError } from '../../lib/errors.js';
import { HOT_TX } from '../../lib/tx.js';
import {
  dateOnlyToDb,
  dbToDateOnly,
  formatVnDay,
  formatVnWeekday,
  previousSeasonId,
  seasonDateRange,
  seasonIdOf,
  toVnDate,
  vnDateTimeToUtc,
} from '../../lib/time.js';

/** Client thường hoặc client trong giao dịch. */
type DbClient = Ctx['db'] | Prisma.TransactionClient;

export const MULTIPLIER_MIN = 2;
export const MULTIPLIER_MAX = 5;
export const MESSAGE_MAX = 100;
/** Giờ VN đăng nhắc trong ngày nhân điểm. */
export const REMINDER_TIME = '09:00';
/** Số ngày sắp tới tối đa trả cho banner (thực tế chỉ vài ngày). */
const UPCOMING_MAX = 30;

// ---------------------------------------------------------------------------
// Tra hệ số (dùng khi tính điểm)
// ---------------------------------------------------------------------------

/** Các ngày nhân điểm trong khoảng ngày VN [first, last] (một truy vấn). */
export async function multiplierDaysInRange(db: DbClient, first: string, last: string): Promise<{ day: Date; multiplier: number }[]> {
  return db.scoreMultiplierDay.findMany({
    where: { day: { gte: dateOnlyToDb(first), lte: dateOnlyToDb(last) } },
    select: { day: true, multiplier: true },
  });
}

/**
 * Hệ số của các ngày được hỏi (cột `@db.Date`), khoá là ngày VN `YYYY-MM-DD`; ngày không nhân thì
 * không có khoá. Một truy vấn; danh sách rỗng thì không truy vấn.
 */
export async function multipliersByDay(db: DbClient, days: Date[]): Promise<Map<string, number>> {
  const unique = [...new Set(days.map((d) => d.getTime()))].map((t) => new Date(t));
  if (unique.length === 0) return new Map();
  const rows = await db.scoreMultiplierDay.findMany({ where: { day: { in: unique } }, select: { day: true, multiplier: true } });
  return new Map(rows.map((r) => [dbToDateOnly(r.day), r.multiplier]));
}

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

function toDto(r: ScoreMultiplierDay): MultiplierDayDto {
  return { id: r.id, day: dbToDateOnly(r.day), multiplier: r.multiplier, message: r.message };
}

function toAdminDto(r: ScoreMultiplierDay, today: string): AdminMultiplierDayDto {
  const dto = toDto(r);
  return { ...dto, past: dto.day < today };
}

/** Các ngày `day ≥ hôm nay VN`, gần nhất trước — cho banner (mọi thành viên). */
export async function listUpcomingMultiplierDays(ctx: Ctx): Promise<MultiplierDayDto[]> {
  const today = toVnDate(ctx.now());
  const rows = await ctx.db.scoreMultiplierDay.findMany({
    where: { day: { gte: dateOnlyToDb(today) } },
    orderBy: { day: 'asc' },
    take: UPCOMING_MAX,
  });
  return rows.map(toDto);
}

/**
 * Danh sách quản trị: các ngày từ hôm nay trở đi (gần nhất trước), rồi các ngày đã qua của mùa đang mở
 * — mùa hiện tại, và cả mùa trước khi nó chưa chốt (ngày 1–3 tháng sau) — mới nhất trước, `past = true`.
 */
export async function listMultiplierDaysAdmin(ctx: Ctx): Promise<AdminMultiplierDayDto[]> {
  const today = toVnDate(ctx.now());
  const current = seasonIdOf(today);
  const previous = previousSeasonId(current);
  // Đọc thẳng dòng `seasons` (không import seasons/service để khỏi vòng import với leaderboard).
  const prevRow = await ctx.db.season.findUnique({ where: { id: previous }, select: { closedAt: true } });
  const firstOpen = prevRow !== null && prevRow.closedAt === null ? previous : current;
  const rows = await ctx.db.scoreMultiplierDay.findMany({
    where: { day: { gte: dateOnlyToDb(seasonDateRange(firstOpen).first) } },
    orderBy: { day: 'asc' },
  });
  const dtos = rows.map((r) => toAdminDto(r, today));
  return [...dtos.filter((d) => !d.past), ...dtos.filter((d) => d.past).reverse()];
}

// ---------------------------------------------------------------------------
// Tạo / sửa / xoá
// ---------------------------------------------------------------------------

const MULTIPLIER_MESSAGE = 'Hệ số phải từ ×2 đến ×5';
// Mọi giá trị không phải số nguyên 2–5 (kể cả NaN, chữ) đều báo cùng một câu.
const multiplierSchema = z.custom<number>(
  (v) => typeof v === 'number' && Number.isInteger(v) && v >= MULTIPLIER_MIN && v <= MULTIPLIER_MAX,
  MULTIPLIER_MESSAGE,
);
const messageSchema = z.string().trim().max(MESSAGE_MAX, 'Lời nhắn tối đa 100 ký tự').nullish();
const daySchema = z.string();

const createSchema = z.object({ day: daySchema, multiplier: multiplierSchema, message: messageSchema }).strict();
const patchSchema = z.object({ day: daySchema.optional(), multiplier: multiplierSchema.optional(), message: messageSchema }).strict();

/** Lỗi zod không có thông báo riêng (sai kiểu…) → thông báo chung tiếng Việt. */
const defaultErrorMap: z.ZodErrorMap = () => ({ message: 'Dữ liệu không hợp lệ' });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  return parsed.data;
}

/** `YYYY-MM-DD` có thật (sai → `VALIDATION`) và ≥ hôm nay VN (`MULTIPLIER_DAY_PAST`). */
function checkFutureDay(day: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw appError('VALIDATION', 'Ngày không hợp lệ');
  try {
    dateOnlyToDb(day);
  } catch {
    throw appError('VALIDATION', 'Ngày không hợp lệ');
  }
  // Chuỗi `YYYY-MM-DD` so theo từ điển đúng bằng so ngày.
  if (day < today) throw appError('MULTIPLIER_DAY_PAST');
  return day;
}

function emptyToNull(s: string | null | undefined): string | null {
  return s === undefined || s === null || s === '' ? null : s;
}

/**
 * `remindedAt` lúc ngày được tạo/đổi sang `day`: đúng hôm nay mà đã qua 9:00 VN → ghi luôn (tin tạo
 * thay cho lời nhắc trong ngày); còn lại → null (bộ hẹn giờ nhắc lúc 9:00).
 */
function initialRemindedAt(day: string, now: Date): Date | null {
  const today = toVnDate(now);
  return day === today && now.getTime() >= vnDateTimeToUtc(today, REMINDER_TIME).getTime() ? now : null;
}

/** Trùng khoá UNIQUE `day`. */
function isDayTaken(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Tạo ngày nhân điểm rồi đăng tin tạo (lỗi Discord chỉ ghi log, bộ hẹn giờ đăng bù). */
export async function createMultiplierDay(ctx: Ctx, createdById: number, input: MultiplierDayInput): Promise<AdminMultiplierDayDto> {
  const p = parse(createSchema, input);
  const now = ctx.now();
  const today = toVnDate(now);
  const day = checkFutureDay(p.day, today);
  let row: ScoreMultiplierDay;
  try {
    row = await ctx.db.scoreMultiplierDay.create({
      data: {
        day: dateOnlyToDb(day),
        multiplier: p.multiplier,
        message: emptyToNull(p.message),
        createdById,
        createdAt: now,
        remindedAt: initialRemindedAt(day, now),
      },
    });
  } catch (err) {
    if (isDayTaken(err)) throw appError('MULTIPLIER_DAY_TAKEN');
    throw err;
  }
  await announceCreated(ctx, row.id);
  return toAdminDto(row, today);
}

/** Ngày nhân điểm còn sửa/xoá được: có (`NOT_FOUND`) và chưa qua (`MULTIPLIER_DAY_LOCKED`). */
function checkEditable(row: ScoreMultiplierDay | null, today: string): ScoreMultiplierDay {
  if (!row) throw appError('NOT_FOUND');
  if (dbToDateOnly(row.day) < today) throw appError('MULTIPLIER_DAY_LOCKED');
  return row;
}

async function loadEditable(ctx: Ctx, id: number, today: string): Promise<ScoreMultiplierDay> {
  return checkEditable(await ctx.db.scoreMultiplierDay.findUnique({ where: { id } }), today);
}

/**
 * Trong giao dịch: khoá dòng (`FOR UPDATE`) rồi đọc lại. Bộ hẹn giờ đăng bù giành `announcedAt` bằng
 * một lệnh ghi có điều kiện trên chính dòng này, nên lệnh đó hoặc xong trước (ta thấy cờ đã đặt) hoặc
 * chờ tới khi ta commit — `announcedAt` đọc được ở đây đúng là trạng thái lúc ta ghi.
 */
async function lockEditable(tx: Prisma.TransactionClient, id: number, today: string): Promise<ScoreMultiplierDay> {
  await tx.$queryRaw`SELECT id FROM score_multiplier_days WHERE id = ${id} FOR UPDATE`;
  return checkEditable(await tx.scoreMultiplierDay.findUnique({ where: { id } }), today);
}

/**
 * Sửa các trường được gửi (vắng mặt giữ nguyên). Đổi hệ số/lời nhắn của ngày đã đăng → tin "✏️ Cập
 * nhật". Đổi sang ngày khác (≥ hôm nay, chưa có hệ số): ngày cũ đã đăng → "❌ Huỷ", rồi đăng như ngày
 * mới tạo (cờ đăng/nhắc đặt lại). "Đã đăng" xét theo dòng đã khoá lúc ghi (`lockEditable`), không theo
 * lần đọc đầu: tin tạo được đăng bù xen giữa vẫn kéo theo tin sửa/huỷ, Discord không giữ ×m cũ.
 */
export async function updateMultiplierDay(ctx: Ctx, id: number, patch: MultiplierDayPatch): Promise<AdminMultiplierDayDto> {
  const p = parse(patchSchema, patch);
  const now = ctx.now();
  const today = toVnDate(now);
  // Đọc trước (ngoài giao dịch) để báo lỗi sớm: không có / đã qua / ngày mới sai.
  const first = await loadEditable(ctx, id, today);
  const newDay = p.day === undefined ? dbToDateOnly(first.day) : checkFutureDay(p.day, today);

  let before: ScoreMultiplierDay;
  let row: ScoreMultiplierDay;
  try {
    ({ before, row } = await ctx.db.$transaction(async (tx) => {
      const locked = await lockEditable(tx, id, today);
      const data: Prisma.ScoreMultiplierDayUpdateInput = {};
      if (p.multiplier !== undefined) data.multiplier = p.multiplier;
      if (p.message !== undefined) data.message = emptyToNull(p.message);
      if (newDay !== dbToDateOnly(locked.day)) {
        data.day = dateOnlyToDb(newDay);
        data.announcedAt = null;
        data.remindedAt = initialRemindedAt(newDay, now);
      }
      return { before: locked, row: await tx.scoreMultiplierDay.update({ where: { id }, data }) };
    }, HOT_TX));
  } catch (err) {
    if (isDayTaken(err)) throw appError('MULTIPLIER_DAY_TAKEN');
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw appError('NOT_FOUND');
    throw err;
  }

  const oldDay = dbToDateOnly(before.day);
  if (newDay !== oldDay) {
    if (before.announcedAt !== null) await post(ctx, cancelledText(oldDay), `huỷ ${oldDay}`);
    await announceCreated(ctx, row.id);
  } else if (before.announcedAt !== null && (row.multiplier !== before.multiplier || row.message !== before.message)) {
    await post(ctx, updatedText(row), `cập nhật ${newDay}`);
  }
  return toAdminDto(row, today);
}

/**
 * Xoá ngày chưa qua; đã đăng tin tạo (xét trên dòng đã khoá lúc xoá, như khi sửa) → "❌ Huỷ ngày nhân
 * điểm {dd/mm}".
 */
export async function deleteMultiplierDay(ctx: Ctx, id: number): Promise<void> {
  const today = toVnDate(ctx.now());
  await loadEditable(ctx, id, today);
  const deleted = await ctx.db.$transaction(async (tx) => {
    const locked = await lockEditable(tx, id, today);
    await tx.scoreMultiplierDay.delete({ where: { id } });
    return locked;
  }, HOT_TX);
  if (deleted.announcedAt !== null) {
    const day = dbToDateOnly(deleted.day);
    await post(ctx, cancelledText(day), `huỷ ${day}`);
  }
}

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

/** Lời nhắn (đã escape Markdown) ở dòng sau, nếu có. */
function withMessage(text: string, message: string | null): string {
  return message === null ? text : `${text}\n${escapeDiscordMarkdown(message)}`;
}

/** "🔥 {Thứ} {dd/mm}: điểm cộng ×{m}!" (+ lời nhắn). */
export function createdText(r: Pick<ScoreMultiplierDay, 'day' | 'multiplier' | 'message'>): string {
  const day = dbToDateOnly(r.day);
  return withMessage(`🔥 ${formatVnWeekday(day)} ${formatVnDay(day)}: điểm cộng ×${r.multiplier}!`, r.message);
}

/** "✏️ Cập nhật {dd/mm}: điểm cộng ×{m}" (+ lời nhắn). */
export function updatedText(r: Pick<ScoreMultiplierDay, 'day' | 'multiplier' | 'message'>): string {
  return withMessage(`✏️ Cập nhật ${formatVnDay(dbToDateOnly(r.day))}: điểm cộng ×${r.multiplier}`, r.message);
}

/** "❌ Huỷ ngày nhân điểm {dd/mm}". */
export function cancelledText(day: string): string {
  return `❌ Huỷ ngày nhân điểm ${formatVnDay(day)}`;
}

/** "🔥 Hôm nay điểm cộng ×{m}!" (+ lời nhắn). */
export function reminderText(r: Pick<ScoreMultiplierDay, 'multiplier' | 'message'>): string {
  return withMessage(`🔥 Hôm nay điểm cộng ×${r.multiplier}!`, r.message);
}

/** Đăng một tin; lỗi Discord chỉ ghi log. Trả về đăng được hay không. */
async function post(ctx: Ctx, text: string, what: string): Promise<boolean> {
  try {
    await ctx.notifier.announce(text);
    return true;
  } catch (err) {
    console.error(`[multipliers] Không đăng được tin ${what}: ${messageOf(err)}`);
    return false;
  }
}

/**
 * Đăng tin tạo của ngày `id` nếu chưa đăng: giành cờ (`announcedAt IS NULL` → bây giờ) rồi mới gửi,
 * nên request web và bộ hẹn giờ không bao giờ cùng đăng; gửi lỗi → trả cờ về NULL (lượt sau đăng bù).
 * Ngày đã bị xoá hay đã có người đăng → không làm gì.
 */
export async function announceCreated(ctx: Ctx, id: number): Promise<void> {
  const at = ctx.now();
  const { count } = await ctx.db.scoreMultiplierDay.updateMany({ where: { id, announcedAt: null }, data: { announcedAt: at } });
  if (count === 0) return;
  const row = await ctx.db.scoreMultiplierDay.findUnique({ where: { id } });
  if (!row) return;
  if (!(await post(ctx, createdText(row), `tạo ${dbToDateOnly(row.day)} (sẽ đăng bù)`))) {
    await ctx.db.scoreMultiplierDay.updateMany({ where: { id, announcedAt: at }, data: { announcedAt: null } });
  }
}

/**
 * Nhắc "🔥 Hôm nay…" cho ngày `id` đúng một lần: giành `remindedAt` (IS NULL → bây giờ) rồi mới gửi;
 * gửi lỗi → trả cờ về NULL để lượt sau (vẫn trong ngày) nhắc lại.
 */
export async function remindToday(ctx: Ctx, id: number): Promise<void> {
  const at = ctx.now();
  const { count } = await ctx.db.scoreMultiplierDay.updateMany({ where: { id, remindedAt: null }, data: { remindedAt: at } });
  if (count === 0) return;
  const row = await ctx.db.scoreMultiplierDay.findUnique({ where: { id } });
  if (!row) return;
  if (!(await post(ctx, reminderText(row), `nhắc ${dbToDateOnly(row.day)}`))) {
    await ctx.db.scoreMultiplierDay.updateMany({ where: { id, remindedAt: at }, data: { remindedAt: null } });
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
