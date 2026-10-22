/**
 * Module buổi chơi: tạo buổi, điểm danh (tham gia / rời), huỷ buổi, danh sách
 * theo ngày VN và đồng bộ tin Discord của buổi.
 *
 * Cả nút Discord lẫn web đều gọi vào đây nên kết quả hai bên giống hệt nhau.
 * Sức chứa được bảo đảm bằng khoá dòng buổi (`SELECT … FOR UPDATE`) trong một
 * giao dịch: hai người bấm "Tham gia" cùng lúc khi còn một chỗ thì đúng một người vào.
 *
 * Tin Discord không bao giờ chặn nghiệp vụ: Discord sập thì dữ liệu vẫn lưu, buổi
 * được đánh dấu `discordDirty` để bộ hẹn giờ (Task 11) đăng bù / sửa bù sau.
 */

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { formatVnDay, formatVnTime, vnDayRange } from '../../lib/time.js';
import { MessageGoneError } from '../../ports.js';
import type { SessionView } from '../../ports.js';

// ---------------------------------------------------------------------------
// Đọc buổi chơi → SessionView
// ---------------------------------------------------------------------------

/**
 * Buổi kèm chế độ chơi và người đang tham gia (chỉ `going`, chỉ thành viên còn
 * trong server), xếp theo thứ tự bấm tham gia (giờ đổi trạng thái, rồi memberId).
 */
const sessionInclude = {
  mode: { select: { nameVi: true } },
  attendances: {
    where: { status: 'going', member: { status: 'active' } },
    orderBy: [{ updatedAt: 'asc' }, { memberId: 'asc' }],
    select: { memberId: true, member: { select: { displayName: true, discordId: true } } },
  },
} satisfies Prisma.GameSessionInclude;

type SessionRow = Prisma.GameSessionGetPayload<{ include: typeof sessionInclude }>;

function toSessionView(row: SessionRow): SessionView {
  return {
    id: row.id,
    startsAt: row.startsAt,
    modeName: row.mode.nameVi,
    capacity: row.capacity,
    roomCode: row.roomCode,
    note: row.note,
    status: row.status,
    attendees: row.attendances.map((a) => ({ memberId: a.memberId, displayName: a.member.displayName })),
  };
}

function findSessionRow(db: Prisma.TransactionClient, id: number): Promise<SessionRow | null> {
  return db.gameSession.findUnique({ where: { id }, include: sessionInclude });
}

/** Buổi chơi theo id; không có → `NOT_FOUND`. */
export async function getSessionView(ctx: Ctx, id: number): Promise<SessionView> {
  const row = await findSessionRow(ctx.db, id);
  if (!row) throw appError('NOT_FOUND');
  return toSessionView(row);
}

