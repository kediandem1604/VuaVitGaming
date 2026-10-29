import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { castVote } from '../../src/server/modules/mvp/votes.js';
import { createSession, setAttendance } from '../../src/server/modules/sessions/service.js';
import { DEFAULT_LEASE_TTL_MS, tryAcquireLease } from '../../src/server/scheduler/lease.js';
import { defaultJobs, retrySessionSync, runTick, startScheduler } from '../../src/server/scheduler/scheduler.js';
import type { Job } from '../../src/server/scheduler/scheduler.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession as insertSession } from '../helpers/factories.js';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

/** 21:00 ngày 22/10/2026 giờ VN = now mặc định (19:00 VN) + 2 giờ. */
const startsAt = new Date('2026-10-22T14:00:00Z');

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const leaseRow = () => testDb.schedulerLease.findUnique({ where: { id: 1 } });
const sessionRow = (id: number) => testDb.gameSession.findUniqueOrThrow({ where: { id } });

async function setup() {
  const t = makeTestCtx();
  const admin = await createMember(testDb, { accessLevel: 'admin', displayName: 'Admin' });
  const classic = await testDb.gameMode.findUniqueOrThrow({ where: { key: 'classic' } });
  return { ...t, admin, classic };
}

/** Job đếm số lần chạy; `block` làm mỗi lần chạy treo tới khi được thả. */
function countingJob(name: string, block?: Promise<void>): { job: Job; runs: () => number } {
  let runs = 0;
  return {
    job: {
      name,
      run: async () => {
        runs += 1;
        if (block) await block;
      },
    },
    runs: () => runs,
  };
}

// ---------------------------------------------------------------------------
// tryAcquireLease
// ---------------------------------------------------------------------------

test('lease is exclusive until expiry', async () => {
  const { ctx, setNow } = makeTestCtx();
  expect(await tryAcquireLease(ctx, 'A')).toBe(true);
  expect(await tryAcquireLease(ctx, 'B')).toBe(false);
  expect(await tryAcquireLease(ctx, 'A')).toBe(true); // gia hạn
  setNow('2026-10-22T12:02:00Z');
  expect(await tryAcquireLease(ctx, 'B')).toBe(true);
});

test('lease row holds the holder and expires ttl after ctx.now(), strictly', async () => {
  const { ctx, setNow } = makeTestCtx();
  expect(DEFAULT_LEASE_TTL_MS).toBe(90_000);

  expect(await tryAcquireLease(ctx, 'A')).toBe(true);
  expect(await leaseRow()).toEqual({ id: 1, holder: 'A', expiresAt: new Date('2026-10-22T12:01:30Z') });

  // Gia hạn: hạn mới tính từ now hiện tại.
  setNow('2026-10-22T12:01:00Z');
  expect(await tryAcquireLease(ctx, 'A')).toBe(true);
  expect(await leaseRow()).toEqual({ id: 1, holder: 'A', expiresAt: new Date('2026-10-22T12:02:30Z') });

  // Đúng lúc hết hạn vẫn chưa lấy được (so sánh `<`); qua 1 ms thì được.
  setNow('2026-10-22T12:02:30Z');
  expect(await tryAcquireLease(ctx, 'B')).toBe(false);
  expect((await leaseRow())?.holder).toBe('A');
  setNow('2026-10-22T12:02:30.001Z');
  expect(await tryAcquireLease(ctx, 'B')).toBe(true);
  expect(await leaseRow()).toEqual({ id: 1, holder: 'B', expiresAt: new Date('2026-10-22T12:04:00.001Z') });

  // TTL tuỳ chỉnh.
  expect(await tryAcquireLease(ctx, 'B', 1_000)).toBe(true);
  expect((await leaseRow())?.expiresAt).toEqual(new Date('2026-10-22T12:02:31.001Z'));
  setNow('2026-10-22T12:02:31.002Z');
  expect(await tryAcquireLease(ctx, 'C', 1_000)).toBe(true);
  expect(await testDb.schedulerLease.count()).toBe(1);
});

// ---------------------------------------------------------------------------
// runTick
// ---------------------------------------------------------------------------

