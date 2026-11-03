import { db } from '../db.js';
import { seedReferenceData } from './seed.js';

try {
  await seedReferenceData(db);
  console.log('Đã nạp dữ liệu tham chiếu.');
} catch (err) {
  console.error('Nạp dữ liệu tham chiếu thất bại.', err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
