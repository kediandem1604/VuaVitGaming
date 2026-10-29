import type { Member, Role } from '@prisma/client';
import { beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb, dbToDateOnly } from '../../src/server/lib/time.js';
import { runMultiplierJobs } from '../../src/server/modules/multipliers/jobs.js';
import {
  announceCreated,
  createMultiplierDay,
  deleteMultiplierDay,
  listMultiplierDaysAdmin,
  listUpcomingMultiplierDays,
  updateMultiplierDay,
} from '../../src/server/modules/multipliers/service.js';
import { closeSeason, ensureSeason } from '../../src/server/modules/seasons/service.js';
import {
  getFactionTop,
  getFactionTotalBoards,
  getFactionTotals,
  getHall,
  getRoleLeaderboard,
} from '../../src/server/modules/stats/leaderboard.js';
import { listMyReports, listPendingReports, reviewReport, submitReport } from '../../src/server/modules/stats/reports.js';
import { reportPoints } from '../../src/shared/metric.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';
import { patchDelegate } from '../helpers/prisma.js';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let a: Member; // An
let b: Member; // Bình
let mod: Member;
let admin: Member;
let duck: Role;
let vigilante: Role; // Dân phòng: 5 điểm/lần trúng, −3 mỗi phát sai (phe ngỗng)
let assassin: Role; // Sát thủ: 1 điểm/mạng, +3 mỗi lần ám sát họp (phe vịt)

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  a = await createMember(testDb, { displayName: 'An' });
  b = await createMember(testDb, { displayName: 'Bình' });
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  admin = await createMember(testDb, { accessLevel: 'admin', displayName: 'Admin' });
  duck = await roleByKey(testDb, 'duck');
  vigilante = await roleByKey(testDb, 'vigilante');
  assassin = await roleByKey(testDb, 'assassin');
});

/** Ghi thẳng một ngày nhân điểm (kể cả ngày đã qua — service không cho tạo). */
async function rawDay(day: string, multiplier: number, o: { message?: string | null; announced?: boolean } = {}): Promise<number> {
  const row = await testDb.scoreMultiplierDay.create({
    data: {
      day: dateOnlyToDb(day),
      multiplier,
      message: o.message ?? null,
      createdById: admin.id,
      announcedAt: o.announced === false ? null : ctx.now(),
    },
  });
  return row.id;
}

/** Ghi thẳng một lần khai đã duyệt (đủ trường phạt/bonus/nguồn). */
async function approvedRaw(
  memberId: number,
  o: { roleId: number; playedOn: string; value: number; extraValue?: number; penaltyValue?: number; bonusPoints?: number; source?: 'self' | 'accusation'; at?: string },
): Promise<number> {
  const row = await testDb.statReport.create({
    data: {
      memberId,
      roleId: o.roleId,
      playedOn: dateOnlyToDb(o.playedOn),
      value: o.value,
      extraValue: o.extraValue ?? 0,
      penaltyValue: o.penaltyValue ?? 0,
      bonusPoints: o.bonusPoints ?? 0,
      source: o.source ?? 'self',
      status: 'approved',
      reviewedById: mod.id,
      reviewedAt: new Date(o.at ?? '2026-10-10T03:00:00Z'),
    },
  });
  return row.id;
}

/** Một lần nhận treo thưởng đã duyệt (điểm chép trên lần nhận). */
async function approvedClaim(memberId: number, o: { roleId: number | null; points: number; playedOn: string }): Promise<void> {
  const session = await createSession(testDb, { createdById: mod.id, startsAt: new Date(`${o.playedOn}T13:00:00Z`) });
  const bounty = await testDb.bounty.create({ data: { title: 'Mục', points: o.points, roleId: o.roleId, createdById: mod.id } });
  await testDb.bountyClaim.create({
    data: {
      bountyId: bounty.id,
      memberId,
      sessionId: session.id,
      playedOn: dateOnlyToDb(o.playedOn),
      roleId: o.roleId,
      points: o.points,
      status: 'approved',
      source: 'web',
      reviewedById: mod.id,
      reviewedAt: new Date('2026-10-10T04:00:00Z'),
    },
  });
}

const scores = async (roleId: number, seasonId = '2026-10') =>
  (await getRoleLeaderboard(ctx, roleId, seasonId)).map((r) => [r.memberId, r.score]);