test('a failing job does not stop the tick', async () => {
  const { ctx } = makeTestCtx();
  const errors = silenceConsoleError();
  const ran: string[] = [];
  const boom = new Error('boom');
  const r = await runTick(ctx, [
    {
      name: 'x',
      run: async () => {
        throw boom;
      },
    },
    {
      name: 'y',
      run: async () => {
        ran.push('y');
      },
    },
  ]);
  expect(r).toEqual([
    { name: 'x', ok: false, error: 'boom' },
    { name: 'y', ok: true },
  ]);
  expect(ran).toEqual(['y']);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(errors).toHaveBeenCalledWith('[scheduler] x:', boom);
});

test('jobs run one after another, in order, and an empty tick is fine', async () => {
  const { ctx } = makeTestCtx();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const jobs: Job[] = [
    {
      name: 'slow',
      run: async () => {
        order.push('slow:start');
        await gate;
        order.push('slow:end');
      },
    },
    {
      name: 'fast',
      run: async () => {
        order.push('fast');
      },
    },
  ];

  const tick = runTick(ctx, jobs);
  await vi.waitFor(() => expect(order).toEqual(['slow:start']));
  release();
  expect((await tick).map((r) => r.name)).toEqual(['slow', 'fast']);
  expect(order).toEqual(['slow:start', 'slow:end', 'fast']);

  expect(await runTick(ctx, [])).toEqual([]);
});

// ---------------------------------------------------------------------------
// retrySessionSync
// ---------------------------------------------------------------------------

test('retry clears dirty once Discord is back', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  silenceConsoleError();

  // s1: tạo lúc Discord sập → chưa có tin.
  notifier.down = true;
  const s1 = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  expect(await sessionRow(s1.id)).toMatchObject({ discordMessageId: null, discordDirty: true });

  // s2: đã có tin, sửa lúc Discord sập → cần sửa bù.
  notifier.down = false;
  const s2 = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb, { displayName: 'An' });
  notifier.down = true;
  await setAttendance(ctx, s2.id, m.id, true);
  expect(await sessionRow(s2.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: true });

  // s3: đã huỷ nhưng tin chưa được sửa (không chỉ buổi `scheduled` mới cần đồng bộ).
  const s3 = await insertSession(testDb, { status: 'cancelled', discordMessageId: 'msg-old', discordDirty: true });
  // s4: sạch — không được đụng tới.
  const s4 = await insertSession(testDb, { discordMessageId: 'msg-clean', discordDirty: false });

  notifier.down = false;
  await expect(retrySessionSync(ctx)).resolves.toBeUndefined();

  expect(await sessionRow(s1.id)).toMatchObject({ discordMessageId: 'msg-2', discordDirty: false });
  expect(await sessionRow(s2.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: false });
  expect(await sessionRow(s3.id)).toMatchObject({ discordMessageId: 'msg-old', discordDirty: false });
  expect(await sessionRow(s4.id)).toMatchObject({ discordMessageId: 'msg-clean', discordDirty: false });

  expect(notifier.published.map((v) => v.id)).toEqual([s2.id, s1.id]);
  expect(notifier.updated.map((u) => u.messageId)).toEqual(['msg-1', 'msg-old']);
  expect(notifier.updated[0]?.view.attendees).toEqual([{ memberId: m.id, displayName: 'An' }]);
  expect(notifier.updated[1]?.view.status).toBe('cancelled');

  // Không còn gì bẩn: lần sau không gọi Discord.
  await retrySessionSync(ctx);
  expect(notifier.published).toHaveLength(2);
  expect(notifier.updated).toHaveLength(2);
});

test('retry while Discord is still down keeps sessions dirty and never throws', async () => {
  const { ctx, notifier, admin, classic } = await setup();
  const errors = silenceConsoleError();
  notifier.down = true;
  const s1 = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const s2 = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  errors.mockClear();

  await expect(retrySessionSync(ctx)).resolves.toBeUndefined();
  expect(await sessionRow(s1.id)).toMatchObject({ discordMessageId: null, discordDirty: true });
  expect(await sessionRow(s2.id)).toMatchObject({ discordMessageId: null, discordDirty: true });
  expect(errors).toHaveBeenCalledTimes(2);
});

// ---------------------------------------------------------------------------
// defaultJobs
// ---------------------------------------------------------------------------

/** Thứ tự chạy trong một lượt: nhắc giờ, tự kết thúc, đóng vote, tin buổi, tin vote, mùa giải, huy hiệu, role top phe, dọn phiên web. */
const DEFAULT_JOB_NAMES = ['reminders', 'auto-end', 'close-votes', 'session-sync', 'bounty-sync', 'vote-sync', 'multiplier-days', 'season', 'badges', 'rank-roles', 'web-session-cleanup'];

