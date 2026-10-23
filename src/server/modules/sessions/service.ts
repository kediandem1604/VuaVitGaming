/**
 * Module buổi chơi: tạo buổi, sửa buổi (mã phòng, ghi chú, sức chứa, giờ bắt đầu),
 * điểm danh (tham gia / rời), huỷ buổi, danh sách theo ngày VN và đồng bộ tin Discord
 * của buổi.
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
import { HOT_TX } from '../../lib/tx.js';
import { MessageGoneError } from '../../ports.js';
import type { SessionView } from '../../ports.js';
import { reminderKindsNotYetDue } from '../reminders/windows.js';
import { getSettings } from '../settings/service.js';

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

// Ràng buộc từng trường, dùng chung cho tạo và sửa buổi.
const capacityField = z.number().int(CAPACITY_MESSAGE).min(1, CAPACITY_MESSAGE).max(25, CAPACITY_MESSAGE);
const roomCodeField = z.string().trim().max(20, 'Mã phòng tối đa 20 ký tự').nullish();
const noteField = z.string().trim().max(300, 'Ghi chú tối đa 300 ký tự').nullish();

const createSchema = z.object({
  startsAt: z.date(),
  modeId: z.number().int(),
  capacity: capacityField.default(16),
  roomCode: roomCodeField,
  note: noteField,
});

/** Lỗi zod không có thông báo riêng (sai kiểu, ngày không hợp lệ) → thông báo chung tiếng Việt. */
const defaultErrorMap: z.ZodErrorMap = () => ({ message: 'Dữ liệu không hợp lệ' });

/**
 * Tạo buổi chơi rồi đăng tin Discord. Lỗi dữ liệu → `VALIDATION` với thông báo
 * tiếng Việt. Buổi được lưu sẵn với `discordDirty = true` (lần đồng bộ thành công mới
 * xoá): Discord sập — hay tiến trình chết ngay sau khi lưu — thì buổi vẫn được tạo và bộ
 * hẹn giờ đăng bù tin.
 */
export async function createSession(ctx: Ctx, actorId: number, input: CreateSessionInput): Promise<SessionView> {
  const parsed = createSchema.safeParse(input, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  const { startsAt, modeId, capacity, roomCode, note } = parsed.data;

  assertNotPast(ctx, startsAt);
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
      discordDirty: true,
    },
    select: { id: true },
  });

  await syncSessionMessage(ctx, created.id);
  return getSessionView(ctx, created.id);
}

function emptyToNull(s: string | null | undefined): string | null {
  return s ? s : null;
}

function assertNotPast(ctx: Ctx, startsAt: Date): void {
  if (startsAt.getTime() < ctx.now().getTime() - START_GRACE_MS) {
    throw appError('VALIDATION', 'Giờ bắt đầu đã qua');
  }
}

// ---------------------------------------------------------------------------
// Sửa buổi
// ---------------------------------------------------------------------------

/** Trường vắng mặt (`undefined`) giữ nguyên; mã phòng / ghi chú `null` hoặc rỗng → xoá. */
export interface UpdateSessionPatch {
  startsAt?: Date;
  /** 1–25, không nhỏ hơn số người đang tham gia. */
  capacity?: number;
  /** Cắt khoảng trắng, tối đa 20 ký tự; rỗng hoặc null → xoá mã phòng. */
  roomCode?: string | null;
  /** Cắt khoảng trắng, tối đa 300 ký tự; rỗng hoặc null → xoá ghi chú. */
  note?: string | null;
}

const updateSchema = z.object({
  startsAt: z.date().optional(),
  capacity: capacityField.optional(),
  roomCode: roomCodeField,
  note: noteField,
});

