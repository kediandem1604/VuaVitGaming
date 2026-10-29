/**
 * Bộ hẹn giờ (spec §4.9): mỗi 60 giây, nếu giữ được khoá thuê, chạy lần lượt các
 * việc định kỳ. Mỗi việc độc lập — lỗi chỉ được ghi log, việc sau vẫn chạy — và
 * đều chạy lại được mà không gây trùng (nhắc có `notification_log`, đồng bộ tin
 * Discord dựa vào cờ `discordDirty`).
 *
 * Việc hiện có: nhắc giờ, tự kết thúc buổi, đóng vote đến hạn, đăng/sửa bù tin buổi,
 * đăng/sửa tin treo thưởng (cờ `bountyDirty`), đăng bù tin vote, ngày nhân điểm (đăng bù tin tạo, nhắc 9:00 đúng ngày), mùa giải (nhắc mod ngày 3, chốt mùa 00:05 ngày 4, đăng bù bảng tổng
 * kết), huy hiệu (trao danh hiệu tháng đã chốt, đăng bù tổng kết), role Discord top 3 mỗi phe,
 * dọn phiên web hết hạn.
 */

import { randomBytes } from 'node:crypto';
import os from 'node:os';
import type { Ctx } from '../ctx.js';
import { runBadgeJobs } from '../modules/badges/jobs.js';
import { syncDirtyBountyBoards } from '../modules/bounties/discord.js';
import { runMultiplierJobs } from '../modules/multipliers/jobs.js';
import { closeDueRounds, syncVotes } from '../modules/mvp/votes.js';
import { runReminders } from '../modules/reminders/service.js';
import { runSeasonJobs } from '../modules/seasons/service.js';
import { autoEndSessions } from '../modules/sessions/end.js';
import { syncRankRoles } from '../modules/stats/rank-roles.js';
import { syncSessionMessage } from '../modules/sessions/service.js';
import { releaseLease as releaseLeaseRow, tryAcquireLease } from './lease.js';

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

/**
 * Các việc của một lượt, theo thứ tự chạy: nhắc giờ trước (gấp nhất); tự kết thúc buổi
 * và đóng vote (đổi trạng thái, tự đăng Discord); rồi đăng bù tin buổi, tin treo thưởng, tin vote và
 * kết quả vote (gom cả những gì hai việc trước không đăng được); ngày nhân điểm; việc mùa giải (chỉ có
 * gì để làm quanh ngày 3–4 hằng tháng) rồi huy hiệu ngay sau (tháng vừa chốt được trao
 * danh hiệu trong cùng lượt); gắn/gỡ role top mỗi phe; cuối cùng dọn dẹp.
 */
export function defaultJobs(): Job[] {
  return [
    { name: 'reminders', run: runReminders },
    { name: 'auto-end', run: autoEndSessions },
    { name: 'close-votes', run: closeDueRounds },
    { name: 'session-sync', run: retrySessionSync },
    { name: 'bounty-sync', run: syncDirtyBountyBoards },
    { name: 'vote-sync', run: syncVotes },
    { name: 'multiplier-days', run: runMultiplierJobs },
    { name: 'season', run: runSeasonJobs },
    { name: 'badges', run: runBadgeJobs },
    { name: 'rank-roles', run: syncRankRoles },
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

export interface Scheduler {
  /**
   * Ngừng hẹn lượt mới và chờ lượt đang dở chạy xong. VẪN GIỮ khoá thuê: lúc tắt máy, web
   * và bot còn đang đóng (có thể còn đang sửa tin Discord); trả khoá sớm thì bộ hẹn giờ
   * của bản deploy mới đăng/sửa bù song song với chúng. Không bao giờ reject; gọi lại vô hại.
   */
  stop(): Promise<void>;
  /**
   * Dừng (như `stop`) rồi trả khoá thuê nếu đang giữ, để bản deploy mới chạy bộ hẹn giờ
   * ngay thay vì chờ khoá hết hạn (90 giây). Gọi khi tiến trình đã đóng web và ngắt
   * Discord. Lỗi chỉ ghi log; không bao giờ reject; gọi lại vô hại.
   */
  releaseLease(): Promise<void>;
}

/**
 * Chạy một lượt ngay rồi mỗi `intervalMs`. Lượt trước chưa xong thì bỏ qua lượt
 * này (không chạy chồng). Không giữ được khoá → không chạy việc nào; lỗi khi lấy
 * khoá chỉ ghi log. Timer được `unref` nên không tự giữ tiến trình sống. Tắt tiến
 * trình: `await stop()` trước, `await releaseLease()` sau khi đóng web và ngắt Discord,
 * cả hai trước khi ngắt database.
 */
export function startScheduler(ctx: Ctx, opts: SchedulerOptions = {}): Scheduler {
  const intervalMs = opts.intervalMs ?? SCHEDULER_INTERVAL_MS;
  const holderId = opts.holderId ?? defaultHolderId();
  const jobs = opts.jobs ?? defaultJobs();
  let running = false;
  let stopped = false;
  /** Lượt đang chạy (để `stop()` chờ nó). */
  let inFlight: Promise<void> = Promise.resolve();
  let stopping: Promise<void> | null = null;
  let releasing: Promise<void> | null = null;

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

  const startTick = (): void => {
    if (running || stopped) return;
    inFlight = tick();
  };

  const timer = setInterval(startTick, intervalMs);
  timer.unref();
  startTick();

  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight; // tick không bao giờ reject
    })();
    return stopping;
  };

  const release = async (): Promise<void> => {
    await stop();
    try {
      await releaseLeaseRow(ctx, holderId);
    } catch (err) {
      console.error('[scheduler] Không trả được khoá thuê (khoá tự hết hạn sau 90 giây):', err);
    }
  };

  return {
    stop,
    releaseLease(): Promise<void> {
      releasing ??= release();
      return releasing;
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
