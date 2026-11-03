import type { Member } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb, smvpAwardAt } from '../../src/server/lib/time.js';
import { runBadgeJobs } from '../../src/server/modules/badges/jobs.js';
import { awardMonth, computeMonthlyBadges, deliverMonthSummary } from '../../src/server/modules/badges/monthly.js';
import { getRecentSmvp } from '../../src/server/modules/badges/queries.js';
import {
  SMVP_FROM,
  awardSmvp,
  buildSmvpAnnouncement,
  computeSmvp,
  deliverSmvpAnnouncement,
  runSmvpBadges,
} from '../../src/server/modules/badges/smvp.js';
import { ensureSeason } from '../../src/server/modules/seasons/service.js';
import { getFactionTotals } from '../../src/server/modules/stats/leaderboard.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';

/** Giờ trao SMVP tháng 10/2026: 00:05 ngày 01/11 giờ VN. */
const AWARD_AT = '2026-10-31T17:05:00Z';
/** Một phút trước giờ trao (00:04 ngày 01/11 giờ VN — đã sang tháng 11). */
const BEFORE_AWARD = '2026-10-31T17:04:00Z';
/** Hôm nay theo quyết định của chủ (03/11/2026, 10:00 VN) — tháng 10 chưa trao thì trao bù ngay. */
const NOV_3 = '2026-11-03T03:00:00Z';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let a: Member;
let b: Member;
let mod: Member;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  a = await createMember(testDb, { displayName: 'An' });
  b = await createMember(testDb, { displayName: 'Bình' });
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
});
afterEach(() => vi.restoreAllMocks());

const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const smvpRow = (periodId: string) => testDb.smvpMonth.findUnique({ where: { periodId } });
const smvpBadges = () => testDb.memberBadge.findMany({ where: { badgeKey: 'smvp' }, orderBy: { id: 'asc' } });

/** Lần khai đã duyệt chèn thẳng vào DB; `reviewedAt` mặc định 22:00 VN ngày chơi. */
async function report(memberId: number, roleKey: string, playedOn: string, value: number, reviewedAt?: string): Promise<void> {
  const role = await roleByKey(testDb, roleKey);
  const at = new Date(reviewedAt ?? `${playedOn}T15:00:00Z`);
  await testDb.statReport.create({
    data: { memberId, roleId: role.id, playedOn: dateOnlyToDb(playedOn), value, status: 'approved', reviewedById: mod.id, reviewedAt: at, createdAt: at },
  });
}

// ---------------------------------------------------------------------------
// Giờ trao
// ---------------------------------------------------------------------------

test('smvpAwardAt is 00:05 VN on day 1 of the next month', () => {
  expect(smvpAwardAt('2026-10')).toEqual(new Date(AWARD_AT));
  expect(smvpAwardAt('2026-12')).toEqual(new Date('2026-12-31T17:05:00Z'));
  expect(SMVP_FROM).toBe('2026-10');
});

// ---------------------------------------------------------------------------
// Tính SMVP
// ---------------------------------------------------------------------------

test('computeSmvp is rank 1 of the all-factions board, across factions', async () => {
  // An: Ngỗng 4 + Vịt 3 = 7 cả 3 phe; Bình: Vịt 6 — Bình đứng đầu phe Vịt nhưng An đứng đầu cả 3 phe.
  await report(a.id, 'goose', '2026-10-05', 4);
  await report(a.id, 'duck', '2026-10-06', 3);
  await report(b.id, 'duck', '2026-10-06', 6);

  const totals = await getFactionTotals(ctx, '2026-10', 0);
  expect(totals.boards.all.top[0]).toMatchObject({ memberId: a.id, points: 7 });
  expect(await computeSmvp(ctx, '2026-10')).toEqual({ memberId: a.id, points: 7 });
});

test('computeSmvp breaks ties like the board (who reached the total first)', async () => {
  // Cùng 5 điểm; Bình đạt trước (duyệt sớm hơn) → Bình hạng 1 dù id lớn hơn.
  await report(a.id, 'goose', '2026-10-05', 5, '2026-10-07T15:00:00Z');
  await report(b.id, 'goose', '2026-10-05', 5, '2026-10-06T15:00:00Z');
  expect((await getFactionTotals(ctx, '2026-10', 0)).boards.all.top[0]?.memberId).toBe(b.id);
  expect(await computeSmvp(ctx, '2026-10')).toEqual({ memberId: b.id, points: 5 });
});

test('computeSmvp is null when nobody has points > 0', async () => {
  expect(await computeSmvp(ctx, '2026-10')).toBeNull();
  // Điểm tháng khác không tính.
  await report(a.id, 'goose', '2026-11-01', 3);
  expect(await computeSmvp(ctx, '2026-10')).toBeNull();
});

