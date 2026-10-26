import type { Member } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { escapeDiscordMarkdown } from '../../src/server/lib/discord-text.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { runBadgeJobs } from '../../src/server/modules/badges/jobs.js';
import {
  awardMonth,
  buildMonthSummary,
  computeMonthlyBadges,
  deliverMonthSummary,
  runMonthlyBadges,
} from '../../src/server/modules/badges/monthly.js';
import type { BadgeGrant } from '../../src/server/modules/badges/monthly.js';
import { ensureSeason } from '../../src/server/modules/seasons/service.js';
import { getFactionTop } from '../../src/server/modules/stats/leaderboard.js';
import { badgeDef, monthlyBadgeTitle } from '../../src/shared/badges.js';
import type { BadgeKey } from '../../src/shared/badges.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';

/** Giờ chốt mùa 10/2026: 00:05 ngày 04/11 giờ VN. */
const CLOSE_AT = '2026-11-03T17:05:00Z';
/** Một phút trước giờ chốt. */
const BEFORE_CLOSE = '2026-11-03T17:04:00Z';
/** Giữa tháng 11 — mọi tháng tới hết 10/2026 đều đã qua giờ chốt. */
const MID_NOVEMBER = '2026-11-10T05:00:00Z';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let a: Member;
let b: Member;
let c: Member;
let mod: Member;
let kills: { id: number }; // Giết nhiều nhất — nhóm Khen
let runner: { id: number }; // Ngỗng chạy giỏi nhất — nhóm Khen
let fun1: { id: number }; // Pha xử lý ngu nhất — nhóm Vui
let fun2: { id: number }; // Pha dí người ngu nhất — nhóm Vui

beforeEach(async () => {
  await resetDb();
  sessionCounter = 0;
  ({ ctx, notifier, setNow } = makeTestCtx()); // now mặc định: 19:00 ngày 22/10/2026 giờ VN
  a = await createMember(testDb, { displayName: 'An' });
  b = await createMember(testDb, { displayName: 'Bình' });
  c = await createMember(testDb, { displayName: 'Cường' });
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  kills = await category('Giết nhiều nhất');
  runner = await category('Ngỗng chạy giỏi nhất');
  fun1 = await category('Pha xử lý ngu nhất');
  fun2 = await category('Pha dí người ngu nhất');
});
afterEach(() => vi.restoreAllMocks());

const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

const category = (name: string) => testDb.awardCategory.findFirstOrThrow({ where: { name }, select: { id: true } });
const monthRow = (periodId: string) => testDb.badgeMonth.findUnique({ where: { periodId } });
const badgeRows = (periodId?: string) =>
  testDb.memberBadge.findMany({ where: periodId === undefined ? {} : { periodId }, orderBy: { id: 'asc' } });

/** Số buổi đã tạo trong test — để mỗi buổi có giờ bắt đầu khác nhau khi không truyền vào. */
let sessionCounter = 0;

/**
 * Buổi đã kết thúc (mặc định trong tháng 10/2026, ngày 5 + n lúc 21:00 giờ VN) với các
 * thành viên điểm danh `going`. Ghi đè giờ bắt đầu / trạng thái qua `o`.
 */
async function endedSession(o: { startsAt?: string; status?: 'scheduled' | 'ended' | 'cancelled'; going?: number[] } = {}): Promise<number> {
  sessionCounter += 1;
  const startsAt = new Date(o.startsAt ?? `2026-10-${String(5 + sessionCounter).padStart(2, '0')}T14:00:00Z`);
  const status = o.status ?? 'ended';
  const s = await createSession(testDb, {
    startsAt,
    status,
    endedAt: status === 'ended' ? new Date(startsAt.getTime() + 2 * 3600_000) : null,
    createdById: mod.id,
  });
  for (const memberId of o.going ?? []) {
    await testDb.attendance.create({ data: { sessionId: s.id, memberId, status: 'going' } });
  }
  return s.id;
}

