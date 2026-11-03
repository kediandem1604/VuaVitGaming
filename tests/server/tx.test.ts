import type { PrismaClient } from '@prisma/client';
import { beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { HOT_TX } from '../../src/server/lib/tx.js';
import { markMemberLeft } from '../../src/server/modules/members/service.js';
import { castVote, closeVoteRound, openVoteRound } from '../../src/server/modules/mvp/votes.js';
import { closeSeason } from '../../src/server/modules/seasons/service.js';
import { endSession } from '../../src/server/modules/sessions/end.js';
import { setAttendance } from '../../src/server/modules/sessions/service.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession } from '../helpers/factories.js';

beforeEach(resetDb);

/**
 * Bản sao ctx ghi lại tuỳ chọn (đối số thứ hai) của mọi lời gọi `db.$transaction`, rồi
 * chuyển tiếp nguyên vẹn tới DB thật. (PrismaClient là Proxy — không spy được, xem mvp.test.ts.)
 */
function recordingCtx(ctx: Ctx): { ctx: Ctx; options: unknown[] } {
  const options: unknown[] = [];
  const db = new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === '$transaction') {
        return (arg: unknown, opts?: unknown) => {
          options.push(opts);
          return (testDb.$transaction as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
        };
      }
      const value = Reflect.get(testDb, prop) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(testDb) : value;
    },
  });
  return { ctx: { ...ctx, db }, options };
}

test('hot-path interactive transactions run with HOT_TX (timeout 15 s, maxWait 10 s)', async () => {
  expect(HOT_TX).toEqual({ timeout: 15_000, maxWait: 10_000 });
  const { ctx: base } = makeTestCtx();
  const { ctx, options } = recordingCtx(base);
  const expectHot = async (what: string, run: () => Promise<unknown>) => {
    options.length = 0;
    await run();
    expect(options, what).toEqual([HOT_TX]);
  };

  const a = await createMember(testDb, { displayName: 'An' });
  const b = await createMember(testDb, { displayName: 'Bình' });
  const s = await createSession(testDb);
  await expectHot('setAttendance', () => setAttendance(ctx, s.id, a.id, true));
  await setAttendance(base, s.id, b.id, true);

  await expectHot('endSession', () => endSession(ctx, s.id));
  const round = await testDb.voteRound.findUniqueOrThrow({ where: { sessionId: s.id }, include: { messages: true } });
  const categoryId = round.messages[0]!.categoryId;
  await expectHot('castVote', () => castVote(ctx, { roundId: round.id, categoryId, voterId: a.id, nomineeId: b.id }));
  await expectHot('closeVoteRound', () => closeVoteRound(ctx, round.id));

  const other = await createSession(testDb);
  await testDb.attendance.create({ data: { sessionId: other.id, memberId: a.id, status: 'going' } });
  await expectHot('openVoteRound', () => openVoteRound(ctx, other.id, [categoryId]));

  await expectHot('closeSeason', () => closeSeason(ctx, '2026-09'));
  await expectHot('markMemberLeft', () => markMemberLeft(ctx, b.discordId));
});
