/**
 * Vite cho web: root là thư mục này, build ra `dist/web` (server phục vụ tĩnh).
 * Dev: `/api` và `/auth` được chuyển tiếp sang server ở cổng 3000 nên cookie
 * phiên nằm cùng origin với trang.
 */

import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

const API_ORIGIN = 'http://localhost:3000';

export default defineConfig({
  root: here('.'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: here('../../dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Có `/` cuối: proxy so khớp theo tiền tố, nên `/api` sẽ bắt luôn file `/api.ts` của web.
    proxy: {
      '/api/': API_ORIGIN,
      '/auth/': API_ORIGIN,
    },
  },
});