/** Một dòng `awards`: `memberId` thắng hạng mục `categoryId` ở đợt vote (đã đóng) của buổi. */
async function win(sessionId: number, categoryId: number, memberId: number): Promise<void> {
  const session = await testDb.gameSession.findUniqueOrThrow({ where: { id: sessionId }, select: { startsAt: true } });
  const round = await testDb.voteRound.upsert({
    where: { sessionId },
    create: { sessionId, closesAt: new Date(session.startsAt.getTime() + 12 * 3600_000), status: 'closed' },
    update: {},
    select: { id: true },
  });
  await testDb.award.create({ data: { roundId: round.id, categoryId, memberId, voteCount: 1 } });
}

/** Lần khai chèn thẳng vào DB (bỏ qua cửa sổ 3 ngày), mặc định đã duyệt. */
async function report(memberId: number, roleId: number, playedOn: string, value: number, status: 'approved' | 'pending' | 'rejected' = 'approved'): Promise<void> {
  const reviewedAt = new Date(`${playedOn}T15:00:00Z`);
  await testDb.statReport.create({
    data: {
      memberId,
      roleId,
      playedOn: dateOnlyToDb(playedOn),
      value,
      status,
      reviewedById: status === 'pending' ? null : mod.id,
      reviewedAt: status === 'pending' ? null : reviewedAt,
      createdAt: reviewedAt,
    },
  });
}

/** Các danh hiệu `key` trong `grants`, theo id thành viên. */
function ofKey(grants: BadgeGrant[], key: BadgeKey): { memberId: number; detail: string }[] {
  return grants
    .filter((g) => g.badgeKey === key)
    .map((g) => ({ memberId: g.memberId, detail: g.detail }))
    .sort((x, y) => x.memberId - y.memberId);
}

/** Tháng 10/2026: An thắng Khen 3 lần, Bình thắng Khen 3 lần + Vui 5 lần, Cường thắng Khen 2 lần. */
async function octoberVotes(): Promise<void> {
  const s = [];
  for (let i = 0; i < 5; i += 1) s.push(await endedSession());
  // An: s1, s2, s3 (s3 đồng hạng với Bình — hai dòng awards, mỗi người đều tính).
  await win(s[0]!, kills.id, a.id);
  await win(s[1]!, kills.id, a.id);
  await win(s[2]!, kills.id, a.id);
  // Bình: s3, s4 (Giết nhiều nhất), s5 (Ngỗng chạy giỏi nhất — cũng nhóm Khen) → 3 lần Khen.
  await win(s[2]!, kills.id, b.id);
  await win(s[3]!, kills.id, b.id);
  await win(s[4]!, runner.id, b.id);
  // Cường: s1, s2 → 2 lần Khen.
  await win(s[0]!, kills.id, c.id);
  await win(s[1]!, kills.id, c.id);
  // Bình thắng Vui 5 lần: fun1 ở cả 5 buổi; thêm fun2 cũng cho Bình ở s1 thì thành 6 — không thêm.
  for (const id of s) await win(id, fun1.id, b.id);
  // Cường thắng Vui 1 lần (fun2) — không đủ để chia Vua tấu hài với Bình.
  await win(s[0]!, fun2.id, c.id);
}

// ---------------------------------------------------------------------------
// computeMonthlyBadges — SMVP, Vua tấu hài
// ---------------------------------------------------------------------------

test('smvp counts only mvp-group wins and gives ties to everyone', async () => {
  await octoberVotes();
  const grants = await computeMonthlyBadges(ctx, '2026-10');
  expect(ofKey(grants, 'smvp')).toEqual([
    { memberId: a.id, detail: '3 lần MVP' },
    { memberId: b.id, detail: '3 lần MVP' },
  ]);
  expect(ofKey(grants, 'fun_king')).toEqual([{ memberId: b.id, detail: '5 lần thắng hạng mục vui' }]);
});

test('a category moved to none stops counting', async () => {
  const s1 = await endedSession();
  const s2 = await endedSession();
  await win(s1, kills.id, a.id);
  await win(s2, kills.id, a.id);
  await win(s1, fun1.id, b.id);
  await testDb.awardCategory.update({ where: { id: kills.id }, data: { badgeGroup: 'none' } });

  const grants = await computeMonthlyBadges(ctx, '2026-10');
  expect(ofKey(grants, 'smvp')).toEqual([]);
  // Nhóm Vui vẫn tính; đổi nhóm luôn đọc giá trị hiện tại lúc trao.
  expect(ofKey(grants, 'fun_king')).toEqual([{ memberId: b.id, detail: '1 lần thắng hạng mục vui' }]);

  await testDb.awardCategory.update({ where: { id: fun1.id }, data: { badgeGroup: 'mvp' } });
  expect(ofKey(await computeMonthlyBadges(ctx, '2026-10'), 'smvp')).toEqual([{ memberId: b.id, detail: '1 lần MVP' }]);
});

