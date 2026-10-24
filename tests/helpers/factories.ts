import type { GameSession, Member, Prisma, PrismaClient, Role } from '@prisma/client';
import { formatMemberCode, nextMemberCodeNumber } from '../../src/server/modules/members/service.js';

/**
 * Tạo thành viên với giá trị mặc định hợp lý. `memberCode` cấp từ sequence
 * `member_code_seq` (cùng định dạng production, `GGD-0001`) nếu không truyền vào;
 * `discordId`/`displayName` mặc định (`d-N`, `Member N`) lấy cùng số N với mã,
 * nên chúng về 1 sau `resetDb` và luôn khớp mã. Ghi đè bất kỳ cột nào qua `p`.
 */
export async function createMember(
  db: PrismaClient,
  p: Partial<Prisma.MemberUncheckedCreateInput> = {},
): Promise<Member> {
  const n = (p.memberCode === undefined ? null : numberFromCode(p.memberCode)) ?? (await nextMemberCodeNumber(db));
  return db.member.create({
    data: {
      discordId: `d-${n}`,
      displayName: `Member ${n}`,
      email: null,
      notifyEmail: true,
      notifyDm: true,
      accessLevel: 'member',
      status: 'active',
      ...p,
      memberCode: p.memberCode ?? formatMemberCode(n),
    },
  });
}

/** Số N trong mã tuỳ chỉnh dạng `GGD-N` (để mặc định d-N ↔ GGD-N vẫn khớp); dạng khác → null. */
function numberFromCode(code: string): number | null {
  const digits = /^GGD-(\d+)$/.exec(code)?.[1];
  return digits === undefined ? null : Number(digits);
}

/** Mặc định của `createSession`: 21:00 ngày 22/10/2026 giờ VN = now mặc định + 2 giờ. */
export const DEFAULT_SESSION_STARTS_AT = '2026-10-22T14:00:00Z';

/**
 * Tạo buổi chơi: mặc định chế độ `classic` (hoặc `modeKey`), bắt đầu lúc
 * `DEFAULT_SESSION_STARTS_AT`, trạng thái `scheduled`, sức chứa 16.
 * Người tạo: `createdById` nếu truyền, nếu không lấy thành viên đầu tiên trong DB,
 * không có thì tạo mới một người.
 */
export async function createSession(
  db: PrismaClient,
  p: Partial<Prisma.GameSessionUncheckedCreateInput> & { modeKey?: string } = {},
): Promise<GameSession> {
  const { modeKey, ...rest } = p;
  const modeId = rest.modeId ?? (await modeIdByKey(db, modeKey ?? 'classic'));
  const createdById = rest.createdById ?? (await anyMemberId(db));
  return db.gameSession.create({
    data: {
      startsAt: new Date(DEFAULT_SESSION_STARTS_AT),
      status: 'scheduled',
      capacity: 16,
      ...rest,
      modeId,
      createdById,
    },
  });
}

/** Role theo `key` trong dữ liệu mẫu; ném lỗi rõ ràng nếu không có. */
export async function roleByKey(db: PrismaClient, key: string): Promise<Role> {
  const role = await db.role.findUnique({ where: { key } });
  if (!role) throw new Error(`Không có role với key "${key}" trong dữ liệu mẫu`);
  return role;
}

async function modeIdByKey(db: PrismaClient, key: string): Promise<number> {
  const mode = await db.gameMode.findUnique({ where: { key }, select: { id: true } });
  if (!mode) throw new Error(`Không có chế độ chơi với key "${key}" trong dữ liệu mẫu`);
  return mode.id;
}

async function anyMemberId(db: PrismaClient): Promise<number> {
  const existing = await db.member.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
  return existing?.id ?? (await createMember(db)).id;
}