/**
 * Sửa một buổi còn `scheduled` (khác → `SESSION_NOT_OPEN`, không có → `NOT_FOUND`) — thường
 * là thêm mã phòng ngay trước giờ chơi. Lỗi dữ liệu → `VALIDATION`, cùng luật với
 * `createSession`; sức chứa mới nhỏ hơn số người đang tham gia cũng là `VALIDATION`. Giờ
 * mới chỉ bị kiểm "đã qua" khi giờ thật sự đổi, nên vẫn thêm được mã phòng sau giờ bắt đầu.
 *
 * Trong một giao dịch, khoá dòng buổi (như `setAttendance`) rồi mới đếm chỗ, nên không ai
 * vào chen được giữa lúc kiểm và lúc giảm sức chứa. Chỉ ghi khi có gì thật sự đổi; câu
 * UPDATE đó bật luôn `discordDirty` để tin Discord được sửa lại (cả khi tiến trình chết
 * trước lúc kịp sửa). Không đổi gì → không ghi, không đụng Discord.
 *
 * Đổi giờ bắt đầu: xoá trong cùng giao dịch các dòng `notification_log` của buổi thuộc loại
 * nhắc CHƯA tới hạn theo giờ mới, để nhắc được gửi lại theo giờ mới; loại đã tới hạn theo
 * giờ mới thì giữ (đã nhắc thì không nhắc lần hai). Bộ gửi nhắc chỉ ghi log khi giờ bắt đầu
 * vẫn đúng giờ nó đã đọc (khoá chia sẻ dòng buổi), nên lần chạy đang dở với giờ cũ không
 * chen log cũ vào sau khi giờ đã đổi.
 *
 * `actorId` chỉ dùng để ghi log ai đã sửa.
 */