test('month follows the VN date of the session', async () => {
  // 23:30 giờ VN ngày 31/10 → tháng 10; 00:30 giờ VN ngày 01/11 → tháng 11.
  const late = await endedSession({ startsAt: '2026-10-31T16:30:00Z', going: [a.id] });
  const early = await endedSession({ startsAt: '2026-10-31T17:30:00Z', going: [b.id] });
  await win(late, kills.id, a.id);
  await win(early, kills.id, b.id);

  const october = await computeMonthlyBadges(ctx, '2026-10');
  expect(ofKey(october, 'smvp')).toEqual([{ memberId: a.id, detail: '1 lần MVP' }]);
  expect(ofKey(october, 'grinder')).toEqual([{ memberId: a.id, detail: '1 trận' }]);

  const november = await computeMonthlyBadges(ctx, '2026-11');
  expect(ofKey(november, 'smvp')).toEqual([{ memberId: b.id, detail: '1 lần MVP' }]);
  expect(ofKey(november, 'grinder')).toEqual([{ memberId: b.id, detail: '1 trận' }]);
});

// ---------------------------------------------------------------------------
// computeMonthlyBadges — Top phe, Chăm cày, Đa diện
// ---------------------------------------------------------------------------

test('faction tops match getFactionTop rank 1', async () => {
  const goose = await roleByKey(testDb, 'goose'); // tối đa 10 → hệ số 1
  const vigilante = await roleByKey(testDb, 'vigilante'); // tối đa 1 → hệ số 5
  const duck = await roleByKey(testDb, 'duck');
  // An: Ngỗng 9 (×1 = 9) và Dân phòng 2 (×5 = 10) → hạng 1 phe Ngỗng là dòng Dân phòng của An.
  await report(a.id, goose.id, '2026-10-10', 9);
  await report(a.id, vigilante.id, '2026-10-11', 1);
  await report(a.id, vigilante.id, '2026-10-12', 1);
  // Bình: Ngỗng 3; Vịt 7 → hạng 1 phe Vịt.
  await report(b.id, goose.id, '2026-10-10', 3);
  await report(b.id, duck.id, '2026-10-10', 7);

  const top = await getFactionTop(ctx, '2026-10', 1);
  expect(top.factions.goose[0]).toMatchObject({ memberId: a.id, points: 10, role: { nameVi: vigilante.nameVi } });
  expect(top.factions.duck[0]).toMatchObject({ memberId: b.id, points: 7 });
  expect(top.factions.neutral).toEqual([]);

  const grants = await computeMonthlyBadges(ctx, '2026-10');
  expect(ofKey(grants, 'top_goose')).toEqual([{ memberId: a.id, detail: `10 điểm · ${vigilante.nameVi}` }]);
  expect(ofKey(grants, 'top_duck')).toEqual([{ memberId: b.id, detail: `7 điểm · ${duck.nameVi}` }]);
  // Phe thứ 3 không có dòng nào → không trao.
  expect(ofKey(grants, 'top_neutral')).toEqual([]);

  // Tháng không có lần khai nào → không có top phe nào.
  const empty = await computeMonthlyBadges(ctx, '2026-09');
  expect(empty.filter((g) => g.badgeKey.startsWith('top_'))).toEqual([]);
});

test('grinder counts going attendances of ended sessions only', async () => {
  // An: 3 trận đã kết thúc.
  await endedSession({ going: [a.id, b.id] });
  await endedSession({ going: [a.id, b.id] });
  await endedSession({ going: [a.id] });
  // Bình: điểm danh rồi huỷ ở một trận đã kết thúc; đi một buổi còn `scheduled` và một buổi đã huỷ — không tính.
  const dropped = await endedSession();
  await testDb.attendance.create({ data: { sessionId: dropped, memberId: b.id, status: 'cancelled' } });
  await endedSession({ status: 'scheduled', going: [b.id] });
  await endedSession({ status: 'cancelled', going: [b.id] });

  const grants = await computeMonthlyBadges(ctx, '2026-10');
  expect(ofKey(grants, 'grinder')).toEqual([{ memberId: a.id, detail: '3 trận' }]);

  // Bằng nhau thì cùng nhận.
  await endedSession({ going: [b.id] });
  expect(ofKey(await computeMonthlyBadges(ctx, '2026-10'), 'grinder')).toEqual([
    { memberId: a.id, detail: '3 trận' },
    { memberId: b.id, detail: '3 trận' },
  ]);
});

