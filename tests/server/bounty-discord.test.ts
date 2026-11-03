import type { Member } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { createBounty, deleteBounty, updateBounty } from '../../src/server/modules/bounties/admin.js';
import { syncBountyBoard, syncDirtyBountyBoards } from '../../src/server/modules/bounties/discord.js';
import { endSession } from '../../src/server/modules/sessions/end.js';
import { cancelSession, createSession, updateSession } from '../../src/server/modules/sessions/service.js';
import { defaultJobs, runTick } from '../../src/server/scheduler/scheduler.js';
import type { BountyInput } from '../../src/shared/api-types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import type { FakeNotifier } from '../helpers/fakes.js';
import { createMember, roleByKey } from '../helpers/factories.js';

let ctx: Ctx;
let notifier: FakeNotifier;
let mod: Member;
let errors: ReturnType<typeof vi.spyOn>;

/** 21:00 ngày 22/10/2026 giờ VN (hôm nay theo đồng hồ test). */
const startsAt = new Date('2026-10-22T14:00:00Z');

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier } = makeTestCtx());
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod', discordId: 'd-mod' });
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

async function newSession(at = startsAt): Promise<number> {
  const classic = await testDb.gameMode.findUniqueOrThrow({ where: { key: 'classic' } });
  return (await createSession(ctx, mod.id, { startsAt: at, modeId: classic.id })).id;
}

const input = (o: Partial<BountyInput> = {}): BountyInput => ({ title: 'Sống sót', description: null, points: 5, roleId: null, sessionId: null, ...o });
const bounty = async (o: Partial<BountyInput> = {}) => (await createBounty(ctx, mod.id, input(o))).id;
const row = (id: number) =>
  testDb.gameSession.findUniqueOrThrow({ where: { id }, select: { bountyChannelId: true, bountyMessageId: true, bountyDirty: true } });

test('a scheduled session with bounties gets one board in the bounty channel; the dirty flag clears', async () => {
  const sessionId = await newSession();
  const duck = await roleByKey(testDb, 'duck');
  const kills = await bounty({ title: 'Giết 3 ngỗng', points: 10, roleId: duck.id, sessionId, description: 'Trong một ván' });
  const survive = await bounty({ title: 'Sống sót', points: 3 });
  expect((await row(sessionId)).bountyDirty).toBe(true);

  await syncDirtyBountyBoards(ctx);

  expect(notifier.bountyBoards).toEqual([
    {
      channelId: 'ch-bounty',
      messageId: expect.any(String),
      view: {
        sessionId,
        startsAt,
        modeName: 'Cổ điển (Classic)',
        status: 'scheduled',
        bounties: [
          { id: kills, title: 'Giết 3 ngỗng', description: 'Trong một ván', points: 10, icon: duck.icon },
          { id: survive, title: 'Sống sót', description: null, points: 3, icon: '🎯' },
        ],
      },
    },
  ]);
  const messageId = notifier.bountyBoards[0]?.messageId;
  expect(await row(sessionId)).toEqual({ bountyChannelId: 'ch-bounty', bountyMessageId: messageId, bountyDirty: false });

  // Lượt sau không còn gì bẩn → không gửi gì nữa.
  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoards).toHaveLength(1);
  expect(notifier.bountyBoardUpdates).toEqual([]);
  expect(errors).not.toHaveBeenCalled();
});

test('a session without bounties posts nothing and its flag clears', async () => {
  const sessionId = await newSession();
  expect((await row(sessionId)).bountyDirty).toBe(true);
  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoards).toEqual([]);
  expect(await row(sessionId)).toEqual({ bountyChannelId: null, bountyMessageId: null, bountyDirty: false });
});

test('changing a bounty edits the board; removing the last bounty deletes it', async () => {
  const sessionId = await newSession();
  const id = await bounty({ sessionId });
  await syncDirtyBountyBoards(ctx);
  const messageId = notifier.bountyBoards[0]!.messageId;

  await updateBounty(ctx, id, { points: 7 });
  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoards).toHaveLength(1);
  expect(notifier.bountyBoardUpdates).toEqual([
    { channelId: 'ch-bounty', messageId, view: expect.objectContaining({ bounties: [expect.objectContaining({ id, points: 7 })] }) },
  ]);

  await deleteBounty(ctx, id);
  await syncDirtyBountyBoards(ctx);
  expect(notifier.deletedMessages).toEqual([{ channelId: 'ch-bounty', messageId }]);
  expect(await row(sessionId)).toEqual({ bountyChannelId: null, bountyMessageId: null, bountyDirty: false });
});

