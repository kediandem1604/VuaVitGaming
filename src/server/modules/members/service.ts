/**
 * Module thành viên: mã thành viên, đồng bộ từ Discord, hồ sơ và danh sách.
 *
 * Cả bot Discord lẫn web đều gọi vào đây; module không nói chuyện trực tiếp với
 * Discord — mọi thông tin guild đi vào qua `GuildMemberInfo`.
 */

import { Prisma } from '@prisma/client';
import type { AccessLevel, Member, MemberStatus } from '@prisma/client';
import { z } from 'zod';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { HOT_TX } from '../../lib/tx.js';
import type { GuildMemberInfo } from '../../ports.js';

// ---------------------------------------------------------------------------
// Mã thành viên
// ---------------------------------------------------------------------------

/** `GGD-` + số đệm 4 chữ số (`GGD-0001`); quá 9999 thì để nguyên (`GGD-10000`). */
export function formatMemberCode(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Số mã thành viên không hợp lệ: ${n}`);
  return `GGD-${String(n).padStart(4, '0')}`;
}

/** Lấy số kế tiếp từ sequence `member_code_seq` — mỗi lần gọi tiêu một số. */
export async function nextMemberCodeNumber(db: Prisma.TransactionClient): Promise<number> {
  const [row] = await db.$queryRaw<{ n: number }[]>`SELECT nextval('member_code_seq')::int AS n`;
  if (!row) throw new Error('Không lấy được số từ member_code_seq');
  return row.n;
}

// ---------------------------------------------------------------------------
// Quyền từ role Discord
// ---------------------------------------------------------------------------

/** admin nếu có bất kỳ role admin nào; nếu không, mod nếu có role mod; còn lại là member. */
export function accessLevelFromRoles(
  roleIds: string[],
  cfg: { adminRoleIds: string[]; modRoleIds: string[] },
): AccessLevel {
  if (roleIds.some((id) => cfg.adminRoleIds.includes(id))) return 'admin';
  if (roleIds.some((id) => cfg.modRoleIds.includes(id))) return 'mod';
  return 'member';
}

// ---------------------------------------------------------------------------
// Đồng bộ từ Discord
// ---------------------------------------------------------------------------

export interface UpsertMemberResult {
  member: Member;
  /** Lần đầu thấy discordId này — vừa cấp mã mới. */
  created: boolean;
  /** Đã rời hội trước đó, nay quay lại — giữ nguyên mã cũ. */
  reactivated: boolean;
}

/**
 * Tạo mới hoặc cập nhật thành viên theo thông tin guild. Tên, avatar và quyền luôn
 * lấy theo Discord; người đã rời được kích hoạt lại. An toàn khi hai lời gọi cho
 * cùng một discordId mới chạy song song (bot join + bấm nút): bên thua cuộc đua
 * cập nhật dòng bên thắng vừa tạo thay vì ném lỗi hay tạo dòng trùng.
 */
export async function upsertMemberFromGuild(ctx: Ctx, info: GuildMemberInfo): Promise<UpsertMemberResult> {
  const existing = await ctx.db.member.findUnique({ where: { discordId: info.discordId } });
  if (existing) return refreshFromGuild(ctx, existing, info);

  try {
    const member = await ctx.db.member.create({
      data: {
        discordId: info.discordId,
        memberCode: formatMemberCode(await nextMemberCodeNumber(ctx.db)),
        displayName: info.displayName,
        avatarUrl: info.avatarUrl,
        accessLevel: accessLevelFromRoles(info.roleIds, ctx.config.discord),
        status: 'active',
        joinedAt: ctx.now(),
      },
    });
    return { member, created: true, reactivated: false };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Bên kia vừa tạo xong dòng này; số sequence bên thua đã lấy bị bỏ (mã có thể hở).
    const winner = await ctx.db.member.findUnique({ where: { discordId: info.discordId } });
    if (!winner) throw err; // Đụng unique khác (vd member_code) — không phải cuộc đua này.
    return refreshFromGuild(ctx, winner, info);
  }
}

async function refreshFromGuild(ctx: Ctx, existing: Member, info: GuildMemberInfo): Promise<UpsertMemberResult> {
  const member = await ctx.db.member.update({
    where: { id: existing.id },
    data: {
      displayName: info.displayName,
      avatarUrl: info.avatarUrl,
      accessLevel: accessLevelFromRoles(info.roleIds, ctx.config.discord),
      status: 'active',
      leftAt: null,
    },
  });
  return { member, created: false, reactivated: existing.status === 'left' };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Đánh dấu rời hội và xoá phiên web. discordId không có trong DB → không làm gì. */
export async function markMemberLeft(ctx: Ctx, discordId: string): Promise<void> {
  await markLeft(ctx, { discordId });
}

/**
 * Đồng bộ toàn bộ danh sách guild: upsert từng người, rồi đánh dấu rời hội mọi
 * thành viên đang hoạt động mà không có trong `infos`. Người gọi phải truyền danh
 * sách đầy đủ — danh sách rỗng nghĩa là tất cả đã rời.
 */
export async function syncGuildMembers(
  ctx: Ctx,
  infos: GuildMemberInfo[],
): Promise<{ created: number; left: number }> {
  let created = 0;
  for (const info of infos) {
    if ((await upsertMemberFromGuild(ctx, info)).created) created += 1;
  }
  const left = await markLeft(ctx, { discordId: { notIn: infos.map((i) => i.discordId) } });
  return { created, left };
}

/**
 * Chuyển mọi thành viên `active` khớp `where` sang `left` (leftAt = bây giờ), xoá
 * phiên web của họ và trả chỗ họ đang giữ ở các buổi chưa diễn ra, trong một giao
 * dịch, bằng truy vấn theo tập hợp (không lặp từng người). Người đã `left` giữ nguyên
 * mốc rời cũ và không bị đụng tới. Trả về số người vừa chuyển.
 */
async function markLeft(ctx: Ctx, where: Prisma.MemberWhereInput): Promise<number> {
  return ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    await tx.webSession.deleteMany({ where: { member: where } });

    const leaving = await tx.member.findMany({ where: { ...where, status: 'active' }, select: { id: true } });
    if (leaving.length === 0) return 0;
    const memberIds = leaving.map((m) => m.id);

    const { count } = await tx.member.updateMany({
      where: { id: { in: memberIds }, status: 'active' },
      data: { status: 'left', leftAt: now },
    });
    await releaseSeats(tx, memberIds, now);
    return count;
  }, HOT_TX);
}

/**
 * Huỷ chỗ `going` của những người này ở các buổi còn `scheduled` (buổi đã kết thúc giữ
 * nguyên lịch sử) và đánh dấu `discordDirty` để bộ hẹn giờ sửa lại tin Discord — module
 * thành viên không gọi Discord. Quay lại server không trả lại chỗ.
 *
 * Khoá các dòng buổi liên quan (`FOR UPDATE`, theo id tăng dần) TRƯỚC khi đụng dòng điểm
 * danh — cùng thứ tự buổi → điểm danh với `setAttendance`. Ngược thứ tự thì người rời
 * server đúng lúc bấm "Huỷ" ở một buổi sẽ làm hai giao dịch chờ nhau (deadlock). Trạng
 * thái buổi được kiểm tra lại sau khi khoá: buổi vừa kết thúc trong lúc đó giữ nguyên lịch sử.
 */
async function releaseSeats(tx: Prisma.TransactionClient, memberIds: number[], now: Date): Promise<void> {
  const seats = await tx.attendance.findMany({
    where: { memberId: { in: memberIds }, status: 'going', session: { status: 'scheduled' } },
    select: { sessionId: true },
  });
  if (seats.length === 0) return;
  const candidates = [...new Set(seats.map((s) => s.sessionId))].sort((a, b) => a - b);

  const locked = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM game_sessions
    WHERE id IN (${Prisma.join(candidates)}) AND status = 'scheduled'
    ORDER BY id
    FOR UPDATE
  `;
  if (locked.length === 0) return;
  const sessionIds = locked.map((s) => s.id);

  await tx.attendance.updateMany({
    where: { memberId: { in: memberIds }, sessionId: { in: sessionIds }, status: 'going' },
    data: { status: 'cancelled', updatedAt: now },
  });
  await tx.gameSession.updateMany({ where: { id: { in: sessionIds } }, data: { discordDirty: true } });
}