test('the monthly batch at season close no longer awards smvp', async () => {
  await report(a.id, 'goose', '2026-10-05', 4);
  const grants = await computeMonthlyBadges(ctx, '2026-10');
  expect(grants.map((g) => g.badgeKey)).not.toContain('smvp');
  expect(grants.map((g) => g.badgeKey)).toContain('top_goose');
});

// ---------------------------------------------------------------------------
// Trao
// ---------------------------------------------------------------------------

test('awardSmvp writes the guard row and one frozen member badge, once even when concurrent', async () => {
  await report(a.id, 'goose', '2026-10-05', 7);
  setNow(AWARD_AT);

  const results = await Promise.all([awardSmvp(ctx, '2026-10'), awardSmvp(ctx, '2026-10')]);
  expect(results.filter((r) => r)).toHaveLength(1);
  expect(await smvpRow('2026-10')).toEqual({ periodId: '2026-10', memberId: a.id, points: 7, awardedAt: new Date(AWARD_AT), announcePending: true });
  const rows = await smvpBadges();
  expect(rows.map((r) => ({ memberId: r.memberId, periodId: r.periodId, title: r.title, icon: r.icon, detail: r.detail, awardedAt: r.awardedAt }))).toEqual([
    { memberId: a.id, periodId: '2026-10', title: 'SMVP tháng 10/2026', icon: '👑', detail: '7 điểm cả 3 phe', awardedAt: new Date(AWARD_AT) },
  ]);

  // Điểm đổi sau khi trao: không trao lại, chữ giữ nguyên.
  await report(b.id, 'goose', '2026-10-06', 20);
  expect(await awardSmvp(ctx, '2026-10')).toBe(false);
  expect(await smvpBadges()).toEqual(rows);
});

test('a month without points writes the guard row with no winner and posts nothing', async () => {
  setNow(AWARD_AT);
  expect(await awardSmvp(ctx, '2026-10')).toBe(true);
  expect(await smvpRow('2026-10')).toEqual({ periodId: '2026-10', memberId: null, points: null, awardedAt: new Date(AWARD_AT), announcePending: false });
  expect(await smvpBadges()).toEqual([]);

  // Điểm tới muộn không làm tháng có SMVP.
  await report(a.id, 'goose', '2026-10-05', 4);
  await runSmvpBadges(ctx);
  expect(await smvpBadges()).toEqual([]);
  expect(notifier.announcements).toEqual([]);
});

// ---------------------------------------------------------------------------
// Việc định kỳ
// ---------------------------------------------------------------------------

test('runSmvpBadges waits until 00:05 VN on day 1, then awards and announces', async () => {
  await report(a.id, 'goose', '2026-10-05', 4);

  setNow(BEFORE_AWARD);
  await runSmvpBadges(ctx);
  expect(await smvpRow('2026-10')).toBeNull();
  expect(notifier.announcements).toEqual([]);

  setNow(AWARD_AT);
  await runSmvpBadges(ctx);
  expect(await smvpRow('2026-10')).toMatchObject({ memberId: a.id, points: 4, announcePending: false });
  expect(notifier.announcements).toEqual(['🏆 Chúc mừng **An** đạt danh hiệu **SMVP tháng 10/2026** với 4 điểm!']);

  await runSmvpBadges(ctx);
  expect(notifier.announcements).toHaveLength(1);
  expect(await smvpBadges()).toHaveLength(1);
});

test('catch-up: on 03/11 October is awarded now, months before 2026-10 never', async () => {
  await report(a.id, 'goose', '2026-08-05', 9);
  await report(b.id, 'goose', '2026-09-05', 9);
  await report(a.id, 'goose', '2026-10-05', 4);
  await report(b.id, 'goose', '2026-11-02', 50); // tháng hiện tại — chưa xét

  setNow(NOV_3);
  await runSmvpBadges(ctx);
  expect((await testDb.smvpMonth.findMany()).map((m) => [m.periodId, m.memberId])).toEqual([['2026-10', a.id]]);
  expect((await smvpBadges()).map((r) => [r.periodId, r.memberId, r.awardedAt])).toEqual([['2026-10', a.id, new Date(NOV_3)]]);
  expect(notifier.announcements).toHaveLength(1);
});

test('catch-up spans several missed months, oldest first', async () => {
  await report(a.id, 'goose', '2026-10-05', 4);
  await report(b.id, 'duck', '2026-11-05', 2);
  setNow('2026-12-15T03:00:00Z');
  await runSmvpBadges(ctx);
  expect((await testDb.smvpMonth.findMany({ orderBy: { periodId: 'asc' } })).map((m) => [m.periodId, m.memberId, m.points])).toEqual([
    ['2026-10', a.id, 4],
    ['2026-11', b.id, 2],
  ]);
  expect(notifier.announcements).toEqual([
    '🏆 Chúc mừng **An** đạt danh hiệu **SMVP tháng 10/2026** với 4 điểm!',
    '🏆 Chúc mừng **Bình** đạt danh hiệu **SMVP tháng 11/2026** với 2 điểm!',
  ]);
});

