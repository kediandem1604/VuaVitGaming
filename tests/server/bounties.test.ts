import type { BountyClaimStatus, GameSession, Member, Role } from '@prisma/client';
import { beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import {
  bountiesForSession,
  createBounty,
  deleteBounty,
  listBounties,
  updateBounty,
} from '../../src/server/modules/bounties/admin.js';
import { closeSeason, ensureSeason, runSeasonJobs } from '../../src/server/modules/seasons/service.js';
import {
  getFactionTop,
  getFactionTotalBoards,
  getFactionTotals,
  getHall,
  getRoleLeaderboard,
  getSeasonLeaders,
} from '../../src/server/modules/stats/leaderboard.js';
import type { BountyInput } from '../../src/shared/api-types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';
import { patchDelegate } from '../helpers/prisma.js';

/** 12:00 ngày 10/10/2026 giờ VN. */
const NOW = '2026-10-10T05:00:00Z';

let ctx: Ctx;
let setNow: (iso: string) => void;
let mod: Member;
let a: Member; // An
let b: Member; // Bình
let duck: Role;
let cuckoo: Role;
let vigilante: Role;
let session: GameSession;

beforeEach(async () => {
  await resetDb();
  ({ ctx, setNow } = makeTestCtx());
  setNow(NOW);
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  a = await createMember(testDb, { displayName: 'An' });
  b = await createMember(testDb, { displayName: 'Bình' });
  duck = await roleByKey(testDb, 'duck');
  cuckoo = await roleByKey(testDb, 'cuckoo');
  vigilante = await roleByKey(testDb, 'vigilante');
  // 21:00 ngày 10/10 giờ VN.
  session = await createSession(testDb, { startsAt: new Date('2026-10-10T14:00:00Z'), createdById: mod.id });
});

const input = (o: Partial<BountyInput> = {}): BountyInput => ({
  title: 'Bồ Nông nuốt hết vịt',
  description: null,
  points: 5,
  roleId: null,
  sessionId: null,
  ...o,
});

/** Lần nhận tạo thẳng trong DB (luật nhận ở Task 2). */
async function claim(o: {
  bountyId?: number;
  memberId: number;
  roleId: number | null;
  points: number;
  status?: BountyClaimStatus;
  playedOn?: string;
  reviewedAt?: string;
  sessionId?: number;
}): Promise<number> {
  const bountyId =
    o.bountyId ?? (await testDb.bounty.create({ data: { title: 'Mục', points: o.points, roleId: o.roleId, createdById: mod.id } })).id;
  const status = o.status ?? 'approved';
  const row = await testDb.bountyClaim.create({
    data: {
      bountyId,
      memberId: o.memberId,
      sessionId: o.sessionId ?? session.id,
      playedOn: dateOnlyToDb(o.playedOn ?? '2026-10-10'),
      roleId: o.roleId,
      points: o.points,
      status,
      source: 'web',
      reviewedAt: status === 'pending' ? null : new Date(o.reviewedAt ?? NOW),
      reviewedById: status === 'pending' ? null : mod.id,
      rejectReason: status === 'rejected' || status === 'revoked' ? 'Sai' : null,
      revokedById: status === 'revoked' ? mod.id : null,
      revokedAt: status === 'revoked' ? new Date(NOW) : null,
    },
  });
  return row.id;
}

/** Lần khai đã duyệt tạo thẳng trong DB. */
async function report(memberId: number, roleId: number, value: number, reviewedAt = NOW): Promise<void> {
  await testDb.statReport.create({
    data: { memberId, roleId, value, playedOn: dateOnlyToDb('2026-10-10'), status: 'approved', reviewedAt: new Date(reviewedAt), reviewedById: mod.id },
  });
}

// ---------------------------------------------------------------------------
// Quản lý mục
// ---------------------------------------------------------------------------

test('create returns the DTO with role, session and zero approved claims; title and description are trimmed', async () => {
  const one = await createBounty(ctx, mod.id, input({ title: '  Binh lính giết 3 vịt  ', description: '  phe thứ 3  ', points: 4, roleId: duck.id, sessionId: session.id }));
  expect(one).toEqual({
    id: one.id,
    title: 'Binh lính giết 3 vịt',
    description: 'phe thứ 3',
    points: 4,
    role: { id: duck.id, nameVi: duck.nameVi, icon: duck.icon, faction: 'duck' },
    session: { id: session.id, startsAt: '2026-10-10T14:00:00.000Z', modeName: 'Cổ điển (Classic)' },
    active: true,
    approvedClaims: 0,
  });
  const row = await testDb.bounty.findUniqueOrThrow({ where: { id: one.id } });
  expect(row.createdById).toBe(mod.id);

  const all = await createBounty(ctx, mod.id, input({ description: '   ' }));
  expect(all).toMatchObject({ description: null, role: null, session: null });
});

test('create and update validate the fields', async () => {
  const bad: [Partial<BountyInput>, string][] = [
    [{ title: '   ' }, 'Tên mục treo thưởng không được để trống'],
    [{ title: 'x'.repeat(81) }, 'Tên mục treo thưởng tối đa 80 ký tự'],
    [{ description: 'x'.repeat(201) }, 'Mô tả tối đa 200 ký tự'],
    [{ points: 0 }, 'Điểm phải từ 1 đến 50'],
    [{ points: 51 }, 'Điểm phải từ 1 đến 50'],
    [{ points: 1.5 }, 'Điểm phải từ 1 đến 50'],
    [{ roleId: 999_999 }, 'Role không hợp lệ'],
    [{ sessionId: 999_999 }, 'Buổi chơi không hợp lệ'],
  ];
  for (const [o, message] of bad) {
    await expect(createBounty(ctx, mod.id, input(o))).rejects.toMatchObject({ code: 'VALIDATION', message });
  }
  // Role đang tắt không gắn được; buổi đã huỷ, hoặc đã kết thúc từ hôm trước, không chọn được.
  await testDb.role.update({ where: { id: cuckoo.id }, data: { active: false } });
  await expect(createBounty(ctx, mod.id, input({ roleId: cuckoo.id }))).rejects.toMatchObject({ message: 'Role không hợp lệ' });
  const cancelled = await createSession(testDb, { status: 'cancelled', startsAt: new Date('2026-10-10T14:00:00Z') });
  await expect(createBounty(ctx, mod.id, input({ sessionId: cancelled.id }))).rejects.toMatchObject({ message: 'Buổi chơi không hợp lệ' });
  const endedYesterday = await createSession(testDb, { status: 'ended', startsAt: new Date('2026-10-09T14:00:00Z') });
  await expect(createBounty(ctx, mod.id, input({ sessionId: endedYesterday.id }))).rejects.toMatchObject({ message: 'Buổi chơi không hợp lệ' });
  // Buổi đã kết thúc hôm nay vẫn chọn được (treo thưởng bù sau buổi).
  const endedToday = await createSession(testDb, { status: 'ended', startsAt: new Date('2026-10-10T02:00:00Z') });
  expect((await createBounty(ctx, mod.id, input({ sessionId: endedToday.id }))).session?.id).toBe(endedToday.id);

  const one = await createBounty(ctx, mod.id, input());
  for (const [o, message] of bad) {
    await expect(updateBounty(ctx, one.id, o)).rejects.toMatchObject({ code: 'VALIDATION', message });
  }
  await expect(updateBounty(ctx, 999_999, { points: 3 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('update changes only the given fields and can switch a bounty off and on; the list shows active first', async () => {
  const one = await createBounty(ctx, mod.id, input({ title: 'Một', points: 3 }));
  const two = await createBounty(ctx, mod.id, input({ title: 'Hai', points: 7, roleId: duck.id }));
  const three = await createBounty(ctx, mod.id, input({ title: 'Ba', points: 1 }));

  const off = await updateBounty(ctx, two.id, { active: false });
  expect(off).toMatchObject({ title: 'Hai', points: 7, active: false, role: { id: duck.id } });
  expect((await listBounties(ctx)).map((x) => x.title)).toEqual(['Ba', 'Một', 'Hai']);

  const edited = await updateBounty(ctx, two.id, { active: true, title: 'Hai mới', roleId: null, sessionId: session.id, description: 'mô tả' });
  expect(edited).toMatchObject({ title: 'Hai mới', points: 7, active: true, role: null, session: { id: session.id }, description: 'mô tả' });
  expect((await updateBounty(ctx, two.id, { description: '' })).description).toBeNull();
  expect((await listBounties(ctx)).map((x) => x.id)).toEqual([three.id, two.id, one.id]);
});

test('a bounty with claims cannot be deleted, only switched off; one without claims is deleted', async () => {
  const used = await createBounty(ctx, mod.id, input({ roleId: duck.id }));
  const unused = await createBounty(ctx, mod.id, input());
  await claim({ bountyId: used.id, memberId: a.id, roleId: duck.id, points: 5, status: 'rejected' });

  await expect(deleteBounty(ctx, used.id)).rejects.toMatchObject({
    code: 'BOUNTY_HAS_CLAIMS',
    message: 'Mục đã có lần nhận — chỉ tắt được, không xoá được',
  });
  expect(await testDb.bounty.count({ where: { id: used.id } })).toBe(1);

  await deleteBounty(ctx, unused.id);
  expect(await testDb.bounty.count({ where: { id: unused.id } })).toBe(0);
  await expect(deleteBounty(ctx, unused.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('approvedClaims counts only approved claims of each bounty', async () => {
  const one = await createBounty(ctx, mod.id, input({ roleId: duck.id }));
  const two = await createBounty(ctx, mod.id, input());
  await claim({ bountyId: one.id, memberId: a.id, roleId: duck.id, points: 5 });
  await claim({ bountyId: one.id, memberId: b.id, roleId: duck.id, points: 5 });
  await claim({ bountyId: one.id, memberId: mod.id, roleId: duck.id, points: 5, status: 'pending' });
  await claim({ bountyId: two.id, memberId: a.id, roleId: null, points: 5, status: 'revoked' });

  const byId = new Map((await listBounties(ctx)).map((x) => [x.id, x.approvedClaims]));
  expect(byId.get(one.id)).toBe(2);
  expect(byId.get(two.id)).toBe(0);
});

test('bountiesForSession: active bounties of that session or of every session, by points desc then id', async () => {
  const other = await createSession(testDb, { startsAt: new Date('2026-10-11T14:00:00Z') });
  const everyLow = await createBounty(ctx, mod.id, input({ title: 'Mọi buổi 2', points: 2 }));
  const ownHigh = await createBounty(ctx, mod.id, input({ title: 'Riêng 9', points: 9, sessionId: session.id }));
  const everyHigh = await createBounty(ctx, mod.id, input({ title: 'Mọi buổi 9', points: 9 }));
  await createBounty(ctx, mod.id, input({ title: 'Buổi khác', points: 20, sessionId: other.id }));
  const off = await createBounty(ctx, mod.id, input({ title: 'Đã tắt', points: 30 }));
  await updateBounty(ctx, off.id, { active: false });

  expect((await bountiesForSession(ctx, session.id)).map((x) => x.id)).toEqual([ownHigh.id, everyHigh.id, everyLow.id]);
  expect((await bountiesForSession(ctx, other.id)).map((x) => x.title)).toEqual(['Buổi khác', 'Mọi buổi 9', 'Mọi buổi 2']);
});

test('every change marks the Discord bounty message of affected sessions that have not ended', async () => {
  const later = await createSession(testDb, { startsAt: new Date('2026-10-11T14:00:00Z') });
  const ended = await createSession(testDb, { status: 'ended', startsAt: new Date('2026-10-10T02:00:00Z') });
  const cancelled = await createSession(testDb, { status: 'cancelled', startsAt: new Date('2026-10-11T14:00:00Z') });
  const dirty = async () =>
    (await testDb.gameSession.findMany({ where: { bountyDirty: true }, select: { id: true }, orderBy: { id: 'asc' } })).map((s) => s.id);
  const clear = () => testDb.gameSession.updateMany({ data: { bountyDirty: false } });

  // Mục riêng một buổi → chỉ buổi đó.
  const own = await createBounty(ctx, mod.id, input({ sessionId: session.id }));
  expect(await dirty()).toEqual([session.id]);
  await clear();
  // Chuyển sang buổi khác → cả buổi cũ lẫn buổi mới.
  await updateBounty(ctx, own.id, { sessionId: later.id });
  expect(await dirty()).toEqual([session.id, later.id]);
  await clear();
  await deleteBounty(ctx, own.id);
  expect(await dirty()).toEqual([later.id]);
  await clear();

  // Mục mọi buổi → mọi buổi còn `scheduled` (không đụng buổi đã kết thúc/huỷ).
  const every = await createBounty(ctx, mod.id, input());
  expect(await dirty()).toEqual([session.id, later.id]);
  await clear();
  await updateBounty(ctx, every.id, { active: false });
  expect(await dirty()).toEqual([session.id, later.id]);
  expect(await dirty()).not.toContain(ended.id);
  expect(await dirty()).not.toContain(cancelled.id);
});

// ---------------------------------------------------------------------------
// Điểm
// ---------------------------------------------------------------------------

test('an approved claim with a role adds its points to that role cell without adding games', async () => {
  await report(a.id, duck.id, 1, '2026-10-10T01:00:00Z');
  await claim({ memberId: a.id, roleId: duck.id, points: 4, reviewedAt: '2026-10-10T02:00:00Z' });
  // Bình chỉ có lần nhận, chưa khai trận nào: vẫn lên bảng với 0 trận.
  await claim({ memberId: b.id, roleId: duck.id, points: 50, reviewedAt: '2026-10-10T03:00:00Z' });

  const board = await getRoleLeaderboard(ctx, duck.id, '2026-10');
  expect(board.map((r) => [r.memberId, r.score, r.games])).toEqual([
    [b.id, 50, 0],
    [a.id, duck.points + 4, 1],
  ]);
  // Mốc phân hoà: lần duyệt gần nhất gồm cả lần nhận.
  expect(board[1]?.lastApprovedAt.toISOString()).toBe('2026-10-10T02:00:00.000Z');

  const leaders = await getSeasonLeaders(ctx, '2026-10');
  expect(leaders.get(duck.id)).toMatchObject({ memberId: b.id, score: 50 });
  const hall = await getHall(ctx, '2026-10');
  expect(hall.roles.find((r) => r.role.id === duck.id)?.holder).toMatchObject({ memberId: b.id, score: 50 });

  const top = await getFactionTop(ctx, '2026-10');
  expect(top.factions.duck.map((r) => [r.memberId, r.points, r.games])).toEqual([
    [b.id, 50, 0],
    [a.id, duck.points + 4, 1],
  ]);

  const totals = await getFactionTotals(ctx, '2026-10', a.id);
  expect(totals.boards.duck.top.map((r) => [r.memberId, r.points])).toEqual([
    [b.id, 50],
    [a.id, duck.points + 4],
  ]);
  expect(totals.boards.all.top.map((r) => [r.memberId, r.points])).toEqual([
    [b.id, 50],
    [a.id, duck.points + 4],
  ]);
  expect((await getFactionTotalBoards(ctx, '2026-10')).duck.map((r) => r.points)).toEqual([50, duck.points + 4]);
});

test('a claim with a role lifts a negative cell: penalties and bounty points net out per (member, role)', async () => {
  await testDb.statReport.create({
    data: {
      memberId: a.id,
      roleId: vigilante.id,
      value: 0,
      penaltyValue: 1,
      playedOn: dateOnlyToDb('2026-10-10'),
      status: 'approved',
      reviewedAt: new Date(NOW),
      reviewedById: mod.id,
    },
  });
  const penalty = vigilante.penaltyPoints ?? 0;
  await claim({ memberId: a.id, roleId: vigilante.id, points: penalty + 2 });
  const board = await getRoleLeaderboard(ctx, vigilante.id, '2026-10');
  expect(board.map((r) => [r.memberId, r.score, r.games])).toEqual([[a.id, 2, 1]]);
});

test('a claim without a role counts only in the "all three factions" totals', async () => {
  await report(a.id, duck.id, 1);
  await claim({ memberId: a.id, roleId: null, points: 3 });
  await claim({ memberId: b.id, roleId: null, points: 7 });

  expect((await getRoleLeaderboard(ctx, duck.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([[a.id, duck.points]]);
  const top = await getFactionTop(ctx, '2026-10');
  expect(top.factions.duck.map((r) => [r.memberId, r.points])).toEqual([[a.id, duck.points]]);
  expect(top.factions.goose).toEqual([]);
  expect(top.factions.neutral).toEqual([]);

  const totals = await getFactionTotals(ctx, '2026-10', b.id);
  expect(totals.boards.all.top.map((r) => [r.memberId, r.points])).toEqual(
    [
      [a.id, duck.points + 3],
      [b.id, 7],
    ].sort((x, y) => (y[1] as number) - (x[1] as number)),
  );
  expect(totals.boards.all.me).toMatchObject({ memberId: b.id, points: 7 });
  expect(totals.boards.duck.top.map((r) => [r.memberId, r.points])).toEqual([[a.id, duck.points]]);
  expect(totals.boards.duck.me).toBeNull();
  expect(totals.boards.goose.top).toEqual([]);
  expect(totals.boards.neutral.top).toEqual([]);
  const boards = await getFactionTotalBoards(ctx, '2026-10');
  expect(boards.duck.map((r) => r.memberId)).toEqual([a.id]);
});

test('pending, rejected and revoked claims and claims played in another season do not count', async () => {
  for (const status of ['pending', 'rejected', 'revoked'] as const) {
    await claim({ memberId: a.id, roleId: duck.id, points: 9, status });
    await claim({ memberId: a.id, roleId: null, points: 9, status });
  }
  await claim({ memberId: b.id, roleId: duck.id, points: 9, playedOn: '2026-09-30' });
  await claim({ memberId: b.id, roleId: null, points: 9, playedOn: '2026-11-01' });

  expect(await getRoleLeaderboard(ctx, duck.id, '2026-10')).toEqual([]);
  const totals = await getFactionTotals(ctx, '2026-10', a.id);
  expect(totals.boards.all.top).toEqual([]);
  expect((await getRoleLeaderboard(ctx, duck.id, '2026-09')).map((r) => [r.memberId, r.score])).toEqual([[b.id, 9]]);
});

test('editing a bounty after a claim keeps the points and role copied on the claim (Review Focus #3)', async () => {
  const bounty = await createBounty(ctx, mod.id, input({ roleId: duck.id, points: 5 }));
  await claim({ bountyId: bounty.id, memberId: a.id, roleId: duck.id, points: 5 });
  await updateBounty(ctx, bounty.id, { points: 50, roleId: cuckoo.id });

  expect((await getRoleLeaderboard(ctx, duck.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([[a.id, 5]]);
  expect(await getRoleLeaderboard(ctx, cuckoo.id, '2026-10')).toEqual([]);
});

test('the boards each add at most one grouped claim query', async () => {
  await report(a.id, duck.id, 1);
  await claim({ memberId: a.id, roleId: duck.id, points: 2 });
  await claim({ memberId: b.id, roleId: null, points: 2 });
  let claimGroupBys = 0;
  const restore = patchDelegate(
    testDb.bountyClaim,
    'groupBy',
    (original) =>
      ((args: never) => {
        claimGroupBys += 1;
        return original(args);
      }) as never,
  );
  try {
    await getFactionTotals(ctx, '2026-10', a.id);
    expect(claimGroupBys).toBe(1);
    await getFactionTop(ctx, '2026-10');
    expect(claimGroupBys).toBe(2);
    await getHall(ctx, '2026-10');
    expect(claimGroupBys).toBe(3);
    await getRoleLeaderboard(ctx, duck.id, '2026-10');
    expect(claimGroupBys).toBe(4);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Chốt mùa
// ---------------------------------------------------------------------------

test('closing the season writes role_titles with bounty points and rejects pending claims of the season', async () => {
  await report(a.id, duck.id, 1);
  await claim({ memberId: b.id, roleId: duck.id, points: duck.points + 1 });
  const pendingIn = await claim({ memberId: a.id, roleId: duck.id, points: 9, status: 'pending' });
  const pendingNoRole = await claim({ memberId: a.id, roleId: null, points: 9, status: 'pending' });
  const pendingNext = await claim({ memberId: a.id, roleId: duck.id, points: 9, status: 'pending', playedOn: '2026-11-01' });

  setNow('2026-11-03T17:05:00Z'); // 00:05 ngày 4/11 giờ VN
  await closeSeason(ctx, '2026-10');

  expect(await testDb.roleTitle.findUnique({ where: { seasonId_roleId: { seasonId: '2026-10', roleId: duck.id } } })).toMatchObject({
    memberId: b.id,
    score: duck.points + 1,
  });
  for (const id of [pendingIn, pendingNoRole]) {
    expect(await testDb.bountyClaim.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'rejected',
      rejectReason: 'Mùa đã chốt',
      reviewedById: null,
      reviewedAt: new Date('2026-11-03T17:05:00Z'),
    });
  }
  expect((await testDb.bountyClaim.findUniqueOrThrow({ where: { id: pendingNext } })).status).toBe('pending');
});

test('a claim slipping in pending after the close is rejected by the season job', async () => {
  await ensureSeason(ctx, '2026-10');
  await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt: new Date('2026-11-03T17:05:00Z') } });
  const stray = await claim({ memberId: a.id, roleId: null, points: 3, status: 'pending' });

  setNow('2026-11-05T00:00:00Z');
  await runSeasonJobs(ctx);
  expect(await testDb.bountyClaim.findUniqueOrThrow({ where: { id: stray } })).toMatchObject({ status: 'rejected', rejectReason: 'Mùa đã chốt' });
});
