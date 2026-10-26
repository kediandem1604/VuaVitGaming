import type { Member } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { runBadgeJobs } from '../../src/server/modules/badges/jobs.js';
import {
  MILESTONES_BACKFILLED_KEY,
  awardMilestones,
  buildMilestoneAnnouncement,
  computeMilestones,
  runMilestoneBadges,
} from '../../src/server/modules/badges/milestones.js';
import type { BadgeGrant } from '../../src/server/modules/badges/monthly.js';
import { ensureSeason } from '../../src/server/modules/seasons/service.js';
import { badgeDef } from '../../src/shared/badges.js';
import type { BadgeKey } from '../../src/shared/badges.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';

/** Giữa tháng 11 — tháng 10/2026 đã qua giờ chốt. */
const MID_NOVEMBER = '2026-11-10T05:00:00Z';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let a: Member;
let b: Member;
let mod: Member;
let kills: { id: number }; // Giết nhiều nhất — nhóm Khen
let runner: { id: number }; // Ngỗng chạy giỏi nhất — nhóm Khen
let fun1: { id: number }; // Pha xử lý ngu nhất — nhóm Vui

beforeEach(async () => {
  await resetDb();
  sessionCounter = 0;
  highlightCounter = 0;
  ({ ctx, notifier, setNow } = makeTestCtx()); // now mặc định: 19:00 ngày 22/10/2026 giờ VN
  a = await createMember(testDb, { displayName: 'An' });
  b = await createMember(testDb, { displayName: 'Bình' });
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  kills = await category('Giết nhiều nhất');
  runner = await category('Ngỗng chạy giỏi nhất');
  fun1 = await category('Pha xử lý ngu nhất');
});
afterEach(() => vi.restoreAllMocks());

const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

const category = (name: string) => testDb.awardCategory.findFirstOrThrow({ where: { name }, select: { id: true } });
const rows = () => testDb.memberBadge.findMany({ orderBy: { id: 'asc' } });
const flag = () => testDb.appSetting.findUnique({ where: { key: MILESTONES_BACKFILLED_KEY } });

/** Khoá cột mốc của `memberId` trong `grants`, theo thứ tự `grants`. */
const keysOf = (grants: BadgeGrant[], memberId: number): BadgeKey[] =>
  grants.filter((g) => g.memberId === memberId).map((g) => g.badgeKey);

/** Số buổi đã tạo trong test — để mỗi buổi có giờ bắt đầu khác nhau. */
let sessionCounter = 0;
let highlightCounter = 0;

/**
 * Buổi chơi (mặc định đã kết thúc, trong tháng 10/2026 — ngày không ảnh hưởng cột mốc)
 * với các thành viên điểm danh `going`. Ghi đè trạng thái qua `o`.
 */
async function session(o: { status?: 'scheduled' | 'ended' | 'cancelled'; going?: number[] } = {}): Promise<number> {
  sessionCounter += 1;
  const startsAt = new Date(new Date('2026-10-01T14:00:00Z').getTime() + sessionCounter * 3600_000);
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

/** `n` buổi đã kết thúc mà `memberId` đều đi. */
async function playGames(memberId: number, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) await session({ going: [memberId] });
}

/** Một dòng `awards`: `memberId` thắng hạng mục `categoryId` ở đợt vote (đã đóng) của buổi. */
async function win(sessionId: number, categoryId: number, memberId: number): Promise<void> {
  const s = await testDb.gameSession.findUniqueOrThrow({ where: { id: sessionId }, select: { startsAt: true } });
  const round = await testDb.voteRound.upsert({
    where: { sessionId },
    create: { sessionId, closesAt: new Date(s.startsAt.getTime() + 12 * 3600_000), status: 'closed' },
    update: {},
    select: { id: true },
  });
  await testDb.award.create({ data: { roundId: round.id, categoryId, memberId, voteCount: 1 } });
}

/** Hoá thân: dòng `role_titles` của `memberId` với role `roleKey` ở mùa `seasonId` (tạo mùa nếu chưa có). */
async function incarnate(seasonId: string, roleKey: string, memberId: number): Promise<void> {
  await ensureSeason(ctx, seasonId);
  const role = await roleByKey(testDb, roleKey);
  await testDb.roleTitle.create({ data: { seasonId, roleId: role.id, memberId, score: 1 } });
}

