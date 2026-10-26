import type { Member, Prisma, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { listRoles } from '../../src/server/modules/roles/service.js';
import { ensureSeason } from '../../src/server/modules/seasons/service.js';
import { getFactionTop, getHall, getHeldRoles, getRoleLeaderboard, getSeasonLeaders, rolePointWeight } from '../../src/server/modules/stats/leaderboard.js';
import { reviewReport, submitReport, updateOwnReport } from '../../src/server/modules/stats/reports.js';
import type { FactionTopRowDto, HallDto } from '../../src/shared/api-types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';
import { patchDelegate } from '../helpers/prisma.js';

/** 12:00 ngày 10/10/2026 giờ VN: khai được các trận từ 07/10 đến 10/10. */
const NOW = '2026-10-10T05:00:00Z';
const AN_AVATAR = 'https://cdn.example/an.png';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let a: Member; // An
let b: Member; // Bình
let mod: Member;
let duck: Role;
let swordsman: Role;
let cuckoo: Role;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  setNow(NOW);
  a = await createMember(testDb, { displayName: 'An', avatarUrl: AN_AVATAR });
  b = await createMember(testDb, { displayName: 'Bình' });
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  duck = await roleByKey(testDb, 'duck');
  swordsman = await roleByKey(testDb, 'swordsman');
  cuckoo = await roleByKey(testDb, 'cuckoo');
});
afterEach(() => vi.restoreAllMocks());

const modR = () => ({ id: mod.id, accessLevel: mod.accessLevel });

type ReportSpec = { roleId?: number; value: number; playedOn?: string };

/** Khai một lần (mặc định Vịt, ngày 10/10); trả về id. */
async function submit(memberId: number, o: ReportSpec): Promise<number> {
  const r = await submitReport(ctx, memberId, { roleId: o.roleId ?? duck.id, value: o.value, playedOn: o.playedOn ?? '2026-10-10' });
  return r.id;
}

/** Khai rồi duyệt ngay; `at` đặt đồng hồ trước đó (thành `reviewedAt`). */
async function approved(memberId: number, o: ReportSpec & { at?: string }): Promise<number> {
  if (o.at) setNow(o.at);
  const id = await submit(memberId, o);
  await reviewReport(ctx, modR(), id, { approve: true });
  return id;
}

/** Tạo mùa (mặc định đã chốt) kèm các dòng `role_titles`. */
async function seasonWithTitles(
  seasonId: string,
  titles: { roleId: number; memberId: number; score: number }[],
  opts: { closed?: boolean } = {},
): Promise<void> {
  await ensureSeason(ctx, seasonId);
  if (opts.closed ?? true) await testDb.season.update({ where: { id: seasonId }, data: { closedAt: ctx.now() } });
  await testDb.roleTitle.createMany({ data: titles.map((t) => ({ seasonId, ...t })) });
}

function hallRole(hall: HallDto, key: string): HallDto['roles'][number] {
  const entry = hall.roles.find((r) => r.role.key === key);
  if (!entry) throw new Error(`Không có role "${key}" trong Đại sảnh`);
  return entry;
}

const reportRow = (id: number) => testDb.statReport.findUniqueOrThrow({ where: { id } });

// ---------------------------------------------------------------------------
// Xếp hạng
// ---------------------------------------------------------------------------

test('only approved reports count', async () => {
  await approved(a.id, { value: 5 });
  await submit(a.id, { value: 7 }); // chờ duyệt
  const rejected = await submit(a.id, { value: 3 });
  await reviewReport(ctx, modR(), rejected, { approve: false, reason: 'Trùng' });

  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10')).toEqual([
    { rank: 1, memberId: a.id, displayName: 'An', avatarUrl: AN_AVATAR, score: 5, games: 1, lastApprovedAt: new Date(NOW) },
  ]);
  expect(await getRoleLeaderboard(ctx, swordsman.id, '2026-10')).toEqual([]);
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-09')).toEqual([]);

  const leaders = await getSeasonLeaders(ctx, '2026-10');
  expect([...leaders.keys()]).toEqual([duck.id]);
  expect(leaders.get(duck.id)).toEqual({
    rank: 1,
    memberId: a.id,
    displayName: 'An',
    avatarUrl: AN_AVATAR,
    score: 5,
    games: 1,
    lastApprovedAt: new Date(NOW),
  });
  expect((await getSeasonLeaders(ctx, '2026-09')).size).toBe(0);
});