test('versatile needs at least 2 approved roles in the month', async () => {
  const goose = await roleByKey(testDb, 'goose');
  const duck = await roleByKey(testDb, 'duck');
  const swordsman = await roleByKey(testDb, 'swordsman');
  // Bình: 1 role (hai lần khai cùng role) → không đủ 2.
  await report(b.id, goose.id, '2026-10-05', 3);
  await report(b.id, goose.id, '2026-10-06', 2);
  expect(ofKey(await computeMonthlyBadges(ctx, '2026-10'), 'versatile')).toEqual([]);

  // An: Ngỗng + Vịt đã duyệt; Kiếm sĩ còn chờ duyệt và một role tháng 9 không tính.
  await report(a.id, goose.id, '2026-10-05', 1);
  await report(a.id, duck.id, '2026-10-06', 1);
  await report(a.id, swordsman.id, '2026-10-07', 1, 'pending');
  await report(a.id, swordsman.id, '2026-09-30', 1);
  // Cường: cũng 2 role → chia danh hiệu.
  await report(c.id, duck.id, '2026-10-08', 1);
  await report(c.id, swordsman.id, '2026-10-09', 1);

  expect(ofKey(await computeMonthlyBadges(ctx, '2026-10'), 'versatile')).toEqual([
    { memberId: a.id, detail: '2 role' },
    { memberId: c.id, detail: '2 role' },
  ]);
});

test("titles read 'SMVP tháng 10/2026' and icons from the catalogue", async () => {
  await octoberVotes();
  const grants = await computeMonthlyBadges(ctx, '2026-10');
  expect(grants.length).toBeGreaterThan(0);
  const smvp = grants.find((g) => g.badgeKey === 'smvp' && g.memberId === a.id);
  expect(smvp).toEqual({ memberId: a.id, badgeKey: 'smvp', periodId: '2026-10', title: 'SMVP tháng 10/2026', icon: '👑', detail: '3 lần MVP' });
  for (const g of grants) {
    const def = badgeDef(g.badgeKey);
    expect(def.kind).toBe('monthly');
    expect(g.title).toBe(monthlyBadgeTitle(def.name, '2026-10'));
    expect(g.icon).toBe(def.icon);
    expect(g.periodId).toBe('2026-10');
  }
  // Thứ tự theo danh mục: SMVP trước Vua tấu hài (không ai điểm danh → không có Chăm cày).
  const keys = [...new Set(grants.map((g) => g.badgeKey))];
  expect(keys).toEqual(['smvp', 'fun_king']);
});

// ---------------------------------------------------------------------------
// runMonthlyBadges — thời điểm trao
// ---------------------------------------------------------------------------

test('runMonthlyBadges waits until seasonCloseAt', async () => {
  const s = await endedSession({ going: [a.id] });
  await win(s, kills.id, a.id);

  setNow(BEFORE_CLOSE); // 00:04 giờ VN ngày 04/11
  await runMonthlyBadges(ctx);
  expect(await monthRow('2026-10')).toBeNull();
  expect(await badgeRows()).toEqual([]);
  expect(notifier.announcements).toEqual([]);

  setNow(CLOSE_AT); // 00:05 giờ VN ngày 04/11
  await runMonthlyBadges(ctx);
  expect(await monthRow('2026-10')).toEqual({ periodId: '2026-10', awardedAt: new Date(CLOSE_AT), announcePending: false });
  expect((await badgeRows('2026-10')).map((r) => [r.badgeKey, r.memberId, r.awardedAt])).toEqual([
    ['smvp', a.id, new Date(CLOSE_AT)],
    ['grinder', a.id, new Date(CLOSE_AT)],
  ]);
  expect(notifier.announcements).toHaveLength(1);
});