test('Discord failure keeps announce_pending; the next run posts it once', async () => {
  silenceConsoleError();
  await report(a.id, 'goose', '2026-10-05', 4);
  setNow(NOV_3);

  notifier.down = true;
  await runSmvpBadges(ctx);
  expect(await smvpRow('2026-10')).toMatchObject({ announcePending: true });
  expect(notifier.announcements).toEqual([]);

  await runSmvpBadges(ctx);
  expect(await smvpBadges()).toHaveLength(1);

  notifier.down = false;
  await runSmvpBadges(ctx);
  expect(notifier.announcements).toHaveLength(1);
  expect(await smvpRow('2026-10')).toMatchObject({ announcePending: false });

  await deliverSmvpAnnouncement(ctx, '2026-10');
  expect(notifier.announcements).toHaveLength(1);
});

test('buildSmvpAnnouncement escapes markdown in the name', () => {
  expect(buildSmvpAnnouncement('2026-10', '*bold*_x', 12)).toBe('🏆 Chúc mừng **\\*bold\\*\\_x** đạt danh hiệu **SMVP tháng 10/2026** với 12 điểm!');
});

test('runBadgeJobs awards SMVP on day 1 and the rest of the month at season close, without smvp in the summary', async () => {
  await report(a.id, 'goose', '2026-10-05', 4);
  setNow(AWARD_AT);
  await runBadgeJobs(ctx);
  expect(await smvpRow('2026-10')).toMatchObject({ memberId: a.id });
  expect(await testDb.badgeMonth.count()).toBe(0);
  expect(notifier.announcements).toHaveLength(1);

  // Chốt mùa (ngày 4): các danh hiệu khác; SMVP không trao lại, không có trong tin tổng kết.
  await ensureSeason(ctx, '2026-10');
  await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt: new Date('2026-11-03T17:05:00Z') } });
  setNow('2026-11-03T17:05:00Z');
  await runBadgeJobs(ctx);
  expect((await testDb.memberBadge.findMany({ where: { periodId: '2026-10' }, orderBy: { id: 'asc' } })).map((r) => r.badgeKey)).toEqual(['smvp', 'top_goose']);
  expect(notifier.announcements).toHaveLength(2);
  expect(notifier.announcements[1]).toMatch(/^🏅 Danh hiệu tháng 10\/2026\n/);
  expect(notifier.announcements[1]).not.toContain('SMVP');
});

test('an old-rule smvp row of a month before 2026-10 still appears in its month summary', async () => {
  // Tháng 9 trao theo luật cũ (trước khi đổi) còn nợ tin tổng kết — đăng bù giữ nguyên dòng SMVP.
  await testDb.badgeMonth.create({ data: { periodId: '2026-09', awardedAt: new Date('2026-10-03T17:05:00Z'), announcePending: true } });
  await testDb.memberBadge.create({
    data: { memberId: a.id, badgeKey: 'smvp', periodId: '2026-09', title: 'SMVP tháng 09/2026', icon: '👑', detail: '3 lần MVP', awardedAt: new Date('2026-10-03T17:05:00Z') },
  });
  await deliverMonthSummary(ctx, '2026-09');
  expect(notifier.announcements[0]).toContain('👑 SMVP: An (3 lần MVP)');
  // awardMonth của tháng mới không bao giờ ghi smvp.
  await report(b.id, 'goose', '2026-10-05', 4);
  setNow(NOV_3);
  await awardMonth(ctx, '2026-10');
  expect((await smvpBadges()).map((r) => r.periodId)).toEqual(['2026-09']);
});

// ---------------------------------------------------------------------------
// Đọc cho web
// ---------------------------------------------------------------------------

test('getRecentSmvp returns the latest smvp award within 7 days, else null', async () => {
  await report(a.id, 'goose', '2026-10-05', 4);
  setNow(AWARD_AT);
  expect(await getRecentSmvp(ctx)).toBeNull();
  await runSmvpBadges(ctx);

  const recent = await getRecentSmvp(ctx);
  expect(recent).toMatchObject({ badgeKey: 'smvp', periodId: '2026-10', title: 'SMVP tháng 10/2026', detail: '4 điểm cả 3 phe', awardedAt: new Date(AWARD_AT).toISOString() });
  expect(recent?.member).toEqual({ id: a.id, displayName: 'An', avatarUrl: a.avatarUrl });

  // 7 ngày sau giờ trao vẫn hiện (đúng mốc), qua mốc thì thôi.
  setNow('2026-11-07T17:05:00Z');
  expect(await getRecentSmvp(ctx)).not.toBeNull();
  setNow('2026-11-07T17:05:00.001Z');
  expect(await getRecentSmvp(ctx)).toBeNull();
});
