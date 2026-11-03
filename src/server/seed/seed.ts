import type { Prisma, PrismaClient } from '@prisma/client';
import { CATEGORIES } from './categories.js';
import { MODES } from './modes.js';
import { ROLES } from './roles.js';

/**
 * Nạp dữ liệu tham chiếu (chế độ, role, hạng mục). Chỉ tạo dòng còn thiếu —
 * không bao giờ ghi đè chỉnh sửa của admin, nên chạy lại bao nhiêu lần cũng an toàn.
 */
export async function seedReferenceData(db: PrismaClient): Promise<void> {
  await db.$transaction(
    async (tx) => {
      const modeIdByKey = await seedModes(tx);
      await seedRoles(tx, modeIdByKey);
      await seedCategories(tx, modeIdByKey);
    },
    // ~110 truy vấn tuần tự; mặc định 5 giây có thể không đủ với DB ở xa.
    { timeout: 60_000 },
  );
}

async function seedModes(tx: Prisma.TransactionClient): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const mode of MODES) {
    const row = await tx.gameMode.upsert({
      where: { key: mode.key },
      update: {},
      create: mode,
      select: { id: true },
    });
    ids.set(mode.key, row.id);
  }
  return ids;
}

function requireModeId(modeIdByKey: Map<string, number>, modeKey: string, what: string): number {
  const id = modeIdByKey.get(modeKey);
  if (id === undefined) throw new Error(`Dữ liệu mẫu lỗi: ${what} tham chiếu chế độ không tồn tại "${modeKey}"`);
  return id;
}

async function seedRoles(tx: Prisma.TransactionClient, modeIdByKey: Map<string, number>): Promise<void> {
  for (const { modeKey, ...role } of ROLES) {
    const modeId = modeKey === null ? null : requireModeId(modeIdByKey, modeKey, `role "${role.key}"`);
    await tx.role.upsert({
      where: { key: role.key },
      update: {},
      create: { ...role, modeId },
      select: { id: true },
    });
  }
}

// award_categories không có khoá tự nhiên (admin đổi tên được) → chỉ nạp khi bảng
// còn trống; đã có dòng nào thì bỏ qua hoàn toàn (ruling R13).
async function seedCategories(tx: Prisma.TransactionClient, modeIdByKey: Map<string, number>): Promise<void> {
  if ((await tx.awardCategory.count()) > 0) return;
  for (const { modeKey, ...category } of CATEGORIES) {
    const modeId = modeKey === null ? null : requireModeId(modeIdByKey, modeKey, `hạng mục "${category.name}"`);
    await tx.awardCategory.create({ data: { ...category, modeId }, select: { id: true } });
  }
}