/** Mọi buổi (kể cả đã huỷ / kết thúc) bắt đầu trong ngày VN `vnDate`, theo giờ bắt đầu tăng dần. */
export async function listSessionsOnVnDate(ctx: Ctx, vnDate: string): Promise<SessionView[]> {
  let range: { start: Date; end: Date };
  try {
    range = vnDayRange(vnDate);
  } catch {
    throw appError('VALIDATION', 'Ngày không hợp lệ');
  }
  const rows = await ctx.db.gameSession.findMany({
    where: { startsAt: { gte: range.start, lt: range.end } },
    include: sessionInclude,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toSessionView);
}

// ---------------------------------------------------------------------------
// Chế độ chơi
// ---------------------------------------------------------------------------

/** Chế độ chơi đang bật, theo id tăng dần (thứ tự dữ liệu mẫu) — cho form tạo buổi. */
export function listActiveModes(ctx: Ctx): Promise<{ id: number; key: string; nameVi: string }[]> {
  return ctx.db.gameMode.findMany({
    where: { active: true },
    select: { id: true, key: true, nameVi: true },
    orderBy: { id: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// Tạo buổi
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  startsAt: Date;
  modeId: number;
  /** Mặc định 16; 1–25 (ràng buộc CHECK trong DB). */
  capacity?: number;
  /** Cắt khoảng trắng, tối đa 20 ký tự; rỗng → null. */
  roomCode?: string | null;
  /** Cắt khoảng trắng, tối đa 300 ký tự; rỗng → null. */
  note?: string | null;
}

/** Cho phép tạo buổi "vừa mới" bắt đầu (lệch đồng hồ, gõ chậm), nhưng không phải buổi đã qua. */
const START_GRACE_MS = 5 * 60 * 1000;

const CAPACITY_MESSAGE = 'Sức chứa phải từ 1 đến 25';

const createSchema = z.object({
  startsAt: z.date(),
  modeId: z.number().int(),
  capacity: z.number().int(CAPACITY_MESSAGE).min(1, CAPACITY_MESSAGE).max(25, CAPACITY_MESSAGE).default(16),
  roomCode: z.string().trim().max(20, 'Mã phòng tối đa 20 ký tự').nullish(),
  note: z.string().trim().max(300, 'Ghi chú tối đa 300 ký tự').nullish(),
});

/** Lỗi zod không có thông báo riêng (sai kiểu, ngày không hợp lệ) → thông báo chung tiếng Việt. */
const defaultErrorMap: z.ZodErrorMap = () => ({ message: 'Dữ liệu không hợp lệ' });

/**
 * Tạo buổi chơi rồi đăng tin Discord. Lỗi dữ liệu → `VALIDATION` với thông báo
 * tiếng Việt; Discord sập thì buổi vẫn được tạo (đánh dấu `discordDirty`).
 */
export async function createSession(ctx: Ctx, actorId: number, input: CreateSessionInput): Promise<SessionView> {
  const parsed = createSchema.safeParse(input, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  const { startsAt, modeId, capacity, roomCode, note } = parsed.data;

  if (startsAt.getTime() < ctx.now().getTime() - START_GRACE_MS) {
    throw appError('VALIDATION', 'Giờ bắt đầu đã qua');
  }
  const mode = await ctx.db.gameMode.findUnique({ where: { id: modeId }, select: { active: true } });
  if (!mode?.active) throw appError('VALIDATION', 'Chế độ chơi không hợp lệ');

  const created = await ctx.db.gameSession.create({
    data: {
      startsAt,
      modeId,
      capacity,
      roomCode: emptyToNull(roomCode),
      note: emptyToNull(note),
      status: 'scheduled',
      createdById: actorId,
    },
    select: { id: true },
  });

  await syncSessionMessage(ctx, created.id);
  return getSessionView(ctx, created.id);
}

function emptyToNull(s: string | null | undefined): string | null {
  return s ? s : null;
}

// ---------------------------------------------------------------------------
// Điểm danh
// ---------------------------------------------------------------------------

/**
 * Tham gia (`going = true`) hoặc rời (`false`) một buổi. Idempotent: bấm lại khi
 * trạng thái không đổi thì không đụng dòng điểm danh (giữ giờ tham gia ban đầu).
 *
 * Trong một giao dịch, khoá dòng buổi trước mọi kiểm tra để các lời gọi cùng lúc
 * xếp hàng: người đến sau thấy số chỗ đã cập nhật, nên không bao giờ vượt sức chứa.
 * Lỗi: buổi không có → `NOT_FOUND`; không còn `scheduled` → `SESSION_NOT_OPEN`;
 * thành viên không có / đã rời server → `FORBIDDEN`; hết chỗ → `SESSION_FULL`.
 */
export async function setAttendance(
  ctx: Ctx,
  sessionId: number,
  memberId: number,
  going: boolean,
): Promise<SessionView> {
  await ctx.db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM game_sessions WHERE id = ${sessionId} FOR UPDATE`;
    if (locked.length === 0) throw appError('NOT_FOUND');

    const session = await tx.gameSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true, capacity: true },
    });
    if (session.status !== 'scheduled') throw appError('SESSION_NOT_OPEN');

    const member = await tx.member.findUnique({ where: { id: memberId }, select: { status: true } });
    if (member?.status !== 'active') throw appError('FORBIDDEN');

    const where = { sessionId_memberId: { sessionId, memberId } };
    const current = await tx.attendance.findUnique({ where, select: { status: true } });
    const isGoing = current?.status === 'going';
    if (going === isGoing) return; // Không đổi gì — kể cả rời một buổi chưa từng tham gia.

    if (going) {
      const taken = await tx.attendance.count({
        where: { sessionId, status: 'going', member: { status: 'active' } },
      });
      if (taken >= session.capacity) throw appError('SESSION_FULL');
    }

    // Ghi rõ updatedAt = ctx.now() để đè @updatedAt (đồng hồ thật) — Task 10 dựa vào mốc này.
    const status = going ? 'going' : 'cancelled';
    if (current) await tx.attendance.update({ where, data: { status, updatedAt: ctx.now() } });
    else await tx.attendance.create({ data: { sessionId, memberId, status, updatedAt: ctx.now() } });
  });

  await syncSessionMessage(ctx, sessionId);
  return getSessionView(ctx, sessionId);
}

// ---------------------------------------------------------------------------
// Huỷ buổi
// ---------------------------------------------------------------------------

/**
 * Huỷ một buổi còn `scheduled` (khác → `SESSION_NOT_OPEN`), DM từng người đang
 * tham gia (một DM lỗi chỉ được ghi log, những người khác vẫn nhận), rồi sửa tin Discord.
 */
export async function cancelSession(ctx: Ctx, sessionId: number): Promise<void> {
  // Điều kiện trong WHERE để hai admin huỷ cùng lúc chỉ có một bên DM mọi người.
  const { count } = await ctx.db.gameSession.updateMany({
    where: { id: sessionId, status: 'scheduled' },
    data: { status: 'cancelled' },
  });
  if (count === 0) {
    const exists = await ctx.db.gameSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    throw appError(exists ? 'SESSION_NOT_OPEN' : 'NOT_FOUND');
  }

  // Đọc danh sách SAU khi đã huỷ: từ lúc này không ai vào thêm được, nên không sót DM ai.
  const row = await findSessionRow(ctx.db, sessionId);
  if (!row) throw appError('NOT_FOUND');

  const text = `Buổi chơi ${row.mode.nameVi} lúc ${formatVnTime(row.startsAt)} ngày ${formatVnDay(row.startsAt)} đã bị huỷ.`;
  for (const { member } of row.attendances) {
    try {
      await ctx.notifier.sendDm(member.discordId, text);
    } catch (err) {
      console.error(
        `[sessions] Không gửi được DM huỷ buổi ${sessionId} tới ${member.discordId}: ${messageOf(err)}`,
      );
    }
  }

  await syncSessionMessage(ctx, sessionId);
}

// ---------------------------------------------------------------------------
// Đồng bộ tin Discord
// ---------------------------------------------------------------------------

/**
 * Đăng (chưa có message id) hoặc sửa (đã có) tin Discord của buổi theo trạng thái
 * hiện tại. Không bao giờ ném lỗi: thành công → `discordDirty = false`; lỗi → ghi log
 * và `discordDirty = true` để bộ hẹn giờ thử lại. Buổi không tồn tại → chỉ ghi log.
 * Tin cũ đã bị xoá trong Discord (`MessageGoneError`) → bỏ id cũ và đăng tin mới ngay.
 *
 * Các lần đồng bộ của cùng một buổi chạy nối đuôi nhau trong tiến trình (web + bot
 * chung một tiến trình): hai người bấm gần như cùng lúc thì lần sau đọc trạng thái
 * sau khi lần trước đã gửi xong, nên tin Discord không bị một bản cũ đè lên bản mới.
 */
export function syncSessionMessage(ctx: Ctx, sessionId: number): Promise<void> {
  const previous = syncQueues.get(sessionId) ?? Promise.resolve();
  const run = previous.then(() => syncNow(ctx, sessionId)); // syncNow không bao giờ reject
  syncQueues.set(sessionId, run);
  return run.finally(() => {
    if (syncQueues.get(sessionId) === run) syncQueues.delete(sessionId);
  });
}

/** Lần đồng bộ đang chạy (hoặc xếp hàng) của từng buổi; xoá khi xong để không giữ mãi. */
const syncQueues = new Map<number, Promise<void>>();

async function syncNow(ctx: Ctx, sessionId: number): Promise<void> {
  try {
    const row = await findSessionRow(ctx.db, sessionId);
    if (!row) {
      console.error(`[sessions] Không đồng bộ được tin Discord: không có buổi ${sessionId}`);
      return;
    }
    const view = toSessionView(row);
    if (row.discordMessageId && (await updateExisting(ctx, sessionId, row.discordMessageId, view))) return;

    const messageId = await ctx.notifier.publishSession(view);
    await ctx.db.gameSession.update({
      where: { id: sessionId },
      data: { discordMessageId: messageId, discordDirty: false },
    });
  } catch (err) {
    console.error(`[sessions] Không đồng bộ được tin Discord của buổi ${sessionId}: ${messageOf(err)}`);
    await markDirty(ctx, sessionId);
  }
}

/**
 * Sửa tin đã đăng; thành công → xoá cờ, trả true. Tin không còn trong Discord
 * (`MessageGoneError`) → bỏ id cũ ngay (lần sau không sửa hụt nữa) và trả false
 * để đăng tin mới. Lỗi khác ném tiếp.
 */
async function updateExisting(ctx: Ctx, sessionId: number, messageId: string, view: SessionView): Promise<boolean> {
  try {
    await ctx.notifier.updateSession(messageId, view);
  } catch (err) {
    if (!(err instanceof MessageGoneError)) throw err;
    console.warn(`[sessions] Tin Discord ${messageId} của buổi ${sessionId} không còn tồn tại — đăng tin mới`);
    await ctx.db.gameSession.update({ where: { id: sessionId }, data: { discordMessageId: null } });
    return false;
  }
  await ctx.db.gameSession.update({ where: { id: sessionId }, data: { discordDirty: false } });
  return true;
}

async function markDirty(ctx: Ctx, sessionId: number): Promise<void> {
  try {
    // updateMany: không ném lỗi nếu buổi đã biến mất trong lúc đó.
    await ctx.db.gameSession.updateMany({ where: { id: sessionId }, data: { discordDirty: true } });
  } catch (err) {
    console.error(`[sessions] Không đánh dấu được discordDirty cho buổi ${sessionId}: ${messageOf(err)}`);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