test('default jobs run reminders, auto-end, close-votes, session-sync, bounty-sync, vote-sync, season, badges, rank-roles, web-session-cleanup in that order', () => {
  expect(defaultJobs().map((j) => j.name)).toEqual(DEFAULT_JOB_NAMES);
});

test('web-session-cleanup deletes only expired web sessions', async () => {
  const { ctx } = makeTestCtx();
  const m = await createMember(testDb);
  const now = ctx.now().getTime();
  await testDb.webSession.createMany({
    data: [
      { id: 'expired', memberId: m.id, expiresAt: new Date(now - 1) },
      { id: 'long-expired', memberId: m.id, expiresAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'alive', memberId: m.id, expiresAt: new Date(now + 1) },
      { id: 'far', memberId: m.id, expiresAt: new Date('2026-11-21T12:00:00Z') },
    ],
  });

  const cleanup = defaultJobs().find((j) => j.name === 'web-session-cleanup');
  expect(cleanup).toBeDefined();
  await cleanup!.run(ctx);

  const left = await testDb.webSession.findMany({ orderBy: { id: 'asc' }, select: { id: true } });
  expect(left.map((s) => s.id)).toEqual(['alive', 'far']);

  // Chạy lại không đổi gì.
  await cleanup!.run(ctx);
  expect(await testDb.webSession.count()).toBe(2);
});

test('a tick with the default jobs sends reminders, resyncs dirty sessions and cleans web sessions', async () => {
  const { ctx, notifier, setNow, admin, classic } = await setup();
  silenceConsoleError();

  // Buổi tạo lúc Discord sập; người tham gia có DM bật → nhắc `pre15` lúc 13:45Z.
  notifier.down = true;
  const s = await createSession(ctx, admin.id, { startsAt, modeId: classic.id });
  const m = await createMember(testDb, { discordId: 'dM', notifyEmail: false, notifyDm: true });
  await setAttendance(ctx, s.id, m.id, true);
  await testDb.webSession.create({ data: { id: 'old', memberId: m.id, expiresAt: new Date('2026-10-01T00:00:00Z') } });

  notifier.down = false;
  setNow('2026-10-22T13:45:00Z');
  const results = await runTick(ctx, defaultJobs());

  expect(results).toEqual(DEFAULT_JOB_NAMES.map((name) => ({ name, ok: true })));
  expect(notifier.dms.map((d) => d.discordId)).toEqual(['dM']);
  expect(await sessionRow(s.id)).toMatchObject({ discordMessageId: 'msg-1', discordDirty: false });
  expect(notifier.published[0]?.attendees).toHaveLength(1);
  expect(await testDb.webSession.count()).toBe(0);
});