// ---------------------------------------------------------------------------
// Công thức (spec §3)
// ---------------------------------------------------------------------------

test('reportPoints multiplies only the positive part', () => {
  const role = { metricLabel: 'x', points: 5, extraMetricLabel: 'y', extraPoints: 3, penaltyMetricLabel: 'z', penaltyMaxPerGame: 1, penaltyPoints: 4 };
  const r = { value: 2, extraValue: 1, penaltyValue: 1, bonusPoints: 1 };
  expect(reportPoints(r, role)).toBe(10 + 3 - 4 + 1);
  expect(reportPoints(r, role, 1)).toBe(10);
  expect(reportPoints(r, role, 3)).toBe((10 + 3) * 3 - 4 + 1);
  // Phần trừ lớn hơn phần cộng đã nhân: vẫn đúng công thức, có thể âm.
  expect(reportPoints({ value: 0, extraValue: 0, penaltyValue: 1, bonusPoints: 0 }, role, 5)).toBe(-4);
});

test('a multiplier day multiplies value and extra points; penalty, bonus and bounty claims are not multiplied', async () => {
  setNow('2026-10-10T05:00:00Z');
  const dayId = await rawDay('2026-10-09', 3);
  // An, Dân phòng: ngày 09 (×3) 1 trúng 1 sai +1 bonus → 5×3 − 3 + 1 = 13; ngày 10 (không nhân) 1 trúng → 5.
  const boostedId = await approvedRaw(a.id, { roleId: vigilante.id, playedOn: '2026-10-09', value: 1, penaltyValue: 1, bonusPoints: 1 });
  const plainId = await approvedRaw(a.id, { roleId: vigilante.id, playedOn: '2026-10-10', value: 1 });
  // Treo thưởng 4 điểm chơi ngày 09: không nhân.
  await approvedClaim(a.id, { roleId: vigilante.id, points: 4, playedOn: '2026-10-09' });
  // Bình, Sát thủ ngày 09: (2 + 1 × 3) × 3 = 15.
  await approvedRaw(b.id, { roleId: assassin.id, playedOn: '2026-10-09', value: 2, extraValue: 1 });

  expect(await scores(vigilante.id)).toEqual([[a.id, 13 + 5 + 4]]);
  expect(await scores(assassin.id)).toEqual([[b.id, 15]]);
  const mine = await listMyReports(ctx, a.id);
  expect(mine.find((r) => r.id === boostedId)).toMatchObject({ multiplier: 3, points: 13 });
  expect(mine.find((r) => r.id === plainId)).toMatchObject({ multiplier: 1, points: 5 });

  // Đọc hệ số HIỆN TẠI: đổi ×3 → ×2 đổi điểm theo; xoá ngày → về điểm thường.
  await testDb.scoreMultiplierDay.update({ where: { id: dayId }, data: { multiplier: 2 } });
  expect(await scores(vigilante.id)).toEqual([[a.id, 8 + 5 + 4]]);
  expect((await listMyReports(ctx, a.id)).find((r) => r.id === boostedId)).toMatchObject({ multiplier: 2, points: 8 });
  await testDb.scoreMultiplierDay.delete({ where: { id: dayId } });
  expect(await scores(vigilante.id)).toEqual([[a.id, 3 + 5 + 4]]);
  expect(await scores(assassin.id)).toEqual([[b.id, 5]]);
});