// ---------------------------------------------------------------------------
// Hồ sơ và email
// ---------------------------------------------------------------------------

const emailSchema = z.string().email();

const profilePatchSchema = z.object({
  email: z.string().nullable().optional(),
  notifyEmail: z.boolean().optional(),
  notifyDm: z.boolean().optional(),
});

export interface ProfilePatch {
  /** `null` hoặc chuỗi rỗng xoá email. */
  email?: string | null;
  notifyEmail?: boolean;
  notifyDm?: boolean;
}

/** Cập nhật hồ sơ do người dùng tự sửa. Email được cắt khoảng trắng, giữ nguyên hoa/thường. */
export async function updateProfile(ctx: Ctx, memberId: number, patch: ProfilePatch): Promise<Member> {
  const parsed = profilePatchSchema.safeParse(patch);
  if (!parsed.success) throw appError('VALIDATION');
  const { email, notifyEmail, notifyDm } = parsed.data;

  const data: Prisma.MemberUpdateInput = {};
  if (email !== undefined) data.email = normaliseEmail(email);
  if (notifyEmail !== undefined) data.notifyEmail = notifyEmail;
  if (notifyDm !== undefined) data.notifyDm = notifyDm;

  const exists = await ctx.db.member.findUnique({ where: { id: memberId }, select: { id: true } });
  if (!exists) throw appError('NOT_FOUND');
  return ctx.db.member.update({ where: { id: memberId }, data });
}