test('ticks auto-end a stale session, publish its vote once Discord is back, and close the vote when due', async () => {
  const { ctx, notifier, setNow } = await setup();
  silenceConsoleError();
  const m = await createMember(testDb, { displayName: 'An' });
  // Buổi 15:00 VN có một người tham gia; admin quên kết thúc. Lúc 19:00 VN (now) là đúng 4 giờ.
  const stale = await insertSession(testDb, { startsAt: new Date('2026-10-22T08:00:00Z') });
  await testDb.attendance.create({
    data: { sessionId: stale.id, memberId: m.id, status: 'going', updatedAt: new Date('2026-10-22T07:00:00Z') },
  });

  // Lượt 1, Discord sập: buổi vẫn `ended`, đợt vote vẫn mở, các tin chờ đăng bù.
  notifier.down = true;
  let results = await runTick(ctx, defaultJobs());
  expect(results).toEqual(DEFAULT_JOB_NAMES.map((name) => ({ name, ok: true })));
  expect(await sessionRow(stale.id)).toMatchObject({ status: 'ended', discordMessageId: null, discordDirty: true });
  const round = await testDb.voteRound.findUniqueOrThrow({ where: { sessionId: stale.id } });
  expect(round).toMatchObject({ status: 'open', closesAt: new Date('2026-10-23T00:00:00Z') });
  expect(await testDb.voteMessage.count({ where: { roundId: round.id, discordMessageId: null } })).toBe(3);

  // Lượt 2, Discord trở lại: tin buổi đăng bù trước, rồi ba tin vote.
  notifier.down = false;
  results = await runTick(ctx, defaultJobs());
  expect(results.every((r) => r.ok)).toBe(true);
  expect(await sessionRow(stale.id)).toMatchObject({ status: 'ended', discordMessageId: 'msg-1', discordDirty: false });
  expect(notifier.published[0]).toMatchObject({ id: stale.id, status: 'ended', attendees: [{ memberId: m.id, displayName: 'An' }] });
  expect(notifier.votes.map((v) => v.categoryName)).toEqual(['Giết nhiều nhất', 'Pha xử lý ngu nhất', 'Pha dí người ngu nhất']);
  expect(await testDb.voteMessage.count({ where: { roundId: round.id, discordMessageId: null } })).toBe(0);

  // Có người vote; đến giờ đóng nhưng Discord lại sập → lượt 3 vẫn đóng đợt trong DB, kết quả chờ đăng bù.
  const voter = await createMember(testDb);
  await castVote(ctx, { roundId: round.id, categoryId: notifier.votes[0]!.categoryId, voterId: voter.id, nomineeId: m.id });
  setNow('2026-10-23T00:00:00Z');
  notifier.down = true;
  results = await runTick(ctx, defaultJobs());
  expect(results.every((r) => r.ok)).toBe(true);
  expect(await testDb.voteRound.findUniqueOrThrow({ where: { id: round.id } })).toMatchObject({
    status: 'closed',
    announcePending: true,
  });
  expect(await testDb.voteMessage.count({ where: { roundId: round.id, resultPending: true } })).toBe(3);
  expect(await testDb.award.count()).toBe(1);
  expect(notifier.announcements).toEqual([]);
  expect(notifier.closedVotes).toEqual([]);

  // Lượt 4, Discord trở lại: vote-sync công bố kết quả đúng một lần và sửa ba tin vote.
  notifier.down = false;
  results = await runTick(ctx, defaultJobs());
  expect(results.every((r) => r.ok)).toBe(true);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.announcements[0]).toContain('• Giết nhiều nhất: An (1 phiếu)');
  expect(notifier.closedVotes.map((c) => c.messageId)).toEqual(['msg-2', 'msg-3', 'msg-4']);
  expect(await testDb.voteRound.findUniqueOrThrow({ where: { id: round.id } })).toMatchObject({ announcePending: false });
  expect(await testDb.voteMessage.count({ where: { roundId: round.id, resultPending: true } })).toBe(0);

  // Lượt 5: không còn gì để đăng.
  results = await runTick(ctx, defaultJobs());
  expect(results.every((r) => r.ok)).toBe(true);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.closedVotes).toHaveLength(3);
});

// ---------------------------------------------------------------------------
// startScheduler
// ---------------------------------------------------------------------------

test('startScheduler ticks immediately, skips ticks while one is running, and stop() ends ticking', async () => {
  const { ctx } = makeTestCtx();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = countingJob('slow', gate);

  const scheduler = startScheduler(ctx, { intervalMs: 10, holderId: 'T', jobs: [slow.job] });
  try {
    // Lượt đầu chạy ngay khi khởi động.
    await vi.waitFor(() => expect(slow.runs()).toBe(1), { timeout: 5_000 });
    expect((await leaseRow())?.holder).toBe('T');

    // Nhiều kỳ trôi qua trong lúc lượt đầu còn treo: không chạy chồng.
    await sleep(60);
    expect(slow.runs()).toBe(1);

    release();
    await vi.waitFor(() => expect(slow.runs()).toBeGreaterThanOrEqual(2), { timeout: 5_000 });
  } finally {
    await scheduler.stop();
  }

  // stop() đã chờ lượt đang dở xong; từ đó không còn lượt mới.
  const after = slow.runs();
  await sleep(60);
  expect(slow.runs()).toBe(after);
  await scheduler.stop(); // Gọi lại vô hại.
});