test('penalties bigger than the multiplied plus part: the cell follows the formula and non-positive cells behave as before', async () => {
  setNow('2026-10-10T05:00:00Z');
  await rawDay('2026-10-09', 2);
  // An, Dân phòng ngày 09 ×2: 1 trúng (+10), 1 lần khai 0 trúng 1 sai (−3), 1 mục trừ điểm do báo cáo (−3) → 4.
  await approvedRaw(a.id, { roleId: vigilante.id, playedOn: '2026-10-09', value: 1 });
  await approvedRaw(a.id, { roleId: vigilante.id, playedOn: '2026-10-09', value: 0, penaltyValue: 1 });
  const penaltyId = await approvedRaw(a.id, { roleId: vigilante.id, playedOn: '2026-10-09', value: 0, penaltyValue: 1, source: 'accusation' });
  // Bình: Dân phòng ngày 09 chỉ có 2 phát sai → −6 (không lên bảng role); Sát thủ ngày 10 → 7.
  await approvedRaw(b.id, { roleId: vigilante.id, playedOn: '2026-10-09', value: 0, penaltyValue: 1 });
  await approvedRaw(b.id, { roleId: vigilante.id, playedOn: '2026-10-09', value: 0, penaltyValue: 1, source: 'accusation' });
  await approvedRaw(b.id, { roleId: assassin.id, playedOn: '2026-10-10', value: 7 });

  expect(await scores(vigilante.id)).toEqual([[a.id, 4]]);
  // Tổng "Cả 3 phe" vẫn cộng cả ô âm: Bình 7 − 6 = 1; An 4.
  const totals = await getFactionTotals(ctx, '2026-10', a.id);
  expect(totals.boards.all.top.map((r) => [r.memberId, r.points])).toEqual([
    [a.id, 4],
    [b.id, 1],
  ]);
  expect(totals.boards.goose.top.map((r) => [r.memberId, r.points])).toEqual([[a.id, 4]]);
  // Mục trừ điểm luôn hệ số 1 (không có phần cộng để nhân).
  const dto = (await listMyReports(ctx, a.id)).find((r) => r.id === penaltyId);
  expect(dto).toMatchObject({ source: 'accusation', multiplier: 1, points: -3 });
});

test('a multiplier day on a month boundary only multiplies reports of its own season', async () => {
  setNow('2026-11-01T05:00:00Z');
  await rawDay('2026-10-31', 2);
  await rawDay('2026-11-01', 3);
  await approvedRaw(a.id, { roleId: duck.id, playedOn: '2026-10-30', value: 2 });
  await approvedRaw(a.id, { roleId: duck.id, playedOn: '2026-10-31', value: 2 });
  await approvedRaw(a.id, { roleId: duck.id, playedOn: '2026-11-01', value: 2 });
  const p = duck.points;
  expect(await scores(duck.id, '2026-10')).toEqual([[a.id, 2 * p + 2 * p * 2]]);
  expect(await scores(duck.id, '2026-11')).toEqual([[a.id, 2 * p * 3]]);
});

test('every season board uses multiplied points: role board, Top per faction, totals, Hall, season close', async () => {
  setNow('2026-10-10T05:00:00Z');
  await rawDay('2026-10-09', 2);
  // An 3 Vịt ngày 10 (không nhân); Bình 2 Vịt ngày 09 (×2) → Bình 4 > An 3.
  const p = duck.points;
  await approvedRaw(a.id, { roleId: duck.id, playedOn: '2026-10-10', value: 3, at: '2026-10-10T01:00:00Z' });
  await approvedRaw(b.id, { roleId: duck.id, playedOn: '2026-10-09', value: 2, at: '2026-10-10T02:00:00Z' });

  expect(await scores(duck.id)).toEqual([
    [b.id, 4 * p],
    [a.id, 3 * p],
  ]);
  expect((await getFactionTop(ctx, '2026-10')).factions.duck.map((r) => [r.memberId, r.points])).toEqual([
    [b.id, 4 * p],
    [a.id, 3 * p],
  ]);
  expect((await getFactionTotals(ctx, '2026-10', a.id)).boards.duck.top.map((r) => [r.memberId, r.points])).toEqual([
    [b.id, 4 * p],
    [a.id, 3 * p],
  ]);
  expect((await getFactionTotalBoards(ctx, '2026-10')).duck).toEqual([
    { memberId: b.id, points: 4 * p },
    { memberId: a.id, points: 3 * p },
  ]);
  expect((await getHall(ctx, '2026-10')).roles.find((r) => r.role.id === duck.id)?.holder).toMatchObject({ memberId: b.id, score: 4 * p });

  await ensureSeason(ctx, '2026-10');
  setNow('2026-11-04T00:00:00Z');
  await closeSeason(ctx, '2026-10');
  expect(await testDb.roleTitle.findMany({ where: { seasonId: '2026-10', roleId: duck.id } })).toMatchObject([{ memberId: b.id, score: 4 * p }]);
});

