import type { Member, Prisma, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { listRoles, updateRole } from '../../src/server/modules/roles/service.js';
import { closeSeason, ensureSeason } from '../../src/server/modules/seasons/service.js';
import { getFactionTop, getFactionTotals, getHall, getHeldRoles, getRoleLeaderboard, getSeasonLeaders } from '../../src/server/modules/stats/leaderboard.js';
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

type ReportSpec = { roleId?: number; value: number; extraValue?: number; playedOn?: string };

/** Khai một lần (mặc định Vịt, ngày 10/10, không chỉ số phụ); trả về id. */
async function submit(memberId: number, o: ReportSpec): Promise<number> {
  const r = await submitReport(ctx, memberId, {
    roleId: o.roleId ?? duck.id,
    value: o.value,
    playedOn: o.playedOn ?? '2026-10-10',
    ...(o.extraValue !== undefined ? { extraValue: o.extraValue } : {}),
  });
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
// Chỉ số phụ: điểm mùa = Σ value + Σ extraValue × extraPoints
// ---------------------------------------------------------------------------

test('an extra-metric role scores value + extraValue × extraPoints, summed over the season', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  expect(assassin.extraPoints).toBe(3);

  // An: 4 mạng + 2 ám sát họp = 10.
  await approved(a.id, { roleId: assassin.id, value: 4, extraValue: 2, at: '2026-10-10T02:00:00Z' });
  expect(await getRoleLeaderboard(ctx, assassin.id, '2026-10')).toEqual([
    { rank: 1, memberId: a.id, displayName: 'An', avatarUrl: AN_AVATAR, score: 10, games: 1, lastApprovedAt: new Date('2026-10-10T02:00:00Z') },
  ]);
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Ám sát mùa 2026-10!']);

  // Hai lần khai cộng dồn: + (1 + 1 × 3) = 14; số trận = 2.
  await approved(a.id, { roleId: assassin.id, value: 1, extraValue: 1, at: '2026-10-10T03:00:00Z' });
  // Bình: 9 mạng, không ám sát họp = 9 → dưới An; lần chỉ có chỉ số phụ (0 + 1 × 3) vẫn lên bảng.
  await approved(b.id, { roleId: assassin.id, value: 9, at: '2026-10-10T04:00:00Z' });
  const c = await createMember(testDb, { displayName: 'Cường' });
  await approved(c.id, { roleId: assassin.id, value: 0, extraValue: 1, at: '2026-10-10T05:00:00Z' });
  expect((await getRoleLeaderboard(ctx, assassin.id, '2026-10')).map((r) => [r.rank, r.memberId, r.score, r.games])).toEqual([
    [1, a.id, 14, 2],
    [2, b.id, 9, 1],
    [3, c.id, 3, 1],
  ]);
  expect(notifier.announcements).toHaveLength(1);

  // Mọi nơi dùng điểm mùa đi theo: hoá thân, Đại sảnh, role đang giữ.
  expect((await getSeasonLeaders(ctx, '2026-10')).get(assassin.id)).toMatchObject({ memberId: a.id, score: 14 });
  expect(hallRole(await getHall(ctx, '2026-10'), 'assassin').holder).toEqual({ memberId: a.id, displayName: 'An', score: 14 });
  expect((await getHeldRoles(ctx, a.id, '2026-10')).map((h) => [h.role.key, h.score])).toEqual([['assassin', 14]]);

  // Lần khai chỉ số phụ chờ duyệt không tính; role thường không đổi cách tính.
  await submit(b.id, { roleId: assassin.id, value: 0, extraValue: 2 });
  await approved(b.id, { value: 6 });
  expect((await getRoleLeaderboard(ctx, assassin.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([
    [a.id, 14],
    [b.id, 9],
    [c.id, 3],
  ]);
  expect((await getRoleLeaderboard(ctx, duck.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([[b.id, 6]]);
});

test('changing extraPoints re-scores an open season and its holder; a closed season keeps role_titles.score', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  // An: 4 + 2 × 3 = 10 (02:00); Bình: 9 (03:00) → An dẫn.
  await approved(a.id, { roleId: assassin.id, value: 4, extraValue: 2, at: '2026-10-10T02:00:00Z' });
  await approved(b.id, { roleId: assassin.id, value: 9, at: '2026-10-10T03:00:00Z' });
  expect((await getRoleLeaderboard(ctx, assassin.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([
    [a.id, 10],
    [b.id, 9],
  ]);

  // Admin hạ điểm mỗi lần ám sát họp xuống 1: An còn 6 → Bình dẫn, không cần duyệt lại gì.
  await updateRole(ctx, assassin.id, { extraPoints: 1 });
  expect((await getRoleLeaderboard(ctx, assassin.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([
    [b.id, 9],
    [a.id, 6],
  ]);
  expect((await getSeasonLeaders(ctx, '2026-10')).get(assassin.id)).toMatchObject({ memberId: b.id, score: 9 });
  expect(hallRole(await getHall(ctx, '2026-10'), 'assassin').holder).toEqual({ memberId: b.id, displayName: 'Bình', score: 9 });
  expect(await getHeldRoles(ctx, a.id, '2026-10')).toEqual([]);
  expect((await getHeldRoles(ctx, b.id, '2026-10')).map((h) => h.role.key)).toEqual(['assassin']);

  // Nâng lên 10: An 24 → An dẫn lại.
  await updateRole(ctx, assassin.id, { extraPoints: 10 });
  expect((await getRoleLeaderboard(ctx, assassin.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([
    [a.id, 24],
    [b.id, 9],
  ]);

  // Chốt mùa với điểm hiện tại; đổi điểm sau đó không đụng tới danh hiệu đã chốt.
  setNow('2026-11-04T00:00:00Z');
  await closeSeason(ctx, '2026-10');
  expect(await testDb.roleTitle.findMany({ where: { seasonId: '2026-10', roleId: assassin.id } })).toMatchObject([{ memberId: a.id, score: 24 }]);
  await updateRole(ctx, assassin.id, { extraPoints: 1 });
  const closed = await getHall(ctx, '2026-10');
  expect(closed.closed).toBe(true);
  expect(hallRole(closed, 'assassin').holder).toEqual({ memberId: a.id, displayName: 'An', score: 24 });
  expect(hallRole(await getHall(ctx, '2026-11'), 'assassin')).toMatchObject({
    holder: null,
    previous: { memberId: a.id, displayName: 'An', score: 24, seasonId: '2026-10' },
  });
});

test('a stored extraValue on a role whose extra metric is gone scores 0 points', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  await approved(a.id, { roleId: assassin.id, value: 4, extraValue: 2 });
  await approved(b.id, { roleId: assassin.id, value: 0, extraValue: 1 });
  expect((await getRoleLeaderboard(ctx, assassin.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([
    [a.id, 10],
    [b.id, 3],
  ]);

  // Service chặn tắt khi đã có lần khai dùng chỉ số phụ; tắt thẳng trong DB (CHECK cho phép cả ba null)
  // để xem cách tính: phần phụ tính 0 điểm, người chỉ có chỉ số phụ rời bảng.
  await testDb.role.update({ where: { id: assassin.id }, data: { extraMetricLabel: null, extraMaxPerGame: null, extraPoints: null } });
  expect((await getRoleLeaderboard(ctx, assassin.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([[a.id, 4]]);
  expect((await getFactionTop(ctx, '2026-10')).factions.duck.map((r) => [r.memberId, r.value, r.points])).toEqual([[a.id, 4, 4]]);
});

// ---------------------------------------------------------------------------
// Điểm theo role: points, phạt, bonus, source (spec điểm role §3)
// ---------------------------------------------------------------------------

/** Ghi thẳng một lần khai đã duyệt với đủ trường mới (service chưa nhận penaltyValue/bonusPoints ở task này). */
async function approvedRaw(
  memberId: number,
  o: { roleId: number; value: number; extraValue?: number; penaltyValue?: number; bonusPoints?: number; source?: 'self' | 'accusation'; at: string },
): Promise<number> {
  const row = await testDb.statReport.create({
    data: {
      memberId,
      roleId: o.roleId,
      playedOn: dateOnlyToDb('2026-10-10'),
      value: o.value,
      extraValue: o.extraValue ?? 0,
      penaltyValue: o.penaltyValue ?? 0,
      bonusPoints: o.bonusPoints ?? 0,
      source: o.source ?? 'self',
      status: 'approved',
      reviewedById: mod.id,
      reviewedAt: new Date(o.at),
    },
  });
  return row.id;
}

test('a role scores value × points: Dân phòng gives 5 per hit, Cảnh sát trưởng 3, and admin changing points re-scores the open season', async () => {
  const vigilante = await roleByKey(testDb, 'vigilante');
  const sheriff = await roleByKey(testDb, 'sheriff');
  expect(vigilante).toMatchObject({ points: 5, penaltyMetricLabel: 'Số phát bắn sai', penaltyMaxPerGame: 1, penaltyPoints: 3 });
  expect(sheriff).toMatchObject({ points: 3, penaltyMetricLabel: 'Số phát bắn sai', penaltyMaxPerGame: 10, penaltyPoints: 1 });

  await approved(a.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T02:00:00Z' });
  await approved(a.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T03:00:00Z' });
  await approved(b.id, { roleId: sheriff.id, value: 4, at: '2026-10-10T03:00:00Z' });
  expect((await getRoleLeaderboard(ctx, vigilante.id, '2026-10')).map((r) => [r.memberId, r.score, r.games])).toEqual([[a.id, 10, 2]]);
  expect((await getRoleLeaderboard(ctx, sheriff.id, '2026-10')).map((r) => [r.memberId, r.score, r.games])).toEqual([[b.id, 12, 1]]);

  // Đổi điểm mỗi lần → bảng mùa đang mở đổi theo (đọc điểm HIỆN TẠI của role).
  await testDb.role.update({ where: { id: sheriff.id }, data: { points: 2 } });
  expect((await getRoleLeaderboard(ctx, sheriff.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([[b.id, 8]]);
});

test('penalty values subtract penaltyPoints, bonus points add, a cell at or below 0 leaves the board', async () => {
  const vigilante = await roleByKey(testDb, 'vigilante');
  // An: 1 trúng (+5) − 1 sai (−3) = 2, cộng 1 bonus → 3.
  await approvedRaw(a.id, { roleId: vigilante.id, value: 1, penaltyValue: 1, bonusPoints: 1, at: '2026-10-10T02:00:00Z' });
  // Bình: 1 trúng (+5), rồi 0 trúng 1 sai (−3) → 2.
  await approvedRaw(b.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T03:00:00Z' });
  await approvedRaw(b.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, at: '2026-10-10T04:00:00Z' });
  // Cường: 1 trúng (+5) − 2 lần bị trừ (−6) = −1 → không lên bảng; Dũng: đúng 0 → không lên bảng.
  const c = await createMember(testDb, { displayName: 'Cường' });
  const d = await createMember(testDb, { displayName: 'Dũng' });
  await approvedRaw(c.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T05:00:00Z' });
  await approvedRaw(c.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, source: 'accusation', at: '2026-10-10T06:00:00Z' });
  await approvedRaw(c.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, source: 'accusation', at: '2026-10-10T07:00:00Z' });
  await approvedRaw(d.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T05:00:00Z' });
  await approvedRaw(d.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, at: '2026-10-10T05:30:00Z' });
  await approvedRaw(d.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, at: '2026-10-10T05:40:00Z' });
  await testDb.role.update({ where: { id: vigilante.id }, data: { penaltyPoints: 2 } }); // Dũng: 5 − 2 − 2 = 1 → vẫn lên; đổi lại dưới.
  expect((await getRoleLeaderboard(ctx, vigilante.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([
    [a.id, 4], // 5 − 2 + 1
    [b.id, 3], // 5 − 2
    [d.id, 1], // 5 − 2 − 2
    // Cường: 5 − 2 − 2 = 1 → cũng lên; hoà 1 điểm với Dũng, Dũng đạt trước (05:40 < 07:00).
    [c.id, 1],
  ]);
  await testDb.role.update({ where: { id: vigilante.id }, data: { penaltyPoints: 3 } });
  expect((await getRoleLeaderboard(ctx, vigilante.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([
    [a.id, 3],
    [b.id, 2],
  ]);
  // Người điểm âm/0 không lên Top phe, Tổng phe, Đại sảnh.
  const top = await getFactionTop(ctx, '2026-10');
  expect(top.factions.goose.map((r) => [r.memberId, r.points])).toEqual([
    [a.id, 3],
    [b.id, 2],
  ]);
  const totals = await getFactionTotals(ctx, '2026-10', c.id);
  expect(totals.boards.goose.top.map((r) => [r.memberId, r.points])).toEqual([
    [a.id, 3],
    [b.id, 2],
  ]);
  expect(totals.boards.goose.me).toBeNull();
  expect(hallRole(await getHall(ctx, '2026-10'), 'vigilante').holder).toMatchObject({ memberId: a.id, score: 3 });

  // Role đã tắt chỉ số phạt trong DB mà lần khai còn penaltyValue: phần phạt tính 0.
  await testDb.role.update({ where: { id: vigilante.id }, data: { penaltyMetricLabel: null, penaltyMaxPerGame: null, penaltyPoints: null } });
  // Cường và Dũng hoà 5: Dũng đạt trước (lần duyệt gần nhất 05:40 < 07:00 của Cường, kể cả mục trừ).
  expect((await getRoleLeaderboard(ctx, vigilante.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([
    [a.id, 6],
    [b.id, 5],
    [d.id, 5],
    [c.id, 5],
  ]);
});

test('`games` counts only the reports the player filed themselves (source = self), not penalty entries from accusations', async () => {
  const vigilante = await roleByKey(testDb, 'vigilante');
  await approvedRaw(a.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T02:00:00Z' });
  await approvedRaw(a.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T03:00:00Z' });
  await approvedRaw(a.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, source: 'accusation', at: '2026-10-10T04:00:00Z' });
  // Bình chỉ có mục trừ do báo cáo: điểm âm, không lên bảng.
  await approvedRaw(b.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, source: 'accusation', at: '2026-10-10T04:00:00Z' });

  const rows = await getRoleLeaderboard(ctx, vigilante.id, '2026-10');
  expect(rows).toEqual([
    // 5 + 5 − 3 = 7; games 2 (không đếm mục trừ); mốc phân hoà vẫn là lần duyệt gần nhất (kể cả mục trừ).
    { rank: 1, memberId: a.id, displayName: 'An', avatarUrl: AN_AVATAR, score: 7, games: 2, lastApprovedAt: new Date('2026-10-10T04:00:00Z') },
  ]);
  expect((await getFactionTop(ctx, '2026-10')).factions.goose.map((r) => [r.memberId, r.points, r.games])).toEqual([[a.id, 7, 2]]);
});

// ---------------------------------------------------------------------------
// Top 3 mỗi phe
// ---------------------------------------------------------------------------

/** Phần role trong một dòng top phe, lấy từ dữ liệu mẫu (đủ `MetricRole` để web đọc điểm). */
const roleOf = (role: Role): FactionTopRowDto['role'] => ({
  id: role.id,
  nameVi: role.nameVi,
  icon: role.icon,
  metricLabel: role.metricLabel,
  points: role.points,
  extraMetricLabel: role.extraMetricLabel,
  extraPoints: role.extraPoints,
  penaltyMetricLabel: role.penaltyMetricLabel,
  penaltyMaxPerGame: role.penaltyMaxPerGame,
  penaltyPoints: role.penaltyPoints,
  faction: role.faction,
});

test('faction top ranks an extra-metric role by its season points (Ám sát 4 + 2 → 10)', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  expect(assassin.faction).toBe('duck');
  expect(assassin.points).toBe(1);
  await approved(a.id, { roleId: assassin.id, value: 4, extraValue: 2, at: '2026-10-10T02:00:00Z' });
  await approved(b.id, { value: 9, at: '2026-10-10T03:00:00Z' }); // Vịt 9 < 10

  const top = await getFactionTop(ctx, '2026-10');
  expect(top.factions.duck).toEqual([
    { rank: 1, memberId: a.id, displayName: 'An', avatarUrl: AN_AVATAR, role: roleOf(assassin), value: 10, points: 10, games: 1 },
    { rank: 2, memberId: b.id, displayName: 'Bình', avatarUrl: null, role: roleOf(duck), value: 9, points: 9, games: 1 },
  ]);
  expect(roleOf(assassin)).toEqual({
    id: assassin.id,
    nameVi: 'Ám sát',
    icon: '🗡️',
    metricLabel: 'Số mạng đã giết',
    points: 1,
    extraMetricLabel: 'Số lần ám sát trong cuộc họp',
    extraPoints: 3,
    penaltyMetricLabel: null,
    penaltyMaxPerGame: null,
    penaltyPoints: null,
    faction: 'duck',
  });

  // Đổi điểm mỗi lần → top phe đổi theo (An 4 + 2 × 1 = 6 < 9).
  await updateRole(ctx, assassin.id, { extraPoints: 1 });
  expect((await getFactionTop(ctx, '2026-10')).factions.duck.map((r) => [r.memberId, r.value, r.points, r.role.extraPoints])).toEqual([
    [b.id, 9, 9, null],
    [a.id, 6, 6, 1],
  ]);
});

test('faction top uses season points straight (no ×5): Dân phòng is worth its `points` per shot, one member may hold several rows, factions are separate', async () => {
  const goose = await roleByKey(testDb, 'goose'); // ×1
  const vigilante = await roleByKey(testDb, 'vigilante'); // points = 5 (điểm khởi đầu), không còn hệ số riêng
  expect(vigilante.points).toBe(5);
  // An: Ngỗng 9 vote (×1 = 9); Dân phòng 2 phát (×5 = 10) → dòng Dân phòng xếp trên; `value` = `points` = điểm mùa.
  await approved(a.id, { roleId: goose.id, value: 9, at: '2026-10-10T02:00:00Z' });
  await approved(a.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T03:00:00Z' });
  await approved(a.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T04:00:00Z' });
  // Bình: Ngỗng 3 (phe Ngỗng) và Vịt 7 (phe Vịt).
  await approved(b.id, { roleId: goose.id, value: 3, at: '2026-10-10T04:30:00Z' });
  await approved(b.id, { value: 7, at: '2026-10-10T05:00:00Z' });

  const top = await getFactionTop(ctx, '2026-10');
  expect(top.seasonId).toBe('2026-10');
  expect(top.factions.goose).toEqual([
    { rank: 1, memberId: a.id, displayName: 'An', avatarUrl: AN_AVATAR, role: roleOf(vigilante), value: 10, points: 10, games: 2 },
    { rank: 2, memberId: a.id, displayName: 'An', avatarUrl: AN_AVATAR, role: roleOf(goose), value: 9, points: 9, games: 1 },
    { rank: 3, memberId: b.id, displayName: 'Bình', avatarUrl: null, role: roleOf(goose), value: 3, points: 3, games: 1 },
  ]);
  expect(top.factions.duck).toEqual([
    { rank: 1, memberId: b.id, displayName: 'Bình', avatarUrl: null, role: roleOf(duck), value: 7, points: 7, games: 1 },
  ]);
  expect(top.factions.neutral).toEqual([]);
  expect(roleOf(duck)).toEqual({
    id: duck.id,
    nameVi: 'Vịt',
    icon: '🦆',
    metricLabel: 'Số mạng đã giết',
    points: 1,
    extraMetricLabel: null,
    extraPoints: null,
    penaltyMetricLabel: null,
    penaltyMaxPerGame: null,
    penaltyPoints: null,
    faction: 'duck',
  });
  expect(roleOf(vigilante)).toMatchObject({ points: 5, penaltyMetricLabel: 'Số phát bắn sai', penaltyMaxPerGame: 1, penaltyPoints: 3 });

  // Admin hạ `points` của Dân phòng về 1 → không còn hệ số nào bù: dòng Dân phòng 2 điểm xuống cuối.
  await testDb.role.update({ where: { id: vigilante.id }, data: { points: 1 } });
  expect((await getFactionTop(ctx, '2026-10')).factions.goose.map((r) => [r.memberId, r.role.id, r.value, r.points])).toEqual([
    [a.id, goose.id, 9, 9],
    [b.id, goose.id, 3, 3],
    [a.id, vigilante.id, 2, 2],
  ]);
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
  await approved(a.id, { roleId: vigilante.id, value: 1 }); // points 5 → 5 điểm
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
// Tổng điểm theo phe
// ---------------------------------------------------------------------------

/** Một dòng tổng điểm với tên/ảnh lấy từ `members` (cùng dữ liệu mẫu: An có ảnh, người khác không). */
const totalRow = (rank: number, m: Member, points: number) => ({
  rank,
  memberId: m.id,
  displayName: m.displayName,
  avatarUrl: m.avatarUrl,
  points,
});

test('faction totals sum the season points of every (member, role) pair of the faction (no ×5); "all" sums the three', async () => {
  const vigilante = await roleByKey(testDb, 'vigilante'); // Ngỗng, points 5
  const assassin = await roleByKey(testDb, 'assassin'); // Vịt, chỉ số phụ ×3
  const dodo = await roleByKey(testDb, 'dodo'); // Phe thứ 3, points 5 (role tối đa 1 mỗi trận)
  expect(dodo.points).toBe(5);
  // An: Vịt 4 + Kiếm sĩ 3 + Ám sát (2 + 1×3 = 5) = 12 Vịt; Dân phòng 1×5 = 5 Ngỗng → cả 3 phe 17.
  await approved(a.id, { value: 4 });
  await approved(a.id, { roleId: swordsman.id, value: 3 });
  await approved(a.id, { roleId: assassin.id, value: 2, extraValue: 1 });
  await approved(a.id, { roleId: vigilante.id, value: 1 });
  // Bình: Cò gáy 2 + Chim đa đa 1×5 = 7 Phe thứ 3 → cả 3 phe 7.
  await approved(b.id, { roleId: cuckoo.id, value: 2 });
  await approved(b.id, { roleId: dodo.id, value: 1 });
  // Cường: chỉ có lần khai 0 điểm → không lên bảng nào; lần chờ duyệt của Bình cũng không tính.
  const c = await createMember(testDb, { displayName: 'Cường' });
  await approved(c.id, { roleId: swordsman.id, value: 0 });
  await submit(b.id, { value: 9 });

  const forAn = await getFactionTotals(ctx, '2026-10', a.id);
  expect(forAn).toEqual({
    seasonId: '2026-10',
    boards: {
      all: { top: [totalRow(1, a, 17), totalRow(2, b, 7)], me: totalRow(1, a, 17) },
      goose: { top: [totalRow(1, a, 5)], me: totalRow(1, a, 5) },
      duck: { top: [totalRow(1, a, 12)], me: totalRow(1, a, 12) },
      neutral: { top: [totalRow(1, b, 7)], me: null },
    },
  });
  // Người xem khác không có điểm: `me` null ở mọi bảng, `top` giữ nguyên.
  const forCuong = await getFactionTotals(ctx, '2026-10', c.id);
  expect(forCuong.boards.all.top).toEqual(forAn.boards.all.top);
  expect(Object.values(forCuong.boards).map((board) => board.me)).toEqual([null, null, null, null]);
  // Mùa khác trống.
  expect(await getFactionTotals(ctx, '2026-09', a.id)).toEqual({
    seasonId: '2026-09',
    boards: { all: { top: [], me: null }, goose: { top: [], me: null }, duck: { top: [], me: null }, neutral: { top: [], me: null } },
  });
});

test('faction totals subtract negative cells: a penalty at one role lowers the member total, a member whose sum is ≤ 0 is absent, `me` is the net sum', async () => {
  const vigilante = await roleByKey(testDb, 'vigilante'); // Ngỗng: +5 mỗi phát trúng, −3 mỗi phát sai
  const goose = await roleByKey(testDb, 'goose'); // Ngỗng ×1
  // An: Dân phòng 0 trúng 1 sai = −3 (cùng phe Ngỗng với Ngỗng +10) → Ngỗng 7; Kiếm sĩ +10 (Vịt) → cả 3 phe 17.
  await approvedRaw(a.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, at: '2026-10-10T02:00:00Z' });
  await approvedRaw(a.id, { roleId: goose.id, value: 10, at: '2026-10-10T03:00:00Z' });
  await approvedRaw(a.id, { roleId: swordsman.id, value: 10, at: '2026-10-10T04:00:00Z' });
  // Bình: Dân phòng −3 (Ngỗng) và Vịt +10 (Vịt) — khác phe: Ngỗng không có (tổng −3), Vịt 10, cả 3 phe 7.
  await approvedRaw(b.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, at: '2026-10-10T02:00:00Z' });
  await approvedRaw(b.id, { roleId: duck.id, value: 10, at: '2026-10-10T05:00:00Z' });
  // Cường: Dân phòng 1 trúng (+5) rồi 2 lần bị trừ (−6) = −1; Ngỗng +1 → tổng Ngỗng 0 → không lên bảng nào.
  const c = await createMember(testDb, { displayName: 'Cường' });
  await approvedRaw(c.id, { roleId: vigilante.id, value: 1, at: '2026-10-10T02:00:00Z' });
  await approvedRaw(c.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, source: 'accusation', at: '2026-10-10T03:00:00Z' });
  await approvedRaw(c.id, { roleId: vigilante.id, value: 0, penaltyValue: 1, source: 'accusation', at: '2026-10-10T04:00:00Z' });
  await approvedRaw(c.id, { roleId: goose.id, value: 1, at: '2026-10-10T05:00:00Z' });

  const forAn = await getFactionTotals(ctx, '2026-10', a.id);
  expect(forAn.boards.all.top.map((r) => [r.memberId, r.points])).toEqual([
    [a.id, 17],
    [b.id, 7],
  ]);
  expect(forAn.boards.goose.top.map((r) => [r.memberId, r.points])).toEqual([[a.id, 7]]);
  expect(forAn.boards.duck.top.map((r) => [r.memberId, r.points])).toEqual([
    [a.id, 10],
    [b.id, 10],
  ]);
  expect(forAn.boards.neutral.top).toEqual([]);
  // `me` là tổng đã trừ.
  expect(forAn.boards.all.me).toEqual(totalRow(1, a, 17));
  expect(forAn.boards.goose.me).toEqual(totalRow(1, a, 7));
  const forBinh = await getFactionTotals(ctx, '2026-10', b.id);
  expect(forBinh.boards.all.me).toEqual(totalRow(2, b, 7));
  expect(forBinh.boards.goose.me).toBeNull(); // tổng Ngỗng −3
  expect(forBinh.boards.duck.me).toEqual(totalRow(2, b, 10));
  const forCuong = await getFactionTotals(ctx, '2026-10', c.id);
  expect(Object.values(forCuong.boards).map((board) => board.me)).toEqual([null, null, null, null]);

  // "Top 3 mỗi phe" vẫn chỉ xếp từng cặp > 0: dòng Dân phòng âm của An/Bình không hiện, Ngỗng +10 của An vẫn hiện.
  const top = await getFactionTop(ctx, '2026-10');
  expect(top.factions.goose.map((r) => [r.memberId, r.role.id, r.points])).toEqual([
    [a.id, goose.id, 10],
    [c.id, goose.id, 1],
  ]);
});

test('faction totals break ties by the latest approval among the summed pairs, then member id; top is 20 rows and `me` may sit outside', async () => {
  // An: Vịt 3 duyệt sớm nhất rồi Kiếm sĩ 2 duyệt MUỘN nhất → tổng 5, mốc phân hoà là mốc muộn.
  await approved(a.id, { value: 3, at: '2026-10-10T01:00:00Z' });
  await approved(b.id, { value: 5, at: '2026-10-10T02:00:00Z' });
  await approved(a.id, { roleId: swordsman.id, value: 2, at: '2026-10-10T03:00:00Z' });
  // Cường và Dũng cùng 5 ở cùng mốc duyệt → id thành viên nhỏ trước.
  const c = await createMember(testDb, { displayName: 'Cường' });
  const d = await createMember(testDb, { displayName: 'Dũng' });
  setNow('2026-10-10T04:00:00Z');
  const rd = await submit(d.id, { value: 5 });
  const rc = await submit(c.id, { value: 5 });
  await reviewReport(ctx, modR(), rd, { approve: true });
  await reviewReport(ctx, modR(), rc, { approve: true });

  const duckBoard = (await getFactionTotals(ctx, '2026-10', a.id)).boards.duck;
  expect(duckBoard.top.map((r) => [r.rank, r.memberId, r.points])).toEqual([
    [1, b.id, 5],
    [2, a.id, 5],
    [3, c.id, 5],
    [4, d.id, 5],
  ]);
  expect(duckBoard.me).toEqual(totalRow(2, a, 5));

  // 22 người có điểm Cò gáy 22..1 (Phe thứ 3): top dừng ở 20; người hạng 22 vẫn thấy dòng của mình; người hạng 20 thấy mình trong top.
  const crowd = [a, b, c, d];
  while (crowd.length < 22) crowd.push(await createMember(testDb, { displayName: `Người ${crowd.length + 1}` }));
  setNow('2026-10-10T05:00:00Z');
  for (const [i, m] of crowd.entries()) await approved(m.id, { roleId: cuckoo.id, value: 22 - i });
  const last = crowd[21] as Member;
  const twentieth = crowd[19] as Member;
  const forLast = (await getFactionTotals(ctx, '2026-10', last.id)).boards.neutral;
  expect(forLast.top).toHaveLength(20);
  expect(forLast.top.map((r) => r.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  expect(forLast.top[0]).toEqual(totalRow(1, a, 22));
  expect(forLast.top.some((r) => r.memberId === last.id)).toBe(false);
  expect(forLast.me).toEqual(totalRow(22, last, 1));
  const forTwentieth = (await getFactionTotals(ctx, '2026-10', twentieth.id)).boards.neutral;
  expect(forTwentieth.me).toEqual(totalRow(20, twentieth, 3));
  expect(forTwentieth.top[19]).toEqual(forTwentieth.me);
});

test('faction totals validate the season and use one grouped query', async () => {
  for (const bad of ['2026-13', '2026-00', '2026-1', '2026/10', '', '2026-10-01']) {
    await expect(getFactionTotals(ctx, bad, a.id)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Mùa không hợp lệ' });
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
    const totals = await getFactionTotals(ctx, '2026-10', b.id);
    expect(groupByCalls).toBe(1);
    expect(totals.boards.all.top.map((r) => [r.memberId, r.points])).toEqual([
      [a.id, 5],
      [b.id, 2],
    ]);
    expect(totals.boards.all.me).toEqual(totalRow(2, b, 2));
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