test('rescheduling edits the board with the new time; cancelling turns it into Buổi đã huỷ', async () => {
  const sessionId = await newSession();
  await bounty();
  await syncDirtyBountyBoards(ctx);
  const messageId = notifier.bountyBoards[0]!.messageId;

  const later = new Date('2026-10-22T15:00:00Z');
  await updateSession(ctx, mod.id, sessionId, { startsAt: later });
  expect((await row(sessionId)).bountyDirty).toBe(true);
  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoardUpdates.at(-1)).toMatchObject({ messageId, view: { startsAt: later, status: 'scheduled' } });

  // Sửa thứ khác (mã phòng) không làm bẩn tin treo thưởng.
  await updateSession(ctx, mod.id, sessionId, { roomCode: 'ABC' });
  expect((await row(sessionId)).bountyDirty).toBe(false);

  await cancelSession(ctx, sessionId);
  expect((await row(sessionId)).bountyDirty).toBe(true);
  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoardUpdates.at(-1)).toEqual({
    channelId: 'ch-bounty',
    messageId,
    view: { sessionId, startsAt: later, modeName: 'Cổ điển (Classic)', status: 'cancelled', bounties: [] },
  });
  expect(notifier.bountyBoards).toHaveLength(1);
  expect(await row(sessionId)).toEqual({ bountyChannelId: 'ch-bounty', bountyMessageId: messageId, bountyDirty: false });
});

test('a cancelled session that never had a board posts nothing', async () => {
  const sessionId = await newSession();
  await cancelSession(ctx, sessionId);
  await bounty();
  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoards).toEqual([]);
  expect((await row(sessionId)).bountyDirty).toBe(false);
});

test('an ended session keeps its board untouched', async () => {
  const sessionId = await newSession();
  await bounty({ sessionId });
  await syncDirtyBountyBoards(ctx);
  const before = await row(sessionId);
  await endSession(ctx, sessionId, []);
  await testDb.gameSession.update({ where: { id: sessionId }, data: { bountyDirty: true } });

  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoards).toHaveLength(1);
  expect(notifier.bountyBoardUpdates).toEqual([]);
  expect(notifier.deletedMessages).toEqual([]);
  expect(await row(sessionId)).toEqual({ ...before, bountyDirty: false });
});

test('a board deleted by hand is posted again', async () => {
  const sessionId = await newSession();
  const id = await bounty();
  await syncDirtyBountyBoards(ctx);
  const old = notifier.bountyBoards[0]!.messageId;
  notifier.goneMessageIds.add(old);

  await updateBounty(ctx, id, { title: 'Đổi tên' });
  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoards).toHaveLength(2);
  const fresh = notifier.bountyBoards[1]!.messageId;
  expect(fresh).not.toBe(old);
  expect(await row(sessionId)).toEqual({ bountyChannelId: 'ch-bounty', bountyMessageId: fresh, bountyDirty: false });
});

test('Discord down: the flag stays for the next run, which posts the board', async () => {
  const sessionId = await newSession();
  await bounty();
  notifier.down = true;
  await syncDirtyBountyBoards(ctx);
  expect(errors).toHaveBeenCalled();
  expect((await row(sessionId)).bountyDirty).toBe(true);

  notifier.down = false;
  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoards).toHaveLength(1);
  expect((await row(sessionId)).bountyDirty).toBe(false);
});

test('a change that lands while the board is being sent keeps the flag', async () => {
  const sessionId = await newSession();
  await bounty();
  const publish = notifier.publishBountyBoard.bind(notifier);
  notifier.publishBountyBoard = async (channelId, view) => {
    const id = await publish(channelId, view);
    // Một thay đổi khác ghi vào dòng buổi đúng lúc đang đăng.
    await testDb.gameSession.update({ where: { id: sessionId }, data: { bountyDirty: true } });
    return id;
  };
  await syncBountyBoard(ctx, sessionId);
  expect(await row(sessionId)).toMatchObject({ bountyMessageId: notifier.bountyBoards[0]!.messageId, bountyDirty: true });
});

test('a board in another (old) channel is replaced by one in the configured channel', async () => {
  const sessionId = await newSession();
  await bounty();
  await testDb.gameSession.update({ where: { id: sessionId }, data: { bountyChannelId: 'ch-old', bountyMessageId: 'old-1' } });
  await syncDirtyBountyBoards(ctx);
  expect(notifier.bountyBoardUpdates).toEqual([]);
  expect(notifier.bountyBoards).toEqual([expect.objectContaining({ channelId: 'ch-bounty' })]);
  expect(await row(sessionId)).toMatchObject({ bountyChannelId: 'ch-bounty', bountyDirty: false });
});

test('without DISCORD_BOUNTY_CHANNEL_ID nothing is posted and the flags wait', async () => {
  ctx.config.discord.bountyChannelId = null;
  const sessionId = await newSession();
  await bounty();
  await syncDirtyBountyBoards(ctx);
  await syncBountyBoard(ctx, sessionId);
  expect(notifier.bountyBoards).toEqual([]);
  expect((await row(sessionId)).bountyDirty).toBe(true);
});

test('the scheduler runs the bounty sync job right after session-sync', async () => {
  const names = defaultJobs().map((j) => j.name);
  expect(names.indexOf('bounty-sync')).toBe(names.indexOf('session-sync') + 1);

  await newSession();
  await bounty();
  const results = await runTick(ctx, defaultJobs().filter((j) => j.name === 'bounty-sync'));
  expect(results).toEqual([{ name: 'bounty-sync', ok: true }]);
  expect(notifier.bountyBoards).toHaveLength(1);
});