export async function updateSession(
  ctx: Ctx,
  actorId: number,
  sessionId: number,
  patch: UpdateSessionPatch,
): Promise<SessionView> {
  const parsed = updateSchema.safeParse(patch, { errorMap: defaultErrorMap });
  if (!parsed.success) throw appError('VALIDATION', parsed.error.issues[0]?.message);
  const { startsAt, capacity, roomCode, note } = parsed.data;
  // Đọc ngoài giao dịch: chỉ cần khi đổi giờ, và không giữ khoá dòng buổi lâu hơn cần thiết.
  const lead = startsAt === undefined ? null : (await getSettings(ctx)).reminderLeadMinutes;

  const changedFields = await ctx.db.$transaction(async (tx): Promise<string[]> => {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM game_sessions WHERE id = ${sessionId} FOR UPDATE`;
    if (locked.length === 0) throw appError('NOT_FOUND');

    const current = await tx.gameSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true, startsAt: true, capacity: true, roomCode: true, note: true },
    });
    if (current.status !== 'scheduled') throw appError('SESSION_NOT_OPEN');

    const data: Prisma.GameSessionUpdateInput = {};
    if (roomCode !== undefined && emptyToNull(roomCode) !== current.roomCode) data.roomCode = emptyToNull(roomCode);
    if (note !== undefined && emptyToNull(note) !== current.note) data.note = emptyToNull(note);
    if (capacity !== undefined && capacity !== current.capacity) {
      const taken = await tx.attendance.count({
        where: { sessionId, status: 'going', member: { status: 'active' } },
      });
      if (capacity < taken) {
        throw appError('VALIDATION', `Đã có ${taken} người tham gia, sức chứa không được nhỏ hơn ${taken}`);
      }
      data.capacity = capacity;
    }
    const newStart = startsAt !== undefined && startsAt.getTime() !== current.startsAt.getTime() ? startsAt : null;
    if (newStart) {
      assertNotPast(ctx, newStart);
      data.startsAt = newStart;
    }
    const fields = Object.keys(data);
    if (fields.length === 0) return fields;

    await tx.gameSession.update({ where: { id: sessionId }, data: { ...data, discordDirty: true } });
    if (newStart && lead !== null) {
      const kinds = reminderKindsNotYetDue(newStart, ctx.now(), lead);
      if (kinds.length > 0) await tx.notificationLog.deleteMany({ where: { sessionId, kind: { in: kinds } } });
    }
    return fields;
  }, HOT_TX);

  if (changedFields.length > 0) {
    console.log(`[sessions] Thành viên ${actorId} đã sửa buổi ${sessionId}: ${changedFields.join(', ')}`);
    await syncSessionMessage(ctx, sessionId);
  }
  return getSessionView(ctx, sessionId);
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
 * Có thay đổi thì cùng giao dịch đánh dấu `discordDirty` trên dòng buổi đã khoá, nên
 * tiến trình chết giữa lúc lưu và lúc sửa tin Discord vẫn được bộ hẹn giờ sửa bù.
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
    await tx.gameSession.update({ where: { id: sessionId }, data: { discordDirty: true } });
  }, HOT_TX);

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
  // Điều kiện trong WHERE để hai admin huỷ cùng lúc chỉ có một bên DM mọi người. Cờ
  // `discordDirty` bật cùng lúc: chết trước khi kịp sửa tin thì bộ hẹn giờ sửa bù.
  const { count } = await ctx.db.gameSession.updateMany({
    where: { id: sessionId, status: 'scheduled' },
    data: { status: 'cancelled', discordDirty: true },
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
 * hiện tại. Không bao giờ ném lỗi; lỗi → ghi log và `discordDirty = true` để bộ hẹn giờ
 * thử lại. Buổi không tồn tại → chỉ ghi log. Tin cũ đã bị xoá trong Discord
 * (`MessageGoneError`) → đăng tin mới ngay, id mới thay id cũ.
 *
 * Các lần đồng bộ của cùng một buổi chạy nối đuôi nhau trong tiến trình (web + bot
 * chung một tiến trình): hai người bấm gần như cùng lúc thì lần sau đọc trạng thái
 * sau khi lần trước đã gửi xong, nên tin Discord không bị một bản cũ đè lên bản mới.
 * Mỗi buổi có tối đa MỘT lần đang chờ (chưa bắt đầu): người gọi đến khi đã có lần chờ
 * thì dùng chung lần đó — nó đọc trạng thái lúc bắt đầu chạy, tức là sau mọi thay đổi
 * của họ — nên cả hội bấm dồn dập chỉ tốn lần đang chạy + một lần sửa tin, không phải
 * mỗi lần bấm một lần (Discord giới hạn tốc độ sửa tin). Lần chờ dùng `ctx` của người
 * gọi đầu tiên (mọi người gọi trong tiến trình dùng chung một ctx).
 */
export function syncSessionMessage(ctx: Ctx, sessionId: number): Promise<void> {
  const queue = syncQueues.get(sessionId);
  if (queue?.pending) return queue.pending;

  const entry: SyncQueue = queue ?? { tail: Promise.resolve(), pending: null };
  const previous = entry.tail;
  let run: Promise<void>;
  const task = (): Promise<void> => {
    if (entry.pending === run) entry.pending = null; // đã bắt đầu: người gọi sau xếp lần mới
    return syncNow(ctx, sessionId);
  };
  // syncNow không bao giờ reject; `then(task, task)` để một lần lỗi lạ cũng không chặn hàng.
  run = previous.then(task, task);
  entry.pending = run;
  entry.tail = run;
  syncQueues.set(sessionId, entry);

  const cleanup = (): void => {
    if (syncQueues.get(sessionId) === entry && entry.tail === run) syncQueues.delete(sessionId);
  };
  run.then(cleanup, cleanup);
  return run;
}

interface SyncQueue {
  /** Lần đồng bộ cuối cùng đã xếp hàng (đang chạy hoặc đang chờ). */
  tail: Promise<void>;
  /** Lần đang chờ, chưa bắt đầu — người gọi mới dùng chung; null khi không có. */
  pending: Promise<void> | null;
}

/** Hàng đồng bộ của từng buổi; xoá khi lần cuối xong để không giữ mãi. */
const syncQueues = new Map<number, SyncQueue>();

/**
 * Một lần đồng bộ. Cờ `discordDirty` chỉ được xoá SAU KHI Discord đã nhận bản mới, và chỉ
 * khi dòng buổi chưa bị ghi gì kể từ lúc đọc — nên tiến trình chết giữa lúc gọi Discord
 * (OOM, SIGKILL, thoát khi phiên Discord bị vô hiệu) để lại dòng còn bẩn, bộ hẹn giờ sửa bù.
 *
 * "Chưa bị ghi gì" dựa vào cột hệ thống `xmin` của PostgreSQL (mã giao dịch đã ghi phiên
 * bản dòng hiện tại): mọi nơi đánh dấu bẩn (tạo buổi, điểm danh, trả chỗ khi rời server,
 * kết thúc, huỷ) đều UPDATE dòng buổi trong cùng giao dịch với thay đổi của họ, và UPDATE
 * nào cũng tạo phiên bản mới — kể cả ghi lại đúng giá trị cũ; khoá dòng thì không. Đọc
 * `xmin` TRƯỚC khi đọc buổi và người tham gia: thay đổi commit trước mốc đó nằm trong bản
 * gửi đi; thay đổi commit sau mốc đó đổi `xmin`, câu xoá cờ có điều kiện không khớp và
 * dòng vẫn bẩn (READ COMMITTED: UPDATE gặp phiên bản mới hơn thì xét lại điều kiện trên
 * phiên bản mới nhất).
 *
 * Lỗi → ghi log và bật cờ (phòng khi dòng đang sạch, vd bấm lại khi không có gì đổi); với
 * dòng có thay đổi, cờ vốn đã bật nên bật lại hỏng (DB chập chờn) cũng không mất gì.
 */
async function syncNow(ctx: Ctx, sessionId: number): Promise<void> {
  try {
    const version = await rowVersion(ctx, sessionId);
    const row = version === null ? null : await findSessionRow(ctx.db, sessionId);
    if (version === null || !row) {
      console.error(`[sessions] Không đồng bộ được tin Discord: không có buổi ${sessionId}`);
      return;
    }
    const view = toSessionView(row);
    if (row.discordMessageId && (await updateExisting(ctx, sessionId, row.discordMessageId, view))) {
      await ctx.db.$executeRaw`
        UPDATE game_sessions SET discord_dirty = false
        WHERE id = ${sessionId} AND discord_dirty AND xmin::text = ${version}
      `;
      return;
    }

    // Tin mới (hoặc tin cũ đã bị xoá): lưu id mới và xoá cờ trong CÙNG một câu — một lần ghi
    // riêng trước đó sẽ đổi `xmin` và che mất dấu "cần sửa lại" ghi chen vào lúc đang đăng.
    const messageId = await ctx.notifier.publishSession(view);
    await ctx.db.$executeRaw`
      UPDATE game_sessions
      SET discord_message_id = ${messageId},
          discord_dirty = CASE WHEN xmin::text = ${version} THEN false ELSE discord_dirty END
      WHERE id = ${sessionId}
    `;
  } catch (err) {
    console.error(`[sessions] Không đồng bộ được tin Discord của buổi ${sessionId}: ${messageOf(err)}`);
    await markDirty(ctx, sessionId);
  }
}

/** `xmin` (dạng chuỗi) của phiên bản hiện tại của dòng buổi — đổi sau mỗi lần ghi; không có buổi → null. */
async function rowVersion(ctx: Ctx, sessionId: number): Promise<string | null> {
  const rows = await ctx.db.$queryRaw<{ version: string }[]>`
    SELECT xmin::text AS version FROM game_sessions WHERE id = ${sessionId}
  `;
  return rows[0]?.version ?? null;
}

/**
 * Sửa tin đã đăng; thành công → trả true. Tin không còn trong Discord
 * (`MessageGoneError`) → trả false để đăng tin mới (id mới thay id cũ khi đăng xong;
 * đăng hỏng thì lần thử lại gặp lại "tin đã mất" rồi đăng). Lỗi khác ném tiếp.
 */
async function updateExisting(ctx: Ctx, sessionId: number, messageId: string, view: SessionView): Promise<boolean> {
  try {
    await ctx.notifier.updateSession(messageId, view);
  } catch (err) {
    if (!(err instanceof MessageGoneError)) throw err;
    console.warn(`[sessions] Tin Discord ${messageId} của buổi ${sessionId} không còn tồn tại — đăng tin mới`);
    return false;
  }
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
