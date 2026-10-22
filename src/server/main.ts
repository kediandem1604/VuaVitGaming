/**
 * Điểm vào tiến trình: web (Fastify) và bot Discord chạy chung một process, chia
 * sẻ một `Ctx`. Thứ tự: cấu hình → bot (chưa đăng nhập) → ctx → web lắng nghe →
 * bot đăng nhập. Bot không nối được thì web vẫn chạy (spec §9).
 */

import './load-env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createBot } from './bot/client.js';
import type { Bot } from './bot/client.js';
import { loadConfig } from './config.js';
import type { Config } from './config.js';
import type { Ctx } from './ctx.js';
import { db } from './db.js';
import { logMailer } from './mail/log-mailer.js';
import { createDiscordOAuthClient } from './modules/auth/oauth.js';
import { buildApp } from './web/app.js';

// Chỉ ghi log: một lỗi lạc không làm sập cả web lẫn bot.
process.on('unhandledRejection', (reason) => console.error('[main] Promise bị reject không ai bắt:', reason));
process.on('uncaughtException', (err) => console.error('[main] Lỗi không ai bắt:', err));

async function main(): Promise<void> {
  const config = readConfig();
  const bot = createBot(() => ctx, config);
  const ctx: Ctx = {
    db,
    mailer: logMailer,
    notifier: bot.notifier,
    directory: bot.directory,
    now: () => new Date(),
    config,
  };

  const app = await buildApp(ctx, {
    oauth: createDiscordOAuthClient(config),
    webDistDir: webDistDir(),
    logger: true,
  });
  installShutdown(app, bot);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Đang chạy tại cổng ${config.port}`);

  try {
    await bot.start();
    console.log('Bot Discord đã kết nối');
  } catch (err) {
    console.error(`Không kết nối được Discord: ${messageOf(err)}`);
  }
}

/** Cấu hình hỏng → in đúng thông báo (không stack) rồi thoát 1. */
function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (err) {
    console.error(messageOf(err));
    process.exit(1);
  }
}

/**
 * Thư mục build của web, nếu đã build. `src/server/main.ts` (tsx) và
 * `dist/server/main.js` (node) đều cách gốc dự án hai cấp.
 */
function webDistDir(): string | undefined {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'web');
  if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  console.warn(`Không thấy ${path.join(dir, 'index.html')} — chỉ phục vụ API (web: "npm run build" hoặc "npm run dev:web")`);
  return undefined;
}

/** SIGINT/SIGTERM: đóng web, ngắt Discord, ngắt database rồi thoát 0 — mỗi bước lỗi chỉ ghi log. */
function installShutdown(app: FastifyInstance, bot: Bot): void {
  let stopping = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`Nhận ${signal}, đang dừng…`);
    await attempt('đóng web', () => app.close());
    await attempt('ngắt Discord', () => bot.client.destroy());
    await attempt('ngắt database', () => db.$disconnect());
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function attempt(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`Lỗi khi ${what}:`, err);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err: unknown) => {
  console.error('Không khởi động được:', err);
  process.exit(1);
});
