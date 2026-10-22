/**
 * Bộ hẹn giờ (spec §4.9): mỗi 60 giây, nếu giữ được khoá thuê, chạy lần lượt các
 * việc định kỳ. Mỗi việc độc lập — lỗi chỉ được ghi log, việc sau vẫn chạy — và
 * đều chạy lại được mà không gây trùng (nhắc có `notification_log`, đồng bộ tin
 * Discord dựa vào cờ `discordDirty`).
 *
 * Việc của task này: nhắc giờ, đăng/sửa bù tin Discord, dọn phiên web hết hạn.
 * Task 12 (tự kết thúc buổi, đóng vote) và Task 17 (chốt mùa, nhắc mod) thêm việc
 * vào `defaultJobs()`.
 */

import { randomBytes } from 'node:crypto';
import os from 'node:os';
import type { Ctx } from '../ctx.js';
import { runReminders } from '../modules/reminders/service.js';
import { syncSessionMessage } from '../modules/sessions/service.js';
import { tryAcquireLease } from './lease.js';

export interface Job {
  name: string;
  run: (ctx: Ctx) => Promise<unknown>;
}

export interface JobResult {
  name: string;
  ok: boolean;
  /** Thông báo lỗi khi `ok` là false. */
  error?: string;
}

/** Khoảng cách giữa hai lượt chạy. */
export const SCHEDULER_INTERVAL_MS = 60_000;

/**
 * Chạy các việc nối tiếp nhau theo thứ tự đưa vào. Một việc ném lỗi thì ghi log,
 * ghi nhận vào kết quả và chạy tiếp việc sau; không bao giờ ném ra ngoài.
 */
export async function runTick(ctx: Ctx, jobs: Job[]): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of jobs) {
    try {
      await job.run(ctx);
      results.push({ name: job.name, ok: true });
    } catch (err) {
      console.error(`[scheduler] ${job.name}:`, err);
      results.push({ name: job.name, ok: false, error: messageOf(err) });
    }
  }
  return results;
}

/**
 * Đăng/sửa bù tin Discord của mọi buổi còn `discordDirty` — bất kể trạng thái
 * (buổi huỷ / kết thúc cũng cần sửa tin lần cuối). `syncSessionMessage` tự xếp
 * hàng theo buổi và không bao giờ ném lỗi; buổi nào vẫn lỗi thì giữ cờ cho lượt sau.
 */
export async function retrySessionSync(ctx: Ctx): Promise<void> {
  const dirty = await ctx.db.gameSession.findMany({
    where: { discordDirty: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const { id } of dirty) await syncSessionMessage(ctx, id);
}

/** Xoá phiên đăng nhập web đã hết hạn (đăng nhập chỉ xoá lười khi phiên đó được dùng lại). */
export async function cleanupWebSessions(ctx: Ctx): Promise<number> {
  const { count } = await ctx.db.webSession.deleteMany({ where: { expiresAt: { lt: ctx.now() } } });
  return count;
}

/** Các việc của một lượt, theo thứ tự chạy: nhắc giờ trước (gấp nhất), rồi Discord, rồi dọn dẹp. */
export function defaultJobs(): Job[] {
  return [
    { name: 'reminders', run: runReminders },
    { name: 'session-sync', run: retrySessionSync },
    { name: 'web-session-cleanup', run: cleanupWebSessions },
  ];
}

export interface SchedulerOptions {
  /** Mặc định 60 000 ms. */
  intervalMs?: number;
  /** Tên người giữ khoá; mặc định `${hostname}-${pid}-${ngẫu nhiên}`. */
  holderId?: string;
  /** Mặc định `defaultJobs()`. */
  jobs?: Job[];
}

/**
 * Chạy một lượt ngay rồi mỗi `intervalMs`. Lượt trước chưa xong thì bỏ qua lượt
 * này (không chạy chồng). Không giữ được khoá → không chạy việc nào; lỗi khi lấy
 * khoá chỉ ghi log. `stop()` ngừng hẹn lượt mới (lượt đang dở chạy nốt). Timer
 * được `unref` nên không tự giữ tiến trình sống.
 */
export function startScheduler(ctx: Ctx, opts: SchedulerOptions = {}): { stop(): void } {
  const intervalMs = opts.intervalMs ?? SCHEDULER_INTERVAL_MS;
  const holderId = opts.holderId ?? defaultHolderId();
  const jobs = opts.jobs ?? defaultJobs();
  let running = false;
  let stopped = false;

  const acquire = async (): Promise<boolean> => {
    try {
      return await tryAcquireLease(ctx, holderId);
    } catch (err) {
      console.error('[scheduler] Không lấy được khoá thuê:', err);
      return false;
    }
  };

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      if (await acquire()) await runTick(ctx, jobs);
    } catch (err) {
      console.error('[scheduler] Lượt chạy lỗi:', err); // runTick không ném; phòng hờ.
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** Tên người giữ khoá: máy + tiến trình + đuôi ngẫu nhiên (hai bản deploy cùng máy vẫn khác nhau). */
export function defaultHolderId(): string {
  return `${os.hostname()}-${process.pid}-${randomBytes(4).toString('hex')}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