test('a month with only vote awards and no seasons row is awarded', async () => {
  const s = await endedSession();
  await win(s, kills.id, a.id);
  expect(await testDb.season.count()).toBe(0);

  setNow(MID_NOVEMBER);
  await runMonthlyBadges(ctx);
  expect(await monthRow('2026-10')).toMatchObject({ announcePending: false });
  expect((await badgeRows('2026-10')).map((r) => [r.badgeKey, r.memberId])).toEqual([['smvp', a.id]]);
});

test('a month whose seasons row is not closed waits', async () => {
  const s = await endedSession();
  await win(s, kills.id, a.id);
  await ensureSeason(ctx, '2026-10'); // có dòng, chưa chốt

  setNow(MID_NOVEMBER);
  await runMonthlyBadges(ctx);
  expect(await monthRow('2026-10')).toBeNull();
  expect(await badgeRows()).toEqual([]);

  await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt: ctx.now() } });
  await runMonthlyBadges(ctx);
  expect(await monthRow('2026-10')).toMatchObject({ announcePending: false });
  expect((await badgeRows('2026-10')).map((r) => r.badgeKey)).toEqual(['smvp']);
});

test('runMonthlyBadges scans from the earliest data month to last month and skips awarded months', async () => {
  // Dữ liệu sớm nhất: một lần khai tháng 8; buổi chơi tháng 10. Tháng 9 không có gì.
  const goose = await roleByKey(testDb, 'goose');
  await report(a.id, goose.id, '2026-08-20', 2);
  const s = await endedSession({ going: [b.id] });
  await win(s, kills.id, b.id);
  // Tháng 9 đã có dòng badge_months từ trước (giả sử lượt trước đã trao) → bỏ qua, không đụng.
  const earlier = new Date('2026-10-04T00:00:00Z');
  await testDb.badgeMonth.create({ data: { periodId: '2026-09', awardedAt: earlier, announcePending: false } });

  setNow(MID_NOVEMBER);
  await runMonthlyBadges(ctx);
  const months = await testDb.badgeMonth.findMany({ orderBy: { periodId: 'asc' } });
  expect(months).toEqual([
    { periodId: '2026-08', awardedAt: new Date(MID_NOVEMBER), announcePending: false },
    { periodId: '2026-09', awardedAt: earlier, announcePending: false },
    { periodId: '2026-10', awardedAt: new Date(MID_NOVEMBER), announcePending: false },
  ]);
  expect((await badgeRows()).map((r) => [r.periodId, r.badgeKey, r.memberId])).toEqual([
    ['2026-08', 'top_goose', a.id],
    ['2026-10', 'smvp', b.id],
    ['2026-10', 'grinder', b.id],
  ]);
  // Tháng hiện tại (11) chưa xét.
  expect(await monthRow('2026-11')).toBeNull();
  expect(notifier.announcements).toHaveLength(2);
  expect(notifier.announcements[0]).toMatch(/^🏅 Danh hiệu tháng 08\/2026\n/);
  expect(notifier.announcements[1]).toMatch(/^🏅 Danh hiệu tháng 10\/2026\n/);

  // Chạy lại: không có gì mới.
  await runMonthlyBadges(ctx);
  expect(await testDb.badgeMonth.count()).toBe(3);
  expect(await testDb.memberBadge.count()).toBe(3);
  expect(notifier.announcements).toHaveLength(2);
});

test('runMonthlyBadges does nothing when there is no data at all', async () => {
  setNow(MID_NOVEMBER);
  await runMonthlyBadges(ctx);
  expect(await testDb.badgeMonth.count()).toBe(0);
  expect(notifier.announcements).toEqual([]);
});

// ---------------------------------------------------------------------------
// awardMonth — trao đúng một lần
// ---------------------------------------------------------------------------