/** Lần khai chèn thẳng vào DB (role Ngỗng), có hay không có highlight. */
async function report(memberId: number, status: 'approved' | 'pending' | 'rejected', highlight: boolean): Promise<void> {
  const goose = await roleByKey(testDb, 'goose');
  highlightCounter += 1;
  await testDb.statReport.create({
    data: {
      memberId,
      roleId: goose.id,
      playedOn: dateOnlyToDb('2026-10-10'),
      value: 1,
      status,
      reviewedById: status === 'pending' ? null : mod.id,
      reviewedAt: status === 'pending' ? null : ctx.now(),
      highlightChannelId: highlight ? 'ch-highlight' : null,
      highlightMessageId: highlight ? `hl-${highlightCounter}` : null,
    },
  });
}

// ---------------------------------------------------------------------------
// computeMilestones — từng nhóm cột mốc
// ---------------------------------------------------------------------------

test('games thresholds count going attendances of ended sessions only', async () => {
  await playGames(a.id, 9);
  // Không tính: điểm danh rồi huỷ ở buổi đã kết thúc; đi buổi còn `scheduled` và buổi đã huỷ.
  const dropped = await session();
  await testDb.attendance.create({ data: { sessionId: dropped, memberId: a.id, status: 'cancelled' } });
  await session({ status: 'scheduled', going: [a.id] });
  await session({ status: 'cancelled', going: [a.id] });
  expect(await computeMilestones(ctx)).toEqual([]);

  // Trận thứ 10 → chỉ Quen mặt (chưa tới 50).
  await playGames(a.id, 1);
  expect(await computeMilestones(ctx)).toEqual([
    { memberId: a.id, badgeKey: 'games_10', periodId: '', title: 'Quen mặt', icon: '🎮', detail: 'Đã đi 10 trận' },
  ]);

  // Bình đi 50 trận → Quen mặt và Lão làng; thứ tự theo danh mục rồi id thành viên.
  await playGames(b.id, 50);
  const grants = await computeMilestones(ctx);
  expect(grants.map((g) => [g.badgeKey, g.memberId, g.detail])).toEqual([
    ['games_10', a.id, 'Đã đi 10 trận'],
    ['games_10', b.id, 'Đã đi 10 trận'],
    ['games_50', b.id, 'Đã đi 50 trận'],
  ]);
  expect(grants[2]).toMatchObject({ title: 'Lão làng', icon: '🏅', periodId: '' });
});

test('mvp milestones count only the mvp group', async () => {
  const none = await testDb.awardCategory.create({
    data: { name: 'Hạng mục khác', scope: 'optional', sortOrder: 99, badgeGroup: 'none' },
    select: { id: true },
  });
  const s1 = await session();
  await win(s1, kills.id, a.id);
  await win(s1, fun1.id, b.id);
  await win(s1, none.id, b.id);
  expect(await computeMilestones(ctx)).toEqual([
    { memberId: a.id, badgeKey: 'mvp_1', periodId: '', title: 'Ngôi sao mới', icon: '⭐', detail: 'Thắng MVP lần đầu' },
  ]);

  // An thắng thêm 9 lần Khen (cả hai hạng mục Khen ở 4 buổi nữa + Ngỗng chạy giỏi ở s1) → 10 lần.
  await win(s1, runner.id, a.id);
  for (let i = 0; i < 4; i += 1) {
    const s = await session();
    await win(s, kills.id, a.id);
    await win(s, runner.id, a.id);
  }
  const grants = await computeMilestones(ctx);
  expect(keysOf(grants, a.id)).toEqual(['mvp_1', 'mvp_10']);
  expect(grants.find((g) => g.badgeKey === 'mvp_10')).toMatchObject({ title: 'Ngôi sao sáng', icon: '🌟', detail: 'Thắng MVP 10 lần' });
  expect(keysOf(grants, b.id)).toEqual([]);

  // Admin đổi nhóm hạng mục → đọc giá trị hiện tại lúc trao.
  await testDb.awardCategory.update({ where: { id: fun1.id }, data: { badgeGroup: 'mvp' } });
  expect(keysOf(await computeMilestones(ctx), b.id)).toEqual(['mvp_1']);
});

