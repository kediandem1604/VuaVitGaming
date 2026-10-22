import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Test server dùng chung một DB nên các file phải chạy tuần tự. Vitest 3 chỉ
    // đọc fileParallelism ở cấp gốc (pool được tạo một lần cho mọi project);
    // đặt trong project 'server' sẽ bị bỏ qua và các file chạy song song.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
          globalSetup: ['tests/helpers/global-setup.ts'],
          setupFiles: ['tests/helpers/setup.ts'],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['tests/web/**/*.test.{ts,tsx}'],
          setupFiles: ['@testing-library/jest-dom/vitest'],
        },
      },
    ],
  },
});