test('tie goes to whoever reached it first', async () => {
  // A: 10 duyệt lúc 10:00; B: 6 duyệt 09:00 + 4 duyệt 11:00 → cùng 10, A xếp trên (giờ VN).
  await approved(b.id, { value: 6, at: '2026-10-10T02:00:00Z' });
  await approved(a.id, { value: 10, at: '2026-10-10T03:00:00Z' });
  await approved(b.id, { value: 4, at: '2026-10-10T04:00:00Z' });

  const rows = await getRoleLeaderboard(ctx, duck.id, '2026-10');
  expect(rows.map((r) => r.memberId)).toEqual([a.id, b.id]);
  expect(rows).toEqual([
    { rank: 1, memberId: a.id, displayName: 'An', avatarUrl: AN_AVATAR, score: 10, games: 1, lastApprovedAt: new Date('2026-10-10T03:00:00Z') },
    { rank: 2, memberId: b.id, displayName: 'Bình', avatarUrl: null, score: 10, games: 2, lastApprovedAt: new Date('2026-10-10T04:00:00Z') },
  ]);
  // B dẫn đầu trước (6), A vượt (10), B hoà 10 nhưng đạt sau → không đổi người.
  expect(notifier.announcements).toEqual(['👑 Bình đã hoá thân Vịt mùa 2026-10!', '👑 An đã hoá thân Vịt mùa 2026-10!']);

  // B lên 11 → B dẫn đầu.
  await approved(b.id, { value: 1, at: '2026-10-10T05:00:00Z' });
  expect((await getRoleLeaderboard(ctx, duck.id, '2026-10')).map((r) => [r.rank, r.memberId, r.score])).toEqual([
    [1, b.id, 11],
    [2, a.id, 10],
  ]);
  expect(notifier.announcements).toHaveLength(3);
  expect(notifier.announcements.at(-1)).toBe('👑 Bình đã hoá thân Vịt mùa 2026-10!');
});

test('equal score and approval instant fall back to member id', async () => {
  const ra = await submit(a.id, { value: 5 });
  const rb = await submit(b.id, { value: 5 });
  await reviewReport(ctx, modR(), rb, { approve: true });
  await reviewReport(ctx, modR(), ra, { approve: true }); // cùng đồng hồ → cùng reviewedAt

  const rows = await getRoleLeaderboard(ctx, duck.id, '2026-10');
  expect(rows.map((r) => [r.rank, r.memberId])).toEqual([
    [1, a.id],
    [2, b.id],
  ]);
  expect((await getSeasonLeaders(ctx, '2026-10')).get(duck.id)?.memberId).toBe(a.id);
  // Thứ tự xác định nên cả thông báo cũng xác định: B lên trước, A duyệt sau cùng mốc → A xếp trên.
  expect(notifier.announcements).toEqual(['👑 Bình đã hoá thân Vịt mùa 2026-10!', '👑 An đã hoá thân Vịt mùa 2026-10!']);
});

test('report played Oct 31 approved Nov 2 counts for 2026-10', async () => {
  setNow('2026-10-31T13:00:00Z');
  const r = await submitReport(ctx, a.id, { roleId: duck.id, value: 3, playedOn: '2026-10-31' });
  setNow('2026-11-02T03:00:00Z');
  await reviewReport(ctx, modR(), r.id, { approve: true });
  expect((await getRoleLeaderboard(ctx, duck.id, '2026-10'))[0]?.score).toBe(3);
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-11')).toEqual([]);
  expect(notifier.announcements.at(-1)).toContain('mùa 2026-10');
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Vịt mùa 2026-10!']);

  expect(hallRole(await getHall(ctx, '2026-10'), 'duck').holder).toEqual({ memberId: a.id, displayName: 'An', score: 3 });
  // Mùa 11 chưa có ai; mùa 10 chưa chốt nên cũng chưa có "mùa trước".
  expect(hallRole(await getHall(ctx, '2026-11'), 'duck')).toMatchObject({ holder: null, previous: null });

  // Trận ngày 01/11 duyệt cùng lúc tính cho mùa 11.
  await approved(b.id, { value: 2, playedOn: '2026-11-01' });
  expect((await getRoleLeaderboard(ctx, duck.id, '2026-11')).map((x) => [x.memberId, x.score])).toEqual([[b.id, 2]]);
  expect((await getRoleLeaderboard(ctx, duck.id, '2026-10')).map((x) => [x.memberId, x.score])).toEqual([[a.id, 3]]);
  expect(notifier.announcements.at(-1)).toBe('👑 Bình đã hoá thân Vịt mùa 2026-11!');
});

