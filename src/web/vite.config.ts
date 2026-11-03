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

/**
 * Gói npm vào chunk `vendor`: react, react-dom (kèm `scheduler` — phụ thuộc riêng của nó, để chunk
 * vendor không phải import chéo sang chunk app), react-router, và mọi gói trong scope `@tanstack`.
 */
const VENDOR_PACKAGES = new Set(['react', 'react-dom', 'scheduler', 'react-router', '@tanstack']);

/**
 * `id` là đường dẫn module đã giải, Vite dùng `/` kể cả trên Windows (`.../node_modules/react-dom/client.js`).
 * Chỉ xét gói trong `node_modules`, so khớp đúng đoạn ngay sau `node_modules/` (tên gói hoặc scope),
 * nên `lucide-react` hay `react-hook-form` không bị gộp nhầm.
 */
function isVendorModule(id: string): boolean {
  const marker = id.lastIndexOf('/node_modules/');
  if (marker === -1) return false;
  const pkgOrScope = id.slice(marker + '/node_modules/'.length).split('/')[0] ?? '';
  return VENDOR_PACKAGES.has(pkgOrScope);
}

export default defineConfig({
  root: here('.'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: here('../../dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Thư viện nền (React, Router, TanStack Query) đổi hiếm hơn mã app nhiều: tách thành chunk
        // `vendor` riêng để qua các lần deploy tên file (hash) giữ nguyên, trình duyệt dùng lại
        // bản đã cache (`/assets/*` được cache một năm, xem `src/server/web/app.ts`).
        manualChunks: (id) => (isVendorModule(id) ? 'vendor' : undefined),
      },
    },
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
