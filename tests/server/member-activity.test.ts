import { beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { setGamesTotal } from '../../src/server/modules/members/activity.js';
import { GAMES_INVALID_MESSAGE } from '../../src/shared/games.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession } from '../helpers/factories.js';

let ctx: Ctx;

beforeEach(async () => {
  await resetDb();
  ({ ctx } = makeTestCtx());
});

/** Một buổi với trạng thái `status` mà `memberId` điểm danh `going`. */
async function sessionWith(memberId: number, status: 'ended' | 'scheduled' = 'ended'): Promise<void> {
  const s = await createSession(testDb, { status, endedAt: status === 'ended' ? new Date('2026-10-20T16:00:00Z') : null });
  await testDb.attendance.create({ data: { sessionId: s.id, memberId, status: 'going' } });
}

test('setGamesTotal writes games − attended in one statement and reports attended and the previous total', async () => {
  const an = await createMember(testDb, { displayName: 'An', gamesAdjustment: 1 });
  await sessionWith(an.id);
  await sessionWith(an.id);
  await sessionWith(an.id, 'scheduled'); // chưa kết thúc: không tính

  const first = await setGamesTotal(ctx, an.id, 12);
  expect(first.attended).toBe(2);
  expect(first.previousGames).toBe(3); // 2 tự đếm + 1 chỉnh sẵn
  expect(first.member).toMatchObject({ id: an.id, displayName: 'An', gamesAdjustment: 10 });
  expect((await testDb.member.findUniqueOrThrow({ where: { id: an.id } })).gamesAdjustment).toBe(10);

  // Buổi kết thúc sau đó: tổng tiếp tục cộng; đặt lại 0 → chỉnh âm, previousGames là tổng cũ (13).
  await sessionWith(an.id);
  const zero = await setGamesTotal(ctx, an.id, 0);
  expect(zero).toMatchObject({ attended: 3, previousGames: 13 });
  expect(zero.member.gamesAdjustment).toBe(-3);

  // Người chưa đi buổi nào: phần chỉnh bằng đúng tổng đặt.
  const binh = await createMember(testDb, { displayName: 'Bình' });
  expect(await setGamesTotal(ctx, binh.id, 5)).toMatchObject({ attended: 0, previousGames: 0 });
  expect((await testDb.member.findUniqueOrThrow({ where: { id: binh.id } })).gamesAdjustment).toBe(5);
});

test('setGamesTotal rejects out-of-range totals and unknown members without writing', async () => {
  const an = await createMember(testDb, { displayName: 'An' });
  for (const games of [-1, 10001, 1.5, Number.NaN]) {
    await expect(setGamesTotal(ctx, an.id, games), String(games)).rejects.toMatchObject({ code: 'VALIDATION', message: GAMES_INVALID_MESSAGE });
  }
  await expect(setGamesTotal(ctx, an.id + 1000, 5)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await testDb.member.findUniqueOrThrow({ where: { id: an.id } })).gamesAdjustment).toBe(0);
});