test('incarnate milestones count distinct roles in role_titles', async () => {
  // An: cùng role Ngỗng ở hai mùa → 1 role.
  await incarnate('2026-08', 'goose', a.id);
  await incarnate('2026-09', 'goose', a.id);
  expect(await computeMilestones(ctx)).toEqual([
    { memberId: a.id, badgeKey: 'incarnate_1', periodId: '', title: 'Lần đầu hoá thân', icon: '🎖️', detail: 'Hoá thân lần đầu' },
  ]);

  // Bình: 4 role khác nhau ở mùa 09 + 1 ở mùa 08 → 5 role.
  for (const key of ['duck', 'vigilante', 'swordsman', 'dodo']) await incarnate('2026-09', key, b.id);
  await incarnate('2026-08', 'pelican', b.id);
  const grants = await computeMilestones(ctx);
  expect(keysOf(grants, a.id)).toEqual(['incarnate_1']);
  expect(keysOf(grants, b.id)).toEqual(['incarnate_1', 'incarnate_5']);
  expect(grants.find((g) => g.badgeKey === 'incarnate_5')).toMatchObject({ title: 'Bậc thầy hoá thân', icon: '🧬', detail: 'Đã hoá thân 5 role' });
});

test('director needs an approved report with a highlight', async () => {
  await report(b.id, 'pending', true);
  await report(b.id, 'rejected', true);
  await report(b.id, 'approved', false);
  expect(await computeMilestones(ctx)).toEqual([]);

  await report(a.id, 'approved', true);
  await report(a.id, 'approved', true); // highlight thứ hai vẫn một danh hiệu
  expect(await computeMilestones(ctx)).toEqual([
    { memberId: a.id, badgeKey: 'director', periodId: '', title: 'Đạo diễn', icon: '🎬', detail: 'Highlight đầu tiên được duyệt' },
  ]);
});

// ---------------------------------------------------------------------------
// awardMilestones / runMilestoneBadges — trao và đăng
// ---------------------------------------------------------------------------

test('first pass is silent and sets badges.milestones_backfilled; a later new milestone is announced', async () => {
  await playGames(a.id, 10);
  const s = await session();
  await win(s, kills.id, b.id);
  const first = ctx.now();

  await runMilestoneBadges(ctx);
  expect((await rows()).map((r) => [r.badgeKey, r.periodId, r.memberId, r.awardedAt])).toEqual([
    ['games_10', '', a.id, first],
    ['mvp_1', '', b.id, first],
  ]);
  expect(notifier.announcements).toEqual([]);
  expect(await flag()).toEqual({ key: 'badges.milestones_backfilled', value: first.toISOString() });

  // Lượt sau: Cường đạt Quen mặt → đăng một tin; cờ giữ giờ lượt đầu.
  const c = await createMember(testDb, { displayName: 'Cường' });
  await playGames(c.id, 10);
  setNow('2026-10-23T12:00:00Z');
  await runMilestoneBadges(ctx);
  expect(notifier.announcements).toEqual(['🎖️ **Cường** vừa đạt danh hiệu 🎮 Quen mặt!']);
  expect((await rows()).map((r) => [r.badgeKey, r.memberId, r.awardedAt])).toEqual([
    ['games_10', a.id, first],
    ['mvp_1', b.id, first],
    ['games_10', c.id, new Date('2026-10-23T12:00:00Z')],
  ]);
  expect(await flag()).toEqual({ key: MILESTONES_BACKFILLED_KEY, value: first.toISOString() });

  // Chạy lại: không tạo gì, không đăng gì.
  await runMilestoneBadges(ctx);
  expect(await testDb.memberBadge.count()).toBe(3);
  expect(notifier.announcements).toHaveLength(1);
});

test('awardMilestones returns only the rows it created', async () => {
  await playGames(a.id, 10);
  const fresh = await awardMilestones(ctx);
  expect(fresh.map((g) => [g.badgeKey, g.memberId])).toEqual([['games_10', a.id]]);
  expect(await awardMilestones(ctx)).toEqual([]);

  // Cột mốc mới của người khác → chỉ dòng đó; computeMilestones vẫn trả cả hai.
  await playGames(b.id, 10);
  expect((await awardMilestones(ctx)).map((g) => [g.badgeKey, g.memberId])).toEqual([['games_10', b.id]]);
  expect((await computeMilestones(ctx)).map((g) => [g.badgeKey, g.memberId])).toEqual([
    ['games_10', a.id],
    ['games_10', b.id],
  ]);
  expect(await testDb.memberBadge.count()).toBe(2);
});