test('stop() waits for the running tick to finish and keeps the lease; releaseLease() then hands it over', async () => {
  const { ctx } = makeTestCtx();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let finished = false;
  const slow = countingJob('slow', gate);
  const job: Job = {
    name: 'slow',
    run: async (c) => {
      await slow.job.run(c);
      finished = true;
    },
  };

  const scheduler = startScheduler(ctx, { intervalMs: 10, holderId: 'S', jobs: [job] });
  await vi.waitFor(() => expect(slow.runs()).toBe(1), { timeout: 5_000 });
  expect((await leaseRow())?.holder).toBe('S');

  let stopped = false;
  const stopping = scheduler.stop().then(() => {
    stopped = true;
  });
  await sleep(50);
  // Lượt đang chạy chưa xong: stop() còn chờ, khoá vẫn giữ.
  expect(stopped).toBe(false);
  expect((await leaseRow())?.holder).toBe('S');

  release();
  await stopping;
  expect(finished).toBe(true);
  expect(slow.runs()).toBe(1);
  // Đã dừng nhưng khoá vẫn giữ: lúc tắt máy, web và bot còn đang đóng — bản deploy mới chưa
  // được đăng/sửa bù tin Discord song song với chúng.
  expect((await leaseRow())?.holder).toBe('S');
  expect(await tryAcquireLease(ctx, 'next')).toBe(false);

  // Trả khoá: tiến trình mới (deploy kế tiếp) lấy được ngay, không phải chờ hết hạn.
  await scheduler.releaseLease();
  expect(await leaseRow()).toBeNull();
  expect(await tryAcquireLease(ctx, 'next')).toBe(true);
  await scheduler.releaseLease(); // Gọi lại vô hại: không đụng khoá của người khác.
  expect((await leaseRow())?.holder).toBe('next');
});

test('releaseLease() on its own also stops ticking and waits for the running tick before releasing', async () => {
  const { ctx } = makeTestCtx();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = countingJob('slow', gate);

  const scheduler = startScheduler(ctx, { intervalMs: 10, holderId: 'R', jobs: [slow.job] });
  await vi.waitFor(() => expect(slow.runs()).toBe(1), { timeout: 5_000 });

  let released = false;
  const releasing = scheduler.releaseLease().then(() => {
    released = true;
  });
  await sleep(50);
  expect(released).toBe(false);
  expect((await leaseRow())?.holder).toBe('R');

  release();
  await releasing;
  expect(await leaseRow()).toBeNull();
  await sleep(60);
  expect(slow.runs()).toBe(1); // không còn lượt mới
});

test('a runner that does not hold the lease never runs jobs; it takes over after the lease expires', async () => {
  const { ctx, setNow } = makeTestCtx();
  expect(await tryAcquireLease(ctx, 'A')).toBe(true);

  const b = countingJob('b');
  const first = startScheduler(ctx, { intervalMs: 10, holderId: 'B', jobs: [b.job] });
  await sleep(80);
  await first.releaseLease();
  expect(b.runs()).toBe(0);
  // releaseLease() chỉ trả khoá của chính mình: khoá của A còn nguyên.
  expect((await leaseRow())?.holder).toBe('A');

  // Khoá của A hết hạn → B lấy được và chạy.
  setNow('2026-10-22T12:02:00Z');
  const second = startScheduler(ctx, { intervalMs: 10, holderId: 'B', jobs: [b.job] });
  try {
    await vi.waitFor(() => expect(b.runs()).toBeGreaterThanOrEqual(1), { timeout: 5_000 });
    expect((await leaseRow())?.holder).toBe('B');
  } finally {
    await second.stop();
  }
});

test('a lease error is logged, never thrown, and skips the tick', async () => {
  const { ctx } = makeTestCtx();
  const errors = silenceConsoleError();
  const dbDown = new Error('database down');
  const broken: Ctx = {
    ...ctx,
    db: {
      $queryRaw: async () => {
        throw dbDown;
      },
    } as unknown as PrismaClient,
  };
  const job = countingJob('j');

  const scheduler = startScheduler(broken, { intervalMs: 10, jobs: [job.job] });
  await vi.waitFor(() => expect(errors).toHaveBeenCalled(), { timeout: 5_000 });
  await expect(scheduler.stop()).resolves.toBeUndefined();
  await expect(scheduler.releaseLease()).resolves.toBeUndefined(); // trả khoá lỗi cũng chỉ ghi log

  expect(job.runs()).toBe(0);
  expect(errors.mock.calls[0]?.[0]).toContain('[scheduler]');
  expect(errors.mock.calls[0]?.[1]).toBe(dbDown);
});

test('the default holder id names the host and the process and is unique per scheduler', async () => {
  const { ctx } = makeTestCtx();
  const a = startScheduler(ctx, { intervalMs: 60_000, jobs: [] });
  await vi.waitFor(async () => expect((await leaseRow())?.holder).toBeDefined(), { timeout: 5_000 });
  const holder = (await leaseRow())?.holder ?? '';
  await a.stop();
  expect(holder).toContain(`-${process.pid}-`);
  expect(holder.length).toBeGreaterThan(`-${process.pid}-`.length + 4);
});
