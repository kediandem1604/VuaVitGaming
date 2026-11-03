import { PrismaClient } from '@prisma/client';

// Một PrismaClient duy nhất cho cả tiến trình (đọc DATABASE_URL từ môi trường).
export const db = new PrismaClient();