test('a role whose approved reports are all 0 has no one on the board', async () => {
  await approved(a.id, { value: 0 });
  await approved(b.id, { value: 0 });
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10')).toEqual([]);
  expect((await getSeasonLeaders(ctx, '2026-10')).has(duck.id)).toBe(false);
  expect(hallRole(await getHall(ctx, '2026-10'), 'duck')).toMatchObject({ holder: null, previous: null });
  expect(await getHeldRoles(ctx, a.id, '2026-10')).toEqual([]);
  expect(notifier.announcements).toEqual([]);

  // Điểm đầu tiên > 0 → lên bảng; số trận gồm cả lần 0 điểm.
  await approved(b.id, { value: 1 });
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10')).toMatchObject([{ rank: 1, memberId: b.id, score: 1, games: 2 }]);
  expect(notifier.announcements).toEqual(['👑 Bình đã hoá thân Vịt mùa 2026-10!']);
});

test('a member who left keeps their place on the board', async () => {
  await approved(a.id, { value: 7 });
  await approved(b.id, { value: 2 });
  await testDb.member.update({ where: { id: a.id }, data: { status: 'left', leftAt: ctx.now(), displayName: 'An (cũ)' } });

  const rows = await getRoleLeaderboard(ctx, duck.id, '2026-10');
  expect(rows.map((r) => [r.memberId, r.displayName, r.score])).toEqual([
    [a.id, 'An (cũ)', 7],
    [b.id, 'Bình', 2],
  ]);
  expect(hallRole(await getHall(ctx, '2026-10'), 'duck').holder).toEqual({ memberId: a.id, displayName: 'An (cũ)', score: 7 });
  expect((await getHeldRoles(ctx, a.id, '2026-10')).map((h) => h.role.key)).toEqual(['duck']);
});