test('awardMonth twice (or concurrently via Promise.all) inserts once', async () => {
  await octoberVotes();
  setNow(MID_NOVEMBER);

  const results = await Promise.all([awardMonth(ctx, '2026-10'), awardMonth(ctx, '2026-10')]);
  expect(results.filter((r) => r)).toHaveLength(1);
  expect(await testDb.badgeMonth.count()).toBe(1);
  const rows = await badgeRows('2026-10');
  // SMVP ×2 (An, Bình), Vua tấu hài ×1, Chăm cày: không ai điểm danh → 0.
  expect(rows.map((r) => [r.badgeKey, r.memberId])).toEqual([
    ['smvp', a.id],
    ['smvp', b.id],
    ['fun_king', b.id],
  ]);
  expect(await monthRow('2026-10')).toEqual({ periodId: '2026-10', awardedAt: new Date(MID_NOVEMBER), announcePending: true });

  expect(await awardMonth(ctx, '2026-10')).toBe(false);
  expect(await testDb.badgeMonth.count()).toBe(1);
  expect(await badgeRows('2026-10')).toEqual(rows);
});

test('a month with no qualifying member writes badge_months with announce_pending false and posts nothing', async () => {
  // Chỉ có một buổi còn `scheduled` trong tháng 10: không ai đi, không ai thắng vote, không lần khai.
  await endedSession({ status: 'scheduled', going: [a.id] });
  setNow(MID_NOVEMBER);

  await runMonthlyBadges(ctx);
  expect(await monthRow('2026-10')).toEqual({ periodId: '2026-10', awardedAt: new Date(MID_NOVEMBER), announcePending: false });
  expect(await badgeRows()).toEqual([]);
  expect(notifier.announcements).toEqual([]);

  // Gọi thẳng deliverMonthSummary cũng không đăng gì.
  await deliverMonthSummary(ctx, '2026-10');
  expect(notifier.announcements).toEqual([]);
});

// ---------------------------------------------------------------------------
// Tin tổng kết Discord
// ---------------------------------------------------------------------------

test('summary posted once; Discord failure keeps announce_pending and the next run retries', async () => {
  silenceConsoleError();
  const tricky = await createMember(testDb, { displayName: '*bold*_x' });
  const s1 = await endedSession({ going: [a.id, tricky.id] });
  const s2 = await endedSession({ going: [a.id] });
  await win(s1, kills.id, a.id);
  await win(s2, kills.id, a.id);
  await win(s1, fun1.id, tricky.id);
  setNow(MID_NOVEMBER);

  notifier.down = true;
  await runMonthlyBadges(ctx);
  expect(await monthRow('2026-10')).toMatchObject({ announcePending: true });
  const rows = await badgeRows('2026-10');
  expect(rows.map((r) => [r.badgeKey, r.memberId])).toEqual([
    ['smvp', a.id],
    ['fun_king', tricky.id],
    ['grinder', a.id],
  ]);
  expect(notifier.announcements).toEqual([]);

  // Lượt sau, Discord vẫn sập: không trao lại, vẫn nợ.
  await runMonthlyBadges(ctx);
  expect(await badgeRows('2026-10')).toEqual(rows);
  expect(await monthRow('2026-10')).toMatchObject({ announcePending: true });
  expect(notifier.announcements).toEqual([]);

  // Discord trở lại: đăng đúng một lần rồi xoá nợ.
  notifier.down = false;
  await runMonthlyBadges(ctx);
  expect(notifier.announcements).toHaveLength(1);
  const text = notifier.announcements[0] ?? '';
  const lines = text.split('\n');
  expect(lines[0]).toBe('🏅 Danh hiệu tháng 10/2026');
  expect(lines).toContain('👑 SMVP: An (2 lần MVP)');
  expect(lines).toContain('🤡 Vua tấu hài: \\*bold\\*\\_x (1 lần thắng hạng mục vui)');
  expect(lines).toContain('🔥 Chăm cày: An (2 trận)');
  expect(lines.at(-1)).toBe('Xem tất cả: http://localhost:3000/huy-hieu');
  expect(text).not.toContain('*bold*_x');
  expect(await monthRow('2026-10')).toMatchObject({ announcePending: false });

  // Lượt sau nữa: không đăng lại.
  await runMonthlyBadges(ctx);
  expect(notifier.announcements).toHaveLength(1);
});