function normaliseEmail(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = emailSchema.safeParse(trimmed);
  if (!parsed.success) throw appError('VALIDATION', 'Email không hợp lệ');
  return parsed.data;
}

/**
 * Email từ Discord OAuth: chỉ ghi khi Discord đã xác minh, email hợp lệ và thành viên
 * chưa có email. Không bao giờ ghi đè email người dùng tự nhập; không ném lỗi để
 * đăng nhập không bị chặn vì một email lạ.
 */
export async function recordOAuthEmail(
  ctx: Ctx,
  memberId: number,
  email: string | null,
  verified: boolean,
): Promise<void> {
  if (!verified || !email) return;
  const parsed = emailSchema.safeParse(email.trim());
  if (!parsed.success) return;
  await ctx.db.member.updateMany({ where: { id: memberId, email: null }, data: { email: parsed.data } });
}

// ---------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------

/**
 * Danh sách thành viên sắp theo mã tăng dần. `q` khớp một phần tên hiển thị, mã
 * hoặc discordId, không phân biệt hoa thường; chuỗi trống/toàn khoảng trắng = không lọc.
 */
export async function listMembers(ctx: Ctx, filter: { status?: MemberStatus; q?: string } = {}): Promise<Member[]> {
  const where: Prisma.MemberWhereInput = {};
  if (filter.status) where.status = filter.status;

  const q = filter.q?.trim();
  if (q) {
    const match = { contains: escapeLike(q), mode: 'insensitive' as const };
    where.OR = [{ displayName: match }, { memberCode: match }, { discordId: match }];
  }

  return ctx.db.member.findMany({ where, orderBy: { memberCode: 'asc' } });
}

/** `avatarUrl` theo id của những thành viên này, một truy vấn; id không có thì vắng trong Map. */
export async function avatarUrlsByMemberId(ctx: Ctx, memberIds: number[]): Promise<Map<number, string | null>> {
  if (memberIds.length === 0) return new Map();
  const rows = await ctx.db.member.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, avatarUrl: true },
  });
  return new Map(rows.map((r) => [r.id, r.avatarUrl]));
}

/**
 * Prisma đưa `contains` thẳng vào `ILIKE '%…%'` mà không thoát ký tự đặc biệt, nên
 * `%`, `_` và `\` phải được thoát để người dùng tìm đúng chữ mình gõ.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Lời chào
// ---------------------------------------------------------------------------

/** Tin nhắn DM chào thành viên mới (hoặc quay lại) kèm mã và link đăng nhập. */
export function buildWelcomeText(
  member: Pick<Member, 'displayName' | 'memberCode'>,
  publicUrl: string,
  rejoined: boolean,
): string {
  const greeting = rejoined
    ? `Chào mừng trở lại, ${member.displayName}!`
    : `Chào mừng ${member.displayName} đến với hội Goose Goose Duck! 🪿`;
  return `${greeting}\nMã thành viên của bạn: ${member.memberCode}\nĐăng nhập hệ thống: ${publicUrl}`;
}