test('getRoleLeaderboard validates season, limit and role', async () => {
  for (const bad of ['2026-13', '2026-00', '2026-1', '2026/10', '202610', '', '2026-10-01', ' 2026-10']) {
    await expect(getRoleLeaderboard(ctx, duck.id, bad)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Mùa không hợp lệ' });
    await expect(getSeasonLeaders(ctx, bad)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Mùa không hợp lệ' });
    await expect(getHeldRoles(ctx, a.id, bad)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Mùa không hợp lệ' });
    await expect(getHall(ctx, bad)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Mùa không hợp lệ' });
  }
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    await expect(getRoleLeaderboard(ctx, duck.id, '2026-10', bad)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Giới hạn không hợp lệ' });
  }
  await expect(getRoleLeaderboard(ctx, 9999, '2026-10')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(getRoleLeaderboard(ctx, 1.5, '2026-10')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  // Role đang tắt vẫn xem được bảng (lịch sử).
  const inquisitor = await roleByKey(testDb, 'inquisitor');
  expect(inquisitor.active).toBe(false);
  expect(await getRoleLeaderboard(ctx, inquisitor.id, '2026-10')).toEqual([]);

  // Giới hạn: mặc định 10, tối đa 100 (lớn hơn bị cắt); hạng 1..n liên tiếp.
  const members = [a, b];
  for (let i = 0; i < 10; i += 1) members.push(await createMember(testDb, { displayName: `Người ${i}` }));
  for (const [i, m] of members.entries()) await approved(m.id, { value: i + 1 }); // điểm 1..12
  const top = await getRoleLeaderboard(ctx, duck.id, '2026-10');
  expect(top.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(top.map((r) => r.score)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  expect(top[0]).toMatchObject({ memberId: members[11]?.id, displayName: 'Người 9' });
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10', 1)).toHaveLength(1);
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10', 2)).toHaveLength(2);
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10', 100)).toHaveLength(12);
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10', 101)).toHaveLength(12);
});

// ---------------------------------------------------------------------------
// Top 3 mỗi phe
// ---------------------------------------------------------------------------

test('rolePointWeight is 5 for a role capped at 1 per game and 1 otherwise', () => {
  expect(rolePointWeight({ maxPerGame: 1 })).toBe(5);
  expect(rolePointWeight({ maxPerGame: 2 })).toBe(1);
  expect(rolePointWeight({ maxPerGame: 10 })).toBe(1);
  expect(rolePointWeight({ maxPerGame: 100 })).toBe(1);
});

/** Phần role trong một dòng top phe, lấy từ dữ liệu mẫu. */
const roleOf = (role: Role): FactionTopRowDto['role'] => ({
  id: role.id,
  nameVi: role.nameVi,
  icon: role.icon,
  metricLabel: role.metricLabel,
  faction: role.faction,
});

test('faction top: a max-1 role weighs x5, one member may hold several rows, factions are separate', async () => {
  const goose = await roleByKey(testDb, 'goose'); // tối đa 10 → hệ số 1
  const vigilante = await roleByKey(testDb, 'vigilante'); // tối đa 1 → hệ số 5
  expect(vigilante.maxPerGame).toBe(1);
  // An: Ngỗng 9 vote (×1 = 9); Dân phòng 2 phát (×5 = 10) → dòng Dân phòng xếp trên dù giá trị thô nhỏ hơn.
  await approved(a.id, { roleId: goose.id, value: 9, at: '2026-10-10T02:00:00Z' });
  await approved(a.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T03:00:00Z' });
  await approved(a.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T04:00:00Z' });
  // Bình: Ngỗng 3 (phe Ngỗng) và Vịt 7 (phe Vịt).
  await approved(b.id, { roleId: goose.id, value: 3, at: '2026-10-10T04:30:00Z' });
  await approved(b.id, { value: 7, at: '2026-10-10T05:00:00Z' });

  const top = await getFactionTop(ctx, '2026-10');
  expect(top.seasonId).toBe('2026-10');
  expect(top.factions.goose).toEqual([
    { rank: 1, memberId: a.id, displayName: 'An', avatarUrl: AN_AVATAR, role: roleOf(vigilante), value: 2, weight: 5, points: 10, games: 2 },
    { rank: 2, memberId: a.id, displayName: 'An', avatarUrl: AN_AVATAR, role: roleOf(goose), value: 9, weight: 1, points: 9, games: 1 },
    { rank: 3, memberId: b.id, displayName: 'Bình', avatarUrl: null, role: roleOf(goose), value: 3, weight: 1, points: 3, games: 1 },
  ]);
  expect(top.factions.duck).toEqual([
    { rank: 1, memberId: b.id, displayName: 'Bình', avatarUrl: null, role: roleOf(duck), value: 7, weight: 1, points: 7, games: 1 },
  ]);
  expect(top.factions.neutral).toEqual([]);
  expect(roleOf(duck)).toEqual({ id: duck.id, nameVi: 'Vịt', icon: '🦆', metricLabel: 'Số mạng đã giết', faction: 'duck' });
});

test('faction top ties: earlier approval first, then member id, then role id', async () => {
  const c = await createMember(testDb, { displayName: 'Cường' });
  expect(duck.id).toBeLessThan(swordsman.id);
  // Phe Vịt: Bình đạt 5 ở Vịt lúc 02:00, An đạt 5 ở Vịt lúc 03:00 → Bình trên dù id lớn hơn.
  await approved(b.id, { value: 5, at: '2026-10-10T02:00:00Z' });
  await approved(a.id, { value: 5, at: '2026-10-10T03:00:00Z' });
  // Cùng mốc duyệt (cùng đồng hồ): An và Bình ở Kiếm sĩ 5 → id thành viên nhỏ trước.
  setNow('2026-10-10T04:00:00Z');
  const ra = await submit(a.id, { roleId: swordsman.id, value: 5 });
  const rb = await submit(b.id, { roleId: swordsman.id, value: 5 });
  await reviewReport(ctx, modR(), rb, { approve: true });
  await reviewReport(ctx, modR(), ra, { approve: true });
  // Cùng người, cùng mốc, hai role cùng điểm → id role nhỏ trước.
  setNow('2026-10-10T05:00:00Z');
  const cSword = await submit(c.id, { roleId: swordsman.id, value: 2 });
  const cDuck = await submit(c.id, { value: 2 });
  await reviewReport(ctx, modR(), cSword, { approve: true });
  await reviewReport(ctx, modR(), cDuck, { approve: true });

  const rows = (await getFactionTop(ctx, '2026-10', 10)).factions.duck;
  expect(rows.map((r) => [r.rank, r.memberId, r.role.id, r.points])).toEqual([
    [1, b.id, duck.id, 5],
    [2, a.id, duck.id, 5],
    [3, a.id, swordsman.id, 5],
    [4, b.id, swordsman.id, 5],
    [5, c.id, duck.id, 2],
    [6, c.id, swordsman.id, 2],
  ]);
});

test('faction top counts only approved reports played in the season, with value > 0', async () => {
  await approved(a.id, { value: 5 }); // Vịt, mùa 10
  await submit(a.id, { value: 7 }); // chờ duyệt
  const rejected = await submit(a.id, { value: 3 });
  await reviewReport(ctx, modR(), rejected, { approve: false, reason: 'Trùng' });
  await approved(b.id, { roleId: swordsman.id, value: 0 }); // 0 điểm: không lên bảng
  // Trận 30/09 duyệt đầu tháng 10 tính cho mùa 9.
  setNow('2026-10-01T05:00:00Z');
  await approved(b.id, { value: 4, playedOn: '2026-09-30' });

  const oct = await getFactionTop(ctx, '2026-10');
  expect(oct.factions.duck.map((r) => [r.memberId, r.value, r.points, r.games])).toEqual([[a.id, 5, 5, 1]]);
  expect(oct.factions.goose).toEqual([]);
  expect(oct.factions.neutral).toEqual([]);
  const sep = await getFactionTop(ctx, '2026-09');
  expect(sep.factions.duck.map((r) => [r.memberId, r.value])).toEqual([[b.id, 4]]);
  expect(await getFactionTop(ctx, '2026-08')).toEqual({ seasonId: '2026-08', factions: { goose: [], duck: [], neutral: [] } });
});

test('faction top takes `limit` rows per faction (default 3) with ranks 1..n, and keeps roles turned off later', async () => {
  const goose = await roleByKey(testDb, 'goose');
  const vigilante = await roleByKey(testDb, 'vigilante');
  const members = [a, b, await createMember(testDb, { displayName: 'Cường' }), await createMember(testDb, { displayName: 'Dũng' })];
  for (const [i, m] of members.entries()) await approved(m.id, { roleId: goose.id, value: i + 1 }); // Ngỗng 1..4
  // Role tắt sau khi đã có điểm vẫn tính (lịch sử), như bảng xếp hạng theo role.
  await approved(a.id, { roleId: vigilante.id, value: 1 }); // ×5 = 5
  await testDb.role.update({ where: { id: vigilante.id }, data: { active: false } });

  const top = await getFactionTop(ctx, '2026-10');
  expect(top.factions.goose.map((r) => [r.rank, r.displayName, r.role.id, r.points])).toEqual([
    [1, 'An', vigilante.id, 5],
    [2, 'Dũng', goose.id, 4],
    [3, 'Cường', goose.id, 3],
  ]);
  expect((await getFactionTop(ctx, '2026-10', 1)).factions.goose.map((r) => r.displayName)).toEqual(['An']);
  expect((await getFactionTop(ctx, '2026-10', 100)).factions.goose).toHaveLength(5);
  expect((await getFactionTop(ctx, '2026-10', 101)).factions.goose).toHaveLength(5);
});

test('faction top validates season and limit, and uses one grouped query', async () => {
  for (const bad of ['2026-13', '2026-00', '2026-1', '2026/10', '', '2026-10-01']) {
    await expect(getFactionTop(ctx, bad)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Mùa không hợp lệ' });
  }
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    await expect(getFactionTop(ctx, '2026-10', bad)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Giới hạn không hợp lệ' });
  }

  await approved(a.id, { value: 5 });
  await approved(b.id, { roleId: cuckoo.id, value: 2 });
  let groupByCalls = 0;
  const restore = patchDelegate(
    testDb.statReport,
    'groupBy',
    (original) =>
      ((args: never) => {
        groupByCalls += 1;
        return original(args);
      }) as never,
  );
  try {
    const top = await getFactionTop(ctx, '2026-10');
    expect(groupByCalls).toBe(1);
    expect(top.factions.duck.map((r) => r.memberId)).toEqual([a.id]);
    expect(top.factions.neutral.map((r) => [r.memberId, r.role.id])).toEqual([[b.id, cuckoo.id]]);
    expect(top.factions.goose).toEqual([]);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Đổi người hoá thân khi duyệt
// ---------------------------------------------------------------------------

test('announce only when the leader changes', async () => {
  await approved(a.id, { value: 3 });
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Vịt mùa 2026-10!']);
  await approved(a.id, { value: 2 }); // vẫn A
  expect(notifier.announcements).toHaveLength(1);
  await approved(b.id, { value: 4 }); // 4 < 5
  expect(notifier.announcements).toHaveLength(1);
  await approved(b.id, { value: 0 }); // 0 điểm không đổi gì
  expect(notifier.announcements).toHaveLength(1);
  await approved(b.id, { value: 2 }); // 6 > 5 → B vượt
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Vịt mùa 2026-10!', '👑 Bình đã hoá thân Vịt mùa 2026-10!']);

  // Role khác là bảng khác.
  await approved(a.id, { roleId: swordsman.id, value: 1 });
  expect(notifier.announcements.at(-1)).toBe('👑 An đã hoá thân Kiếm sĩ mùa 2026-10!');
  expect(notifier.announcements).toHaveLength(3);

  // Từ chối không bao giờ đổi người.
  const r = await submit(b.id, { roleId: swordsman.id, value: 15 });
  await reviewReport(ctx, modR(), r, { approve: false, reason: 'Ảnh mờ' });
  expect(notifier.announcements).toHaveLength(3);
  expect(notifier.dms).toHaveLength(1);
});

test('a failed announcement never undoes the approval', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  notifier.down = true;
  const id = await approved(a.id, { value: 3 });
  expect(await reportRow(id)).toMatchObject({ status: 'approved', reviewedById: mod.id, reviewedAt: new Date(NOW) });
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10')).toMatchObject([{ memberId: a.id, score: 3 }]);
  expect(notifier.announcements).toEqual([]);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(String(errors.mock.calls[0]?.[0])).toContain('Vịt');
  expect(String(errors.mock.calls[0]?.[0])).toContain('2026-10');

  // Discord sống lại: lần đổi người tiếp theo đăng bình thường (không đăng bù lần đã lỡ).
  notifier.down = false;
  await approved(a.id, { value: 1 }); // vẫn A → không có gì
  await approved(b.id, { value: 9 });
  expect(notifier.announcements).toEqual(['👑 Bình đã hoá thân Vịt mùa 2026-10!']);
  expect(errors).toHaveBeenCalledTimes(1);
});

test('an edit by the owner between the mod reading and approving is refused', async () => {
  const id = await submit(a.id, { value: 3 });

  // Chen lần sửa của người khai vào ngay sau lần đọc đầu tiên (mod đọc lần khai), trước khi mod ghi duyệt.
  let intercepted = false;
  const restore = patchDelegate(testDb.statReport, 'findUnique', (original) =>
    (async (args: Prisma.StatReportFindUniqueArgs) => {
      const row = await original(args);
      if (!intercepted) {
        intercepted = true;
        await updateOwnReport(ctx, a.id, id, { roleId: swordsman.id, value: 9 });
      }
      return row;
    }) as never,
  );
  try {
    await expect(reviewReport(ctx, modR(), id, { approve: true })).rejects.toMatchObject({
      code: 'NOT_PENDING',
      message: 'Lần khai vừa được sửa, hãy xem lại',
    });
  } finally {
    restore();
  }
  expect(intercepted).toBe(true);
  expect(await reportRow(id)).toMatchObject({ status: 'pending', roleId: swordsman.id, value: 9, reviewedById: null, reviewedAt: null });
  expect(notifier.announcements).toEqual([]);
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10')).toEqual([]);
  expect(await getRoleLeaderboard(ctx, swordsman.id, '2026-10')).toEqual([]);

  // Mod xem lại rồi duyệt: tính cho đúng role mới.
  await reviewReport(ctx, modR(), id, { approve: true });
  expect(await reportRow(id)).toMatchObject({ status: 'approved', roleId: swordsman.id, value: 9, reviewedById: mod.id });
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Kiếm sĩ mùa 2026-10!']);
  expect(await getRoleLeaderboard(ctx, swordsman.id, '2026-10')).toMatchObject([{ memberId: a.id, score: 9 }]);

  // Đã có người xử lý thì vẫn là thông báo cũ.
  await expect(reviewReport(ctx, modR(), id, { approve: true })).rejects.toMatchObject({
    code: 'NOT_PENDING',
    message: 'Lần khai này đã được xử lý',
  });
});

// ---------------------------------------------------------------------------
// Đại sảnh hoá thân
// ---------------------------------------------------------------------------

test('hall shows previous closed-season holder when role is empty', async () => {
  await seasonWithTitles('2026-09', [{ roleId: cuckoo.id, memberId: b.id, score: 12 }]);
  await approved(a.id, { value: 5 });

  const hall = await getHall(ctx, '2026-10');
  expect(hall.seasonId).toBe('2026-10');
  expect(hall.closed).toBe(false);
  // Đúng danh mục role đang bật, đúng thứ tự Ngỗng → Vịt → Phe thứ 3.
  const roles = await listRoles(ctx);
  expect(hall.roles.map((r) => r.role)).toEqual(roles);
  expect(hall.roles).toHaveLength(71);
  expect(hall.roles.every((r) => r.role.active)).toBe(true);

  expect(hallRole(hall, 'cuckoo')).toEqual({
    role: roles.find((r) => r.key === 'cuckoo'),
    holder: null,
    previous: { memberId: b.id, displayName: 'Bình', score: 12, seasonId: '2026-09' },
  });
  expect(hallRole(hall, 'duck')).toMatchObject({ holder: { memberId: a.id, displayName: 'An', score: 5 }, previous: null });
  expect(hallRole(hall, 'goose')).toMatchObject({ holder: null, previous: null });

  // Có người hoá thân rồi thì không hiện mùa trước nữa.
  await approved(a.id, { roleId: cuckoo.id, value: 1 });
  expect(hallRole(await getHall(ctx, '2026-10'), 'cuckoo')).toMatchObject({ holder: { memberId: a.id, displayName: 'An', score: 1 }, previous: null });

  // Mùa chưa có dòng `seasons` nào vẫn xem được (coi như đang mở).
  expect(await testDb.season.findUnique({ where: { id: '2027-03' } })).toBeNull();
  const future = await getHall(ctx, '2027-03');
  expect(future).toMatchObject({ seasonId: '2027-03', closed: false });
  expect(hallRole(future, 'cuckoo').previous).toEqual({ memberId: b.id, displayName: 'Bình', score: 12, seasonId: '2026-09' });
});

test('previous falls back to the most recent closed season only', async () => {
  const c = await createMember(testDb, { displayName: 'Cường' });
  await seasonWithTitles('2026-07', [
    { roleId: cuckoo.id, memberId: a.id, score: 5 },
    { roleId: duck.id, memberId: a.id, score: 3 },
  ]);
  await seasonWithTitles('2026-08', [{ roleId: cuckoo.id, memberId: b.id, score: 8 }]);
  // Mùa đang mở mà có dòng role_titles (bất thường) → bỏ qua.
  await seasonWithTitles('2026-09', [{ roleId: cuckoo.id, memberId: c.id, score: 99 }], { closed: false });
  // Mùa đã chốt nhưng SAU mùa đang xem → bỏ qua.
  await seasonWithTitles('2026-11', [{ roleId: cuckoo.id, memberId: c.id, score: 50 }]);

  const hall = await getHall(ctx, '2026-10');
  expect(hallRole(hall, 'cuckoo').previous).toEqual({ memberId: b.id, displayName: 'Bình', score: 8, seasonId: '2026-08' });
  expect(hallRole(hall, 'duck').previous).toEqual({ memberId: a.id, displayName: 'An', score: 3, seasonId: '2026-07' });
  expect(hallRole(hall, 'goose').previous).toBeNull();

  // Xem lại mùa đã chốt: người giữ từ role_titles; role trống lấy mùa chốt trước đó.
  const aug = await getHall(ctx, '2026-08');
  expect(aug.closed).toBe(true);
  expect(hallRole(aug, 'cuckoo')).toMatchObject({ holder: { memberId: b.id, displayName: 'Bình', score: 8 }, previous: null });
  expect(hallRole(aug, 'duck')).toMatchObject({ holder: null, previous: { memberId: a.id, displayName: 'An', score: 3, seasonId: '2026-07' } });

  // Mùa đầu tiên: không có gì trước đó.
  const jul = await getHall(ctx, '2026-07');
  expect(jul.closed).toBe(true);
  expect(hallRole(jul, 'goose')).toMatchObject({ holder: null, previous: null });
  expect(hallRole(jul, 'cuckoo')).toMatchObject({ holder: { memberId: a.id, score: 5 }, previous: null });
});

test('hall uses one grouped query', async () => {
  await approved(a.id, { value: 5 });
  await approved(b.id, { roleId: cuckoo.id, value: 2 });

  let groupByCalls = 0;
  const restore = patchDelegate(
    testDb.statReport,
    'groupBy',
    (original) =>
      ((args: never) => {
        groupByCalls += 1;
        return original(args);
      }) as never,
  );
  let hall: HallDto;
  let closed: HallDto;
  try {
    hall = await getHall(ctx, '2026-10');
    expect(groupByCalls).toBe(1);

    // Mùa đã chốt đọc role_titles, không tính lại từ lần khai.
    await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt: ctx.now() } });
    await testDb.roleTitle.create({ data: { seasonId: '2026-10', roleId: duck.id, memberId: b.id, score: 99 } });
    closed = await getHall(ctx, '2026-10');
    expect(groupByCalls).toBe(1);
  } finally {
    restore();
  }
  expect(hallRole(hall, 'duck').holder).toMatchObject({ memberId: a.id, score: 5 });
  expect(hallRole(hall, 'cuckoo').holder).toMatchObject({ memberId: b.id, score: 2 });
  expect(closed.closed).toBe(true);
  expect(hallRole(closed, 'duck').holder).toEqual({ memberId: b.id, displayName: 'Bình', score: 99 });
  expect(hallRole(closed, 'cuckoo')).toMatchObject({ holder: null, previous: null });
});

test('held roles', async () => {
  await approved(a.id, { roleId: swordsman.id, value: 4 });
  await approved(a.id, { value: 6 });
  await approved(b.id, { roleId: cuckoo.id, value: 9 });
  await approved(b.id, { value: 3 }); // B thua A ở Vịt

  const held = await getHeldRoles(ctx, a.id, '2026-10');
  expect(held.map((h) => h.role.key)).toEqual(['duck', 'swordsman']);
  expect(held.map((h) => h.score)).toEqual([6, 4]);
  expect(held[0]?.role).toEqual((await listRoles(ctx)).find((r) => r.key === 'duck'));

  expect((await getHeldRoles(ctx, b.id, '2026-10')).map((h) => [h.role.key, h.score])).toEqual([['cuckoo', 9]]);
  expect(await getHeldRoles(ctx, mod.id, '2026-10')).toEqual([]);
  expect(await getHeldRoles(ctx, a.id, '2026-09')).toEqual([]);
  expect(await getHeldRoles(ctx, 9999, '2026-10')).toEqual([]);
});