test('report DTOs in the review queue carry the multiplier; one lookup covers the whole list', async () => {
  setNow('2026-10-10T05:00:00Z');
  await rawDay('2026-10-08', 4);
  await submitReport(ctx, a.id, { roleId: duck.id, value: 1, playedOn: '2026-10-08' });
  await submitReport(ctx, b.id, { roleId: duck.id, value: 1, playedOn: '2026-10-10' });
  let lookups = 0;
  const restore = patchDelegate(testDb.scoreMultiplierDay, 'findMany', (orig) => ((args: never) => {
    lookups += 1;
    return orig(args);
  }) as typeof orig);
  let queue;
  try {
    queue = await listPendingReports(ctx);
  } finally {
    restore();
  }
  expect(queue.map((r) => [r.member.id, r.multiplier, r.points])).toEqual([
    [a.id, 4, 4 * duck.points],
    [b.id, 1, duck.points],
  ]);
  expect(lookups).toBe(1);
  // Duyệt xong vẫn là điểm đã nhân trên bảng.
  await reviewReport(ctx, { id: mod.id, accessLevel: 'mod' }, queue[0]!.id, { approve: true });
  expect(await scores(duck.id)).toEqual([[a.id, 4 * duck.points]]);
});

test('a season without multiplier days runs no extra grouping query', async () => {
  setNow('2026-10-10T05:00:00Z');
  await approvedRaw(a.id, { roleId: duck.id, playedOn: '2026-10-10', value: 1 });
  let groupBys = 0;
  const restore = patchDelegate(testDb.statReport, 'groupBy', (orig) => ((args: never) => {
    groupBys += 1;
    return orig(args);
  }) as typeof orig);
  try {
    await getRoleLeaderboard(ctx, duck.id, '2026-10');
    expect(groupBys).toBe(1);
    await rawDay('2026-10-10', 2);
    groupBys = 0;
    await getRoleLeaderboard(ctx, duck.id, '2026-10');
    expect(groupBys).toBe(2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Quản trị (spec §4) — mặc định 19:00 Thứ Năm 22/10/2026 giờ VN
// ---------------------------------------------------------------------------

test('creating a day announces it on Discord with the weekday, the multiplier and the escaped message', async () => {
  const dto = await createMultiplierDay(ctx, admin.id, { day: '2026-10-24', multiplier: 3, message: '  Cuối tuần *vui* @everyone ' });
  expect(dto).toMatchObject({ day: '2026-10-24', multiplier: 3, message: 'Cuối tuần *vui* @everyone', past: false });
  expect(notifier.announcements).toEqual(['🔥 Thứ Bảy 24/10: điểm cộng ×3!\nCuối tuần \\*vui\\* @everyone']);
  const row = await testDb.scoreMultiplierDay.findUniqueOrThrow({ where: { id: dto.id } });
  expect(row.announcedAt).toEqual(ctx.now());
  expect(row.remindedAt).toBeNull();
  expect(row.createdById).toBe(admin.id);

  // Không lời nhắn (rỗng → null): một dòng.
  await createMultiplierDay(ctx, admin.id, { day: '2026-10-25', multiplier: 2, message: '   ' });
  expect(notifier.announcements[1]).toBe('🔥 Chủ Nhật 25/10: điểm cộng ×2!');
});

test('create validation: duplicate day, past day, multiplier range, message length, bad date', async () => {
  await createMultiplierDay(ctx, admin.id, { day: '2026-10-24', multiplier: 3 });
  await expect(createMultiplierDay(ctx, admin.id, { day: '2026-10-24', multiplier: 2 })).rejects.toMatchObject({
    code: 'MULTIPLIER_DAY_TAKEN',
    status: 409,
    message: 'Ngày này đã có hệ số nhân',
  });
  await expect(createMultiplierDay(ctx, admin.id, { day: '2026-10-21', multiplier: 2 })).rejects.toMatchObject({
    code: 'MULTIPLIER_DAY_PAST',
    message: 'Chỉ đặt được cho hôm nay hoặc sau này',
  });
  for (const multiplier of [1, 6, 2.5, Number.NaN]) {
    await expect(createMultiplierDay(ctx, admin.id, { day: '2026-10-26', multiplier })).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'Hệ số phải từ ×2 đến ×5',
    });
  }
  await expect(createMultiplierDay(ctx, admin.id, { day: '2026-10-26', multiplier: 2, message: 'x'.repeat(101) })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Lời nhắn tối đa 100 ký tự',
  });
  await createMultiplierDay(ctx, admin.id, { day: '2026-10-26', multiplier: 5, message: 'x'.repeat(100) });
  for (const day of ['2026-02-30', '26-10-27', 'mai']) {
    await expect(createMultiplierDay(ctx, admin.id, { day, multiplier: 2 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Ngày không hợp lệ' });
  }
  expect(await testDb.scoreMultiplierDay.count()).toBe(2);
});

test('editing the multiplier or message of an announced day posts an update; no change posts nothing', async () => {
  const { id } = await createMultiplierDay(ctx, admin.id, { day: '2026-10-24', multiplier: 3, message: 'Vui' });
  notifier.announcements.length = 0;
  expect(await updateMultiplierDay(ctx, id, { multiplier: 4 })).toMatchObject({ multiplier: 4, message: 'Vui' });
  expect(notifier.announcements).toEqual(['✏️ Cập nhật 24/10: điểm cộng ×4\nVui']);
  await updateMultiplierDay(ctx, id, { message: null });
  expect(notifier.announcements[1]).toBe('✏️ Cập nhật 24/10: điểm cộng ×4');
  await updateMultiplierDay(ctx, id, { multiplier: 4 });
  expect(notifier.announcements).toHaveLength(2);
  await expect(updateMultiplierDay(ctx, id, { multiplier: 9 })).rejects.toMatchObject({ message: 'Hệ số phải từ ×2 đến ×5' });
  await expect(updateMultiplierDay(ctx, 999_999, { multiplier: 2 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('moving an announced day to another date cancels the old one and announces the new one', async () => {
  const { id } = await createMultiplierDay(ctx, admin.id, { day: '2026-10-24', multiplier: 3 });
  await createMultiplierDay(ctx, admin.id, { day: '2026-10-30', multiplier: 2 });
  notifier.announcements.length = 0;
  await expect(updateMultiplierDay(ctx, id, { day: '2026-10-30' })).rejects.toMatchObject({ code: 'MULTIPLIER_DAY_TAKEN' });
  await expect(updateMultiplierDay(ctx, id, { day: '2026-10-01' })).rejects.toMatchObject({ code: 'MULTIPLIER_DAY_PAST' });
  expect(await updateMultiplierDay(ctx, id, { day: '2026-10-27' })).toMatchObject({ day: '2026-10-27', multiplier: 3 });
  expect(notifier.announcements).toEqual(['❌ Huỷ ngày nhân điểm 24/10', '🔥 Thứ Ba 27/10: điểm cộng ×3!']);
});

/**
 * Bộ hẹn giờ đăng bù tin tạo đúng lúc admin sửa/xoá: chạy `announceCreated` ngay sau lần đọc đầu tiên
 * của service (trước lệnh ghi) — quyết định đăng "✏️"/"❌" phải theo trạng thái lúc ghi, không theo lần đọc.
 */
async function withBackfillAfterFirstRead<T>(id: number, act: () => Promise<T>): Promise<T> {
  let fired = false;
  const restore = patchDelegate(testDb.scoreMultiplierDay, 'findUnique', (orig) => (async (args: never) => {
    const result = await orig(args);
    if (!fired) {
      fired = true;
      await announceCreated(ctx, id);
    }
    return result;
  }) as typeof orig);
  try {
    return await act();
  } finally {
    restore();
  }
}

test('a backfilled creation post landing mid-edit still gets the update post', async () => {
  const id = await rawDay('2026-10-24', 3, { announced: false });
  await withBackfillAfterFirstRead(id, () => updateMultiplierDay(ctx, id, { multiplier: 4 }));
  expect(notifier.announcements).toEqual(['🔥 Thứ Bảy 24/10: điểm cộng ×3!', '✏️ Cập nhật 24/10: điểm cộng ×4']);
});

test('a backfilled creation post landing mid-move still cancels the old date', async () => {
  const id = await rawDay('2026-10-24', 3, { announced: false });
  await withBackfillAfterFirstRead(id, () => updateMultiplierDay(ctx, id, { day: '2026-10-27' }));
  expect(notifier.announcements).toEqual([
    '🔥 Thứ Bảy 24/10: điểm cộng ×3!',
    '❌ Huỷ ngày nhân điểm 24/10',
    '🔥 Thứ Ba 27/10: điểm cộng ×3!',
  ]);
});

test('a backfilled creation post landing mid-delete still gets the cancellation', async () => {
  const id = await rawDay('2026-10-24', 3, { announced: false });
  await withBackfillAfterFirstRead(id, () => deleteMultiplierDay(ctx, id));
  expect(notifier.announcements).toEqual(['🔥 Thứ Bảy 24/10: điểm cộng ×3!', '❌ Huỷ ngày nhân điểm 24/10']);
});

test('deleting an announced day posts a cancellation; past days cannot be edited or deleted', async () => {
  const { id } = await createMultiplierDay(ctx, admin.id, { day: '2026-10-22', multiplier: 2 });
  notifier.announcements.length = 0;
  await deleteMultiplierDay(ctx, id);
  expect(notifier.announcements).toEqual(['❌ Huỷ ngày nhân điểm 22/10']);
  expect(await testDb.scoreMultiplierDay.count()).toBe(0);
  await expect(deleteMultiplierDay(ctx, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

  const past = await rawDay('2026-10-21', 3);
  for (const attempt of [() => updateMultiplierDay(ctx, past, { multiplier: 2 }), () => deleteMultiplierDay(ctx, past)]) {
    await expect(attempt()).rejects.toMatchObject({ code: 'MULTIPLIER_DAY_LOCKED', status: 409, message: 'Ngày đã qua không sửa/xoá được' });
  }
  expect(await testDb.scoreMultiplierDay.findUniqueOrThrow({ where: { id: past } })).toMatchObject({ multiplier: 3 });
});

test('the admin list shows upcoming days nearest first, then past days of the open season; upcoming lists from today', async () => {
  await ensureSeason(ctx, '2026-09');
  await testDb.season.update({ where: { id: '2026-09' }, data: { closedAt: new Date('2026-10-03T17:05:00Z') } });
  await rawDay('2026-09-30', 2);
  await rawDay('2026-10-05', 2);
  await rawDay('2026-10-20', 3);
  await rawDay('2026-10-30', 4, { message: 'Cuối tháng' });
  await rawDay('2026-10-22', 5);
  await rawDay('2026-11-02', 2);
  expect((await listMultiplierDaysAdmin(ctx)).map((d) => [d.day, d.past])).toEqual([
    ['2026-10-22', false],
    ['2026-10-30', false],
    ['2026-11-02', false],
    ['2026-10-20', true],
    ['2026-10-05', true],
  ]);
  expect(await listUpcomingMultiplierDays(ctx)).toEqual([
    { id: expect.any(Number), day: '2026-10-22', multiplier: 5, message: null },
    { id: expect.any(Number), day: '2026-10-30', multiplier: 4, message: 'Cuối tháng' },
    { id: expect.any(Number), day: '2026-11-02', multiplier: 2, message: null },
  ]);

  // Ngày 2/11: mùa 10 chưa chốt → các ngày đã qua của tháng 10 vẫn hiện (mờ).
  setNow('2026-11-02T05:00:00Z');
  await ensureSeason(ctx, '2026-10');
  expect((await listMultiplierDaysAdmin(ctx)).map((d) => [d.day, d.past])).toEqual([
    ['2026-11-02', false],
    ['2026-10-30', true],
    ['2026-10-22', true],
    ['2026-10-20', true],
    ['2026-10-05', true],
  ]);
});

// ---------------------------------------------------------------------------
// Discord: đăng bù, nhắc 9:00 (spec §6)
// ---------------------------------------------------------------------------

test('Discord down at creation: the day is saved, the scheduler announces it later exactly once', async () => {
  notifier.down = true;
  const { id } = await createMultiplierDay(ctx, admin.id, { day: '2026-10-24', multiplier: 3 });
  expect(notifier.announcements).toEqual([]);
  expect((await testDb.scoreMultiplierDay.findUniqueOrThrow({ where: { id } })).announcedAt).toBeNull();
  // Chưa đăng → sửa/xoá không đăng "✏️"/"❌".
  await updateMultiplierDay(ctx, id, { multiplier: 4 });
  await runMultiplierJobs(ctx); // Discord vẫn sập: giữ cờ.
  expect((await testDb.scoreMultiplierDay.findUniqueOrThrow({ where: { id } })).announcedAt).toBeNull();

  notifier.down = false;
  await Promise.all([runMultiplierJobs(ctx), runMultiplierJobs(ctx)]);
  await runMultiplierJobs(ctx);
  expect(notifier.announcements).toEqual(['🔥 Thứ Bảy 24/10: điểm cộng ×4!']);

  // Ngày đã qua chưa đăng: không đăng bù nữa.
  await rawDay('2026-10-21', 2, { announced: false });
  await runMultiplierJobs(ctx);
  expect(notifier.announcements).toHaveLength(1);
});

test('a deleted unannounced day posts nothing', async () => {
  notifier.down = true;
  const { id } = await createMultiplierDay(ctx, admin.id, { day: '2026-10-24', multiplier: 3 });
  notifier.down = false;
  await deleteMultiplierDay(ctx, id);
  await runMultiplierJobs(ctx);
  expect(notifier.announcements).toEqual([]);
});

test('the 9:00 reminder is posted once on the day itself, never on other days', async () => {
  await createMultiplierDay(ctx, admin.id, { day: '2026-10-24', multiplier: 3, message: 'Chơi _hết_ mình' });
  await createMultiplierDay(ctx, admin.id, { day: '2026-10-25', multiplier: 2 });
  notifier.announcements.length = 0;

  setNow('2026-10-24T01:59:00Z'); // 08:59 VN
  await runMultiplierJobs(ctx);
  expect(notifier.announcements).toEqual([]);

  setNow('2026-10-24T02:00:00Z'); // 09:00 VN
  await Promise.all([runMultiplierJobs(ctx), runMultiplierJobs(ctx)]);
  setNow('2026-10-24T02:30:00Z');
  await runMultiplierJobs(ctx);
  setNow('2026-10-24T02:59:00Z');
  await runMultiplierJobs(ctx);
  expect(notifier.announcements).toEqual(['🔥 Hôm nay điểm cộng ×3!\nChơi \\_hết\\_ mình']);
  const row = await testDb.scoreMultiplierDay.findFirstOrThrow({ where: { day: dateOnlyToDb('2026-10-24') } });
  expect(row.remindedAt).toEqual(new Date('2026-10-24T02:00:00Z'));
  expect((await testDb.scoreMultiplierDay.findFirstOrThrow({ where: { day: dateOnlyToDb('2026-10-25') } })).remindedAt).toBeNull();
});

test('a failed reminder is retried on the next tick of the same day', async () => {
  await createMultiplierDay(ctx, admin.id, { day: '2026-10-24', multiplier: 3 });
  notifier.announcements.length = 0;
  setNow('2026-10-24T02:00:00Z');
  notifier.down = true;
  await runMultiplierJobs(ctx);
  notifier.down = false;
  setNow('2026-10-24T02:01:00Z');
  await runMultiplierJobs(ctx);
  await runMultiplierJobs(ctx);
  expect(notifier.announcements).toEqual(['🔥 Hôm nay điểm cộng ×3!']);
});

test('a day created for today after 9:00 is not reminded again (the creation post covers it)', async () => {
  const { id } = await createMultiplierDay(ctx, admin.id, { day: '2026-10-22', multiplier: 2 });
  await runMultiplierJobs(ctx);
  expect(notifier.announcements).toEqual(['🔥 Thứ Năm 22/10: điểm cộng ×2!']);

  // Tạo trước 9:00 cho hôm nay → vẫn nhắc lúc 9:00.
  setNow('2026-10-23T00:30:00Z'); // 07:30 VN ngày 23
  await createMultiplierDay(ctx, admin.id, { day: '2026-10-23', multiplier: 3 });
  setNow('2026-10-23T02:00:00Z');
  await runMultiplierJobs(ctx);
  expect(notifier.announcements.slice(1)).toEqual(['🔥 Thứ Sáu 23/10: điểm cộng ×3!', '🔥 Hôm nay điểm cộng ×3!']);
  expect(dbToDateOnly((await testDb.scoreMultiplierDay.findUniqueOrThrow({ where: { id } })).day)).toBe('2026-10-22');
});
