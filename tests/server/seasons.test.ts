import { beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { ensureSeason, isSeasonClosed } from '../../src/server/modules/seasons/service.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';

let ctx: Ctx;

beforeEach(async () => {
  await resetDb();
  ({ ctx } = makeTestCtx());
});

test('ensureSeason is idempotent and uses VN month boundaries', async () => {
  await ensureSeason(ctx, '2026-10');
  await ensureSeason(ctx, '2026-10');
  // 00:00 ngày 01/10 giờ VN = 17:00Z ngày 30/09; kết thúc = 00:00 ngày 01/11 giờ VN.
  expect(await testDb.season.findMany()).toEqual([
    {
      id: '2026-10',
      startsAt: new Date('2026-09-30T17:00:00Z'),
      endsAt: new Date('2026-10-31T17:00:00Z'),
      closedAt: null,
      reviewNudgedAt: null,
    },
  ]);

  // Năm nhuận và tháng 12 cuộn năm.
  await ensureSeason(ctx, '2024-02');
  expect(await testDb.season.findUnique({ where: { id: '2024-02' } })).toMatchObject({
    startsAt: new Date('2024-01-31T17:00:00Z'),
    endsAt: new Date('2024-02-29T17:00:00Z'),
  });
  await ensureSeason(ctx, '2026-12');
  expect(await testDb.season.findUnique({ where: { id: '2026-12' } })).toMatchObject({
    startsAt: new Date('2026-11-30T17:00:00Z'),
    endsAt: new Date('2026-12-31T17:00:00Z'),
  });

  // Mùa đã có (kể cả đã chốt) không bị đụng tới.
  const closedAt = new Date('2026-11-03T17:05:00Z');
  await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt, reviewNudgedAt: closedAt } });
  await ensureSeason(ctx, '2026-10');
  expect(await testDb.season.findUniqueOrThrow({ where: { id: '2026-10' } })).toMatchObject({ closedAt, reviewNudgedAt: closedAt });

  // Hai bên tạo cùng lúc: đúng một dòng, không ném lỗi.
  await Promise.all([ensureSeason(ctx, '2027-01'), ensureSeason(ctx, '2027-01'), ensureSeason(ctx, '2027-01')]);
  expect(await testDb.season.count({ where: { id: '2027-01' } })).toBe(1);
  expect(await testDb.season.count()).toBe(4);

  // Mã mùa sai định dạng là lỗi lập trình (người gọi phải kiểm tra trước).
  await expect(ensureSeason(ctx, '2026-13')).rejects.toThrow();
  await expect(ensureSeason(ctx, '2026/10')).rejects.toThrow();
});

test('isSeasonClosed is false until closedAt is set', async () => {
  expect(await isSeasonClosed(ctx, '2026-10')).toBe(false); // chưa có dòng = chưa chốt
  await ensureSeason(ctx, '2026-10');
  expect(await isSeasonClosed(ctx, '2026-10')).toBe(false);
  await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt: ctx.now() } });
  expect(await isSeasonClosed(ctx, '2026-10')).toBe(true);
  expect(await isSeasonClosed(ctx, '2026-09')).toBe(false);
});