test('a member who left still gets milestones', async () => {
  const gone = await createMember(testDb, { displayName: 'Đã rời', status: 'left', leftAt: new Date('2026-10-01T00:00:00Z') });
  await playGames(gone.id, 10);
  expect(keysOf(await computeMilestones(ctx), gone.id)).toEqual(['games_10']);

  await runMilestoneBadges(ctx); // lượt đầu: trao bù im lặng
  expect((await rows()).map((r) => [r.badgeKey, r.memberId])).toEqual([['games_10', gone.id]]);
  expect(notifier.announcements).toEqual([]);

  // Người đã rời đạt cột mốc mới sau lượt đầu cũng được đăng.
  await report(gone.id, 'approved', true);
  await runMilestoneBadges(ctx);
  expect(notifier.announcements).toEqual(['🎖️ **Đã rời** vừa đạt danh hiệu 🎬 Đạo diễn!']);
});

test('Discord failure on the milestone post is logged, rows stay', async () => {
  const errorSpy = silenceConsoleError();
  await runMilestoneBadges(ctx); // lượt đầu không có gì → chỉ ghi cờ
  expect(await flag()).not.toBeNull();
  expect(await rows()).toEqual([]);

  await playGames(a.id, 10);
  notifier.down = true;
  await runMilestoneBadges(ctx);
  expect((await rows()).map((r) => [r.badgeKey, r.memberId])).toEqual([['games_10', a.id]]);
  expect(notifier.announcements).toEqual([]);
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('cột mốc'));

  // Discord trở lại: không đăng bù (không có cờ nợ), không tạo lại.
  notifier.down = false;
  await runMilestoneBadges(ctx);
  expect(notifier.announcements).toEqual([]);
  expect(await testDb.memberBadge.count()).toBe(1);
});

// ---------------------------------------------------------------------------
// Tin Discord
// ---------------------------------------------------------------------------

test('buildMilestoneAnnouncement escapes names, keeps order and splits under the Discord limit', () => {
  const g = (badgeKey: BadgeKey, memberId: number, displayName: string): BadgeGrant & { displayName: string } => ({
    memberId,
    badgeKey,
    periodId: '',
    title: badgeDef(badgeKey).name,
    icon: badgeDef(badgeKey).icon,
    detail: 'x',
    displayName,
  });
  expect(buildMilestoneAnnouncement([g('games_10', 1, 'An'), g('director', 2, '*bold*_x')])).toEqual([
    '🎖️ **An** vừa đạt danh hiệu 🎮 Quen mặt!\n🎖️ **\\*bold\\*\\_x** vừa đạt danh hiệu 🎬 Đạo diễn!',
  ]);
  expect(buildMilestoneAnnouncement([])).toEqual([]);

  const many = Array.from({ length: 60 }, (_, i) => g('games_10', i + 1, `Người chơi có tên khá là dài số ${i + 1}`));
  const chunks = buildMilestoneAnnouncement(many);
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2000);
  expect(chunks.join('\n').split('\n')).toHaveLength(60);
});

// ---------------------------------------------------------------------------
// Việc `badges` của bộ hẹn giờ
// ---------------------------------------------------------------------------

test('runBadgeJobs awards the due month and then the milestones', async () => {
  const s = await session({ going: [a.id] });
  await win(s, kills.id, a.id);
  setNow(MID_NOVEMBER);

  await runBadgeJobs(ctx);
  expect(await testDb.badgeMonth.findUnique({ where: { periodId: '2026-10' } })).toMatchObject({ announcePending: false });
  expect((await rows()).map((r) => [r.periodId, r.badgeKey, r.memberId])).toEqual([
    ['2026-10', 'smvp', a.id],
    ['2026-10', 'grinder', a.id],
    ['', 'mvp_1', a.id],
  ]);
  // Tổng kết tháng được đăng; cột mốc lượt đầu im lặng.
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.announcements[0]).toMatch(/^🏅 Danh hiệu tháng 10\/2026\n/);
  expect(await flag()).toEqual({ key: MILESTONES_BACKFILLED_KEY, value: new Date(MID_NOVEMBER).toISOString() });
});

test('runBadgeJobs still grants milestones when the monthly half throws', async () => {
  const errorSpy = silenceConsoleError();
  await playGames(a.id, 10);
  // Phần tháng đọc buổi sớm nhất đầu tiên — làm nó sập để phần cột mốc phải tự chạy.
  vi.spyOn(testDb.gameSession, 'aggregate').mockRejectedValue(new Error('DB sập'));

  await runBadgeJobs(ctx);
  expect((await rows()).map((r) => [r.badgeKey, r.memberId])).toEqual([['games_10', a.id]]);
  expect(await flag()).not.toBeNull();
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Phần danh hiệu tháng lỗi'));
  expect(await testDb.badgeMonth.count()).toBe(0);
});
