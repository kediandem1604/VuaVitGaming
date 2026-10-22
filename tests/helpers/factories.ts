import type { GameSession, Member, Prisma, PrismaClient, Role } from '@prisma/client';

// Bộ đếm cho discordId/displayName mặc định — mỗi file test có module riêng nên tự về 0.
let memberCounter = 0;

/** Cấp mã thành viên tiếp theo từ sequence, cùng định dạng với production (`GGD-0001`). */
async function nextMemberCode(db: PrismaClient): Promise<string> {
  const [row] = await db.$queryRaw<{ n: number }[]>`SELECT nextval('member_code_seq')::int AS n`;
  if (!row) throw new Error('Không lấy được số từ member_code_seq');
  return `GGD-${String(row.n).padStart(4, '0')}`;
}

/**
 * Tạo thành viên với giá trị mặc định hợp lý; `memberCode` được cấp từ sequence
 * nếu không truyền vào. Ghi đè bất kỳ cột nào qua `p`.
 */
export async function createMember(
  db: PrismaClient,
  p: Partial<Prisma.MemberUncheckedCreateInput> = {},
): Promise<Member> {
  memberCounter += 1;
  const memberCode = p.memberCode ?? (await nextMemberCode(db));
  return db.member.create({
    data: {
      discordId: `d-${memberCounter}`,
      displayName: `Member ${memberCounter}`,
      email: null,
      notifyEmail: true,
      notifyDm: true,
      accessLevel: 'member',
      status: 'active',
      ...p,
      memberCode,
    },
  });
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
