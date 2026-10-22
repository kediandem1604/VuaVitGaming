import { db } from '../../src/server/db.js';
import { seedReferenceData } from '../../src/server/seed/seed.js';

// Cùng một PrismaClient với code ứng dụng; setup.ts đã trỏ nó sang DB test.
export const testDb = db;

/** Xoá sạch dữ liệu (trừ lịch sử migration), đặt lại mọi id/sequence, nạp lại dữ liệu mẫu. */
export async function resetDb(): Promise<void> {
  const tables = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const quoted = tables.map((t) => `"${t.tablename.replaceAll('"', '""')}"`).join(', ');
  await testDb.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  await testDb.$executeRawUnsafe('ALTER SEQUENCE member_code_seq RESTART WITH 1');
  await seedReferenceData(testDb);
}
