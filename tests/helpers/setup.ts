// Chạy trước mỗi file test (setupFiles): trỏ Prisma sang DB test TRƯỚC khi
// @prisma/client được import, để .env (DB dev ở cổng 54329) không chen vào.
export const TEST_DATABASE_URL = 'postgresql://ggd:ggd@localhost:54330/ggd_test';

process.env.DATABASE_URL = TEST_DATABASE_URL;