test('buildMonthSummary follows the catalogue order, joins ties and escapes names', () => {
  const g = (badgeKey: BadgeKey, memberId: number, displayName: string, detail: string): BadgeGrant & { displayName: string } => ({
    memberId,
    badgeKey,
    periodId: '2026-10',
    title: monthlyBadgeTitle(badgeDef(badgeKey).name, '2026-10'),
    icon: badgeDef(badgeKey).icon,
    detail,
    displayName,
  });
  // Đưa vào lộn thứ tự — kết quả vẫn theo danh mục; trong một danh hiệu giữ thứ tự đưa vào.
  const chunks = buildMonthSummary(
    '2026-10',
    [
      g('grinder', 3, 'Cường', '9 trận'),
      g('top_duck', 2, 'Bình', '7 điểm · Vịt'),
      g('smvp', 1, 'An', '7 lần MVP'),
      g('fun_king', 2, 'Bình', '3 lần thắng hạng mục vui'),
      g('fun_king', 3, 'Cường', '3 lần thắng hạng mục vui'),
      g('versatile', 1, '_An_ ~x~', '4 role'),
    ],
    'https://ggd.example',
  );
  expect(chunks).toEqual([
    [
      '🏅 Danh hiệu tháng 10/2026',
      '👑 SMVP: An (7 lần MVP)',
      '🤡 Vua tấu hài: Bình, Cường (3 lần thắng hạng mục vui)',
      '🦆 Sát thủ phe Vịt: Bình (7 điểm · Vịt)',
      '🔥 Chăm cày: Cường (9 trận)',
      '🎭 Đa diện: \\_An\\_ \\~x\\~ (4 role)',
      'Xem tất cả: https://ggd.example/huy-hieu',
    ].join('\n'),
  ]);
  expect(buildMonthSummary('2026-10', [], 'https://ggd.example')).toEqual([]);
});

test('buildMonthSummary splits under the Discord limit at line boundaries without repeating the heading', () => {
  // Bảy danh hiệu, mỗi danh hiệu 12 người đồng hạng tên dài → mỗi dòng ~450 ký tự, cả tin ~3000.
  const monthlyKeys: BadgeKey[] = ['smvp', 'fun_king', 'top_goose', 'top_duck', 'top_neutral', 'grinder', 'versatile'];
  const grants = monthlyKeys.flatMap((badgeKey) =>
    Array.from({ length: 12 }, (_, i) => ({
      memberId: i + 1,
      badgeKey,
      periodId: '2026-10',
      title: monthlyBadgeTitle(badgeDef(badgeKey).name, '2026-10'),
      icon: badgeDef(badgeKey).icon,
      detail: '4 trận',
      displayName: `Người chơi có tên khá là dài số ${i + 1}`,
    })),
  );
  const chunks = buildMonthSummary('2026-10', grants, 'https://ggd.example');
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2000);
  // Ghép lại đúng 9 dòng: tiêu đề, bảy danh hiệu, link — không dòng nào bị cắt giữa.
  const lines = chunks.join('\n').split('\n');
  expect(lines).toHaveLength(9);
  expect(lines[0]).toBe('🏅 Danh hiệu tháng 10/2026');
  expect(lines.filter((l) => l.startsWith('🏅 Danh hiệu'))).toHaveLength(1);
  expect(lines.at(-1)).toBe('Xem tất cả: https://ggd.example/huy-hieu');
  expect(chunks[0]?.startsWith('🏅 Danh hiệu tháng 10/2026\n👑 SMVP: ')).toBe(true);
});

test('escapeDiscordMarkdown escapes the characters Discord formats with', () => {
  expect(escapeDiscordMarkdown('*bold*_x')).toBe('\\*bold\\*\\_x');
  expect(escapeDiscordMarkdown('a~b`c|d\\e')).toBe('a\\~b\\`c\\|d\\\\e');
  expect(escapeDiscordMarkdown('Nguyễn Văn An')).toBe('Nguyễn Văn An');
  expect(escapeDiscordMarkdown('')).toBe('');
});

// ---------------------------------------------------------------------------
// Việc `badges` của bộ hẹn giờ
// ---------------------------------------------------------------------------

test('runBadgeJobs awards due months like runMonthlyBadges', async () => {
  const s = await endedSession({ going: [a.id] });
  await win(s, kills.id, a.id);
  setNow(MID_NOVEMBER);
  await runBadgeJobs(ctx);
  expect(await monthRow('2026-10')).toMatchObject({ announcePending: false });
  expect((await badgeRows('2026-10')).map((r) => r.badgeKey)).toEqual(['smvp', 'grinder']);
  expect(notifier.announcements).toHaveLength(1);
});
