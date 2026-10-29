import type { GameSession, Member, Role } from '@prisma/client';
import { beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { createBounty, updateBounty } from '../../src/server/modules/bounties/admin.js';
import {
  claimBounty,
  getSessionBounties,
  listMyBountyClaims,
  listPendingBountyClaims,
  listRecentlyApprovedBountyClaims,
  reviewBountyClaim,
  revokeBountyClaim,
} from '../../src/server/modules/bounties/claims.js';
import { closeSeason } from '../../src/server/modules/seasons/service.js';
import type { BountyInput } from '../../src/shared/api-types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import type { FakeNotifier } from '../helpers/fakes.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';

/** 12:00 ngày 10/10/2026 giờ VN. */
const NOW = '2026-10-10T05:00:00Z';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let mod: Member;
let mod2: Member;
let admin: Member;
let a: Member; // An
let b: Member; // Bình
let duck: Role;
let session: GameSession;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  setNow(NOW);
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod', discordId: 'd-mod' });
  mod2 = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod 2', discordId: 'd-mod2' });
  admin = await createMember(testDb, { accessLevel: 'admin', displayName: 'Admin', discordId: 'd-admin' });
  a = await createMember(testDb, { displayName: 'An', discordId: 'd-an' });
  b = await createMember(testDb, { displayName: 'Bình', discordId: 'd-binh' });
  duck = await roleByKey(testDb, 'duck');
  // 21:00 ngày 10/10 giờ VN.
  session = await createSession(testDb, { startsAt: new Date('2026-10-10T14:00:00Z'), createdById: mod.id });
  await going(session.id, a.id);
});

async function going(sessionId: number, memberId: number, status: 'going' | 'cancelled' = 'going'): Promise<void> {
  await testDb.attendance.create({ data: { sessionId, memberId, status } });
}

const bountyInput = (o: Partial<BountyInput> = {}): BountyInput => ({
  title: 'Bồ Nông nuốt hết vịt',
  description: null,
  points: 5,
  roleId: null,
  sessionId: null,
  ...o,
});

async function bounty(o: Partial<BountyInput> = {}): Promise<number> {
  return (await createBounty(ctx, mod.id, bountyInput(o))).id;
}

const reviewer = (m: Member) => ({ id: m.id, accessLevel: m.accessLevel });

// ---------------------------------------------------------------------------
// Nhận
// ---------------------------------------------------------------------------

test('claiming creates a pending claim that copies role and points from the bounty', async () => {
  const id = await bounty({ roleId: duck.id, points: 4, title: 'Giết 3 ngỗng' });
  const dto = await claimBounty(ctx, a.id, session.id, id, 'web');
  expect(dto).toEqual({
    id: dto.id,
    bounty: { id, title: 'Giết 3 ngỗng', description: null },
    member: { id: a.id, displayName: 'An' },
    session: { id: session.id, startsAt: '2026-10-10T14:00:00.000Z', modeName: 'Cổ điển (Classic)' },
    playedOn: '2026-10-10',
    role: { id: duck.id, nameVi: duck.nameVi, icon: duck.icon, faction: 'duck' },
    points: 4,
    status: 'pending',
    rejectReason: null,
    source: 'web',
    createdAt: new Date(NOW).toISOString(),
    reviewedBy: null,
    reviewedAt: null,
  });
  const row = await testDb.bountyClaim.findUniqueOrThrow({ where: { id: dto.id } });
  expect(row).toMatchObject({ roleId: duck.id, points: 4, memberId: a.id, sessionId: session.id, source: 'web' });
  expect(await testDb.season.findUnique({ where: { id: '2026-10' } })).not.toBeNull();
});

test('editing the bounty later does not change an existing claim (review focus #3)', async () => {
  const id = await bounty({ roleId: duck.id, points: 4 });
  const dto = await claimBounty(ctx, a.id, session.id, id, 'discord');
  await updateBounty(ctx, id, { points: 9, roleId: null });
  const row = await testDb.bountyClaim.findUniqueOrThrow({ where: { id: dto.id } });
  expect(row).toMatchObject({ roleId: duck.id, points: 4, source: 'discord' });
});

test('a member who left the server cannot claim', async () => {
  const id = await bounty();
  await testDb.member.update({ where: { id: a.id }, data: { status: 'left' } });
  await expect(claimBounty(ctx, a.id, session.id, id, 'web')).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('claiming does not need attendance: no attendance or a cancelled one can claim (owner decision 2026-10-30)', async () => {
  const id = await bounty();
  await expect(claimBounty(ctx, b.id, session.id, id, 'web')).resolves.toMatchObject({ member: { id: b.id }, status: 'pending' });
  await going(session.id, mod.id, 'cancelled');
  await expect(claimBounty(ctx, mod.id, session.id, id, 'discord')).resolves.toMatchObject({ member: { id: mod.id }, status: 'pending', source: 'discord' });
});

test('a missing session is not found; a cancelled one cannot be claimed; an ended one can', async () => {
  const id = await bounty();
  await expect(claimBounty(ctx, a.id, 999_999, id, 'web')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await testDb.gameSession.update({ where: { id: session.id }, data: { status: 'cancelled' } });
  await expect(claimBounty(ctx, a.id, session.id, id, 'web')).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
  await testDb.gameSession.update({ where: { id: session.id }, data: { status: 'ended' } });
  await expect(claimBounty(ctx, a.id, session.id, id, 'web')).resolves.toMatchObject({ status: 'pending' });
});

test('the bounty must apply to the session: its own session or every session, and switched on', async () => {
  const other = await createSession(testDb, { startsAt: new Date('2026-10-10T10:00:00Z'), createdById: mod.id });
  const forOther = await bounty({ sessionId: other.id });
  const off = await bounty();
  await updateBounty(ctx, off, { active: false });
  const message = 'Mục treo thưởng không áp dụng cho buổi này';
  for (const id of [forOther, off, 999_999]) {
    await expect(claimBounty(ctx, a.id, session.id, id, 'web')).rejects.toMatchObject({ message });
  }
  const forThis = await bounty({ sessionId: session.id });
  await expect(claimBounty(ctx, a.id, session.id, forThis, 'web')).resolves.toMatchObject({ status: 'pending' });
});

test('claims are accepted up to 3 VN days after the session', async () => {
  const id = await bounty();
  // 23:30 ngày 13/10 giờ VN: còn trong hạn (ngày buổi 10/10 = hôm nay − 3).
  setNow('2026-10-13T16:30:00Z');
  await expect(claimBounty(ctx, a.id, session.id, id, 'web')).resolves.toMatchObject({ playedOn: '2026-10-10' });
  // 00:00 ngày 14/10 giờ VN: quá hạn.
  setNow('2026-10-13T17:00:00Z');
  await going(session.id, b.id);
  await expect(claimBounty(ctx, b.id, session.id, id, 'web')).rejects.toMatchObject({ message: 'Đã quá hạn nhận (3 ngày sau buổi chơi)' });
});

test('a session on a later VN day cannot be claimed yet', async () => {
  const id = await bounty();
  const tomorrow = await createSession(testDb, { startsAt: new Date('2026-10-11T14:00:00Z'), createdById: mod.id });
  await going(tomorrow.id, a.id);
  await expect(claimBounty(ctx, a.id, tomorrow.id, id, 'web')).rejects.toMatchObject({ code: 'VALIDATION', message: 'Buổi chơi chưa diễn ra' });
});

test('a closed season cannot be claimed', async () => {
  const id = await bounty();
  await closeSeason(ctx, '2026-10');
  await expect(claimBounty(ctx, a.id, session.id, id, 'web')).rejects.toMatchObject({ code: 'SEASON_CLOSED', message: 'Mùa này đã chốt' });
});

test('each bounty is claimed once per member and session, even after a rejection', async () => {
  const id = await bounty();
  const first = await claimBounty(ctx, a.id, session.id, id, 'web');
  const message = 'Bạn đã nhận mục này ở buổi này rồi';
  await expect(claimBounty(ctx, a.id, session.id, id, 'discord')).rejects.toMatchObject({ code: 'BOUNTY_ALREADY_CLAIMED', message });
  await reviewBountyClaim(ctx, reviewer(mod), first.id, { approve: false, reason: 'Không đúng' });
  await expect(claimBounty(ctx, a.id, session.id, id, 'web')).rejects.toMatchObject({ message });
  // Người khác vẫn nhận được.
  await going(session.id, b.id);
  await expect(claimBounty(ctx, b.id, session.id, id, 'web')).resolves.toMatchObject({ status: 'pending' });
});

test('web and Discord claiming at the same moment create exactly one claim (review focus #1)', async () => {
  const id = await bounty();
  const results = await Promise.allSettled([
    claimBounty(ctx, a.id, session.id, id, 'web'),
    claimBounty(ctx, a.id, session.id, id, 'discord'),
    claimBounty(ctx, a.id, session.id, id, 'web'),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  for (const r of results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')) {
    expect(r.reason).toMatchObject({ code: 'BOUNTY_ALREADY_CLAIMED', message: 'Bạn đã nhận mục này ở buổi này rồi' });
  }
  expect(await testDb.bountyClaim.count()).toBe(1);
});

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

test('session bounties list the applicable bounties, the viewer claims and whether claiming is open', async () => {
  const big = await bounty({ points: 9, sessionId: session.id });
  const small = await bounty({ points: 2 });
  const claimed = await claimBounty(ctx, a.id, session.id, small, 'web');
  await claimBounty(ctx, b.id, session.id, big, 'web');

  const mine = await getSessionBounties(ctx, a.id, session.id);
  expect(mine).not.toHaveProperty('attended');
  expect(mine.sessionId).toBe(session.id);
  expect(mine.open).toBe(true);
  expect(mine.bounties.map((x) => x.id)).toEqual([big, small]);
  expect(mine.myClaims).toEqual([claimed]);

  const stranger = await getSessionBounties(ctx, mod.id, session.id);
  expect(stranger).toMatchObject({ open: true, myClaims: [] });

  setNow('2026-10-14T05:00:00Z');
  expect((await getSessionBounties(ctx, a.id, session.id)).open).toBe(false);
  setNow(NOW);
  await testDb.gameSession.update({ where: { id: session.id }, data: { status: 'cancelled' } });
  expect((await getSessionBounties(ctx, a.id, session.id)).open).toBe(false);

  await expect(getSessionBounties(ctx, a.id, 999_999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('admin lists: pending oldest first, recently approved newest first; my claims newest first', async () => {
  await going(session.id, b.id);
  const x = await bounty({ title: 'X' });
  const y = await bounty({ title: 'Y' });
  const first = await claimBounty(ctx, a.id, session.id, x, 'web');
  setNow('2026-10-10T06:00:00Z');
  const second = await claimBounty(ctx, b.id, session.id, x, 'discord');
  setNow('2026-10-10T07:00:00Z');
  const third = await claimBounty(ctx, a.id, session.id, y, 'web');

  expect((await listPendingBountyClaims(ctx)).map((c) => c.id)).toEqual([first.id, second.id, third.id]);

  await reviewBountyClaim(ctx, reviewer(mod), third.id, { approve: true });
  setNow('2026-10-10T08:00:00Z');
  await reviewBountyClaim(ctx, reviewer(mod), first.id, { approve: true });
  const approved = await listRecentlyApprovedBountyClaims(ctx);
  expect(approved.map((c) => c.id)).toEqual([first.id, third.id]);
  expect(approved[0]).toMatchObject({ status: 'approved', reviewedBy: { id: mod.id, displayName: 'Mod' }, reviewedAt: '2026-10-10T08:00:00.000Z' });
  expect((await listPendingBountyClaims(ctx)).map((c) => c.id)).toEqual([second.id]);

  expect((await listMyBountyClaims(ctx, a.id)).map((c) => c.id)).toEqual([third.id, first.id]);
  expect((await listMyBountyClaims(ctx, a.id, 1)).map((c) => c.id)).toEqual([third.id]);
});

test('recently approved hides claims of closed seasons', async () => {
  const id = await bounty();
  const c = await claimBounty(ctx, a.id, session.id, id, 'web');
  await reviewBountyClaim(ctx, reviewer(mod), c.id, { approve: true });
  await closeSeason(ctx, '2026-10');
  expect(await listRecentlyApprovedBountyClaims(ctx)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Duyệt / từ chối
// ---------------------------------------------------------------------------

async function pendingClaim(o: Partial<BountyInput> = {}): Promise<number> {
  return (await claimBounty(ctx, a.id, session.id, await bounty(o), 'web')).id;
}

test('only mods and admins review', async () => {
  const id = await pendingClaim();
  await expect(reviewBountyClaim(ctx, reviewer(b), id, { approve: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(revokeBountyClaim(ctx, reviewer(b), id, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('a mod cannot review or revoke their own claim; an admin can', async () => {
  const x = await bounty();
  await going(session.id, mod.id);
  await going(session.id, admin.id);
  const own = await claimBounty(ctx, mod.id, session.id, x, 'web');
  await expect(reviewBountyClaim(ctx, reviewer(mod), own.id, { approve: true })).rejects.toMatchObject({
    code: 'SELF_REVIEW',
    message: 'Mod không được tự duyệt lần nhận của mình',
  });
  await reviewBountyClaim(ctx, reviewer(mod2), own.id, { approve: true });
  await expect(revokeBountyClaim(ctx, reviewer(mod), own.id, 'Sai')).rejects.toMatchObject({
    code: 'SELF_REVIEW',
    message: 'Mod không được huỷ duyệt lần nhận của mình',
  });

  const adminOwn = await claimBounty(ctx, admin.id, session.id, x, 'web');
  await reviewBountyClaim(ctx, reviewer(admin), adminOwn.id, { approve: true });
  await revokeBountyClaim(ctx, reviewer(admin), adminOwn.id, 'Nhầm');
  expect((await testDb.bountyClaim.findUniqueOrThrow({ where: { id: adminOwn.id } })).status).toBe('revoked');
});

test('missing claims are not found', async () => {
  await expect(reviewBountyClaim(ctx, reviewer(mod), 999_999, { approve: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(revokeBountyClaim(ctx, reviewer(mod), 999_999, 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('rejecting needs a trimmed reason of 1–200 characters and DMs the claimant', async () => {
  const id = await pendingClaim({ title: 'Giết 3 ngỗng' });
  await expect(reviewBountyClaim(ctx, reviewer(mod), id, { approve: false, reason: '   ' })).rejects.toMatchObject({
    code: 'REASON_REQUIRED',
    message: 'Cần ghi lý do từ chối',
  });
  await expect(reviewBountyClaim(ctx, reviewer(mod), id, { approve: false, reason: 'x'.repeat(201) })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Lý do từ chối tối đa 200 ký tự',
  });
  await reviewBountyClaim(ctx, reviewer(mod), id, { approve: false, reason: '  Không có bằng chứng  ' });
  const row = await testDb.bountyClaim.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({ status: 'rejected', rejectReason: 'Không có bằng chứng', reviewedById: mod.id, reviewedAt: new Date(NOW) });
  expect(notifier.dms).toEqual([{ discordId: 'd-an', text: 'Lần nhận treo thưởng "Giết 3 ngỗng" (buổi 10/10) bị từ chối: Không có bằng chứng' }]);
  expect(notifier.bountyCompletions).toEqual([]);
});

test('approving stores the reviewer and time, then posts the completion to the bounty channel', async () => {
  const id = await pendingClaim({ title: 'Giết 3 ngỗng', points: 4 });
  await reviewBountyClaim(ctx, reviewer(mod), id, { approve: true });
  const row = await testDb.bountyClaim.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({ status: 'approved', reviewedById: mod.id, reviewedAt: new Date(NOW), rejectReason: null });
  expect(notifier.bountyCompletions).toEqual([{ memberName: 'An', bountyTitle: 'Giết 3 ngỗng', points: 4 }]);
  expect(notifier.dms).toEqual([]);
  // Mục không role: không ai hoá thân.
  expect(notifier.announcements).toEqual([]);
});

test('approving or revoking a role claim announces a change of role holder', async () => {
  // Bình đang dẫn đầu Vịt với 1 lần khai (điểm của role Vịt cho 1 mạng).
  await testDb.statReport.create({
    data: { memberId: b.id, roleId: duck.id, value: 1, playedOn: new Date('2026-10-10'), status: 'approved', reviewedAt: new Date(NOW), reviewedById: mod.id },
  });
  const id = await pendingClaim({ roleId: duck.id, points: 50 });
  await reviewBountyClaim(ctx, reviewer(mod), id, { approve: true });
  expect(notifier.announcements).toEqual([`👑 An đã hoá thân ${duck.nameVi} mùa 2026-10!`]);

  await revokeBountyClaim(ctx, reviewer(mod), id, '  Gian lận  ');
  expect(notifier.announcements).toEqual([`👑 An đã hoá thân ${duck.nameVi} mùa 2026-10!`, `👑 Bình đã hoá thân ${duck.nameVi} mùa 2026-10!`]);
});

test('a claim is reviewed once: the second review is told it was already handled', async () => {
  const id = await pendingClaim();
  const results = await Promise.allSettled([
    reviewBountyClaim(ctx, reviewer(mod), id, { approve: true }),
    reviewBountyClaim(ctx, reviewer(mod2), id, { approve: false, reason: 'Sai' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  expect(failed?.reason).toMatchObject({ code: 'NOT_PENDING', message: 'Lần nhận này đã được xử lý' });
  await expect(reviewBountyClaim(ctx, reviewer(mod), id, { approve: true })).rejects.toMatchObject({ code: 'NOT_PENDING' });
});

test('reviews are refused once the season is closed', async () => {
  const id = await pendingClaim();
  await closeSeason(ctx, '2026-10'); // từ chối luôn lần nhận chờ duyệt
  await testDb.bountyClaim.update({ where: { id }, data: { status: 'pending', rejectReason: null, reviewedAt: null } });
  await expect(reviewBountyClaim(ctx, reviewer(mod), id, { approve: true })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
});

test('Discord being down does not undo an approval or a rejection', async () => {
  const x = await pendingClaim();
  const y = await pendingClaim({ title: 'Khác' });
  notifier.down = true;
  await reviewBountyClaim(ctx, reviewer(mod), x, { approve: true });
  await reviewBountyClaim(ctx, reviewer(mod), y, { approve: false, reason: 'Sai' });
  expect((await testDb.bountyClaim.findUniqueOrThrow({ where: { id: x } })).status).toBe('approved');
  expect((await testDb.bountyClaim.findUniqueOrThrow({ where: { id: y } })).status).toBe('rejected');
});

test('a pending claim can still be reviewed after its session was cancelled (review focus #4)', async () => {
  const x = await pendingClaim();
  const y = await pendingClaim({ title: 'Khác' });
  await testDb.gameSession.update({ where: { id: session.id }, data: { status: 'cancelled' } });
  await reviewBountyClaim(ctx, reviewer(mod), x, { approve: true });
  await reviewBountyClaim(ctx, reviewer(mod), y, { approve: false, reason: 'Buổi huỷ' });
  expect((await testDb.bountyClaim.findUniqueOrThrow({ where: { id: x } })).status).toBe('approved');
  expect((await testDb.bountyClaim.findUniqueOrThrow({ where: { id: y } })).status).toBe('rejected');
});

test('approving while the season closes either counts in role_titles or ends rejected "Mùa đã chốt" (review focus #2)', async () => {
  for (let round = 0; round < 3; round++) {
    await resetDb();
    ({ ctx, notifier, setNow } = makeTestCtx());
    setNow(NOW);
    mod = await createMember(testDb, { accessLevel: 'mod' });
    a = await createMember(testDb, { displayName: 'An' });
    session = await createSession(testDb, { startsAt: new Date('2026-10-10T14:00:00Z'), createdById: mod.id });
    await going(session.id, a.id);
    const id = await pendingClaim({ roleId: duck.id, points: 7 });

    const [review] = await Promise.allSettled([reviewBountyClaim(ctx, reviewer(mod), id, { approve: true }), closeSeason(ctx, '2026-10')]);
    const row = await testDb.bountyClaim.findUniqueOrThrow({ where: { id } });
    const title = await testDb.roleTitle.findUnique({ where: { seasonId_roleId: { seasonId: '2026-10', roleId: duck.id } } });
    if (review.status === 'fulfilled') {
      expect(row.status).toBe('approved');
      expect(title).toMatchObject({ memberId: a.id, score: 7 });
    } else {
      expect(review.reason).toMatchObject({ code: expect.stringMatching(/^(SEASON_CLOSED|NOT_PENDING)$/) });
      expect(row).toMatchObject({ status: 'rejected', rejectReason: 'Mùa đã chốt' });
      expect(title).toBeNull();
    }
  }
});

// ---------------------------------------------------------------------------
// Huỷ duyệt
// ---------------------------------------------------------------------------

test('revoking needs an approved claim and a reason, keeps the reviewer and DMs the claimant', async () => {
  const id = await pendingClaim({ title: 'Giết 3 ngỗng' });
  await expect(revokeBountyClaim(ctx, reviewer(mod), id, 'Sai')).rejects.toMatchObject({
    code: 'NOT_APPROVED',
    message: 'Lần nhận không còn ở trạng thái đã duyệt',
  });
  await reviewBountyClaim(ctx, reviewer(mod), id, { approve: true });
  setNow('2026-10-10T06:00:00Z');
  await expect(revokeBountyClaim(ctx, reviewer(mod2), id, '  ')).rejects.toMatchObject({ code: 'REASON_REQUIRED', message: 'Cần ghi lý do huỷ duyệt' });
  await expect(revokeBountyClaim(ctx, reviewer(mod2), id, 'x'.repeat(201))).rejects.toMatchObject({ code: 'VALIDATION' });
  await revokeBountyClaim(ctx, reviewer(mod2), id, ' Gian lận ');
  const row = await testDb.bountyClaim.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({
    status: 'revoked',
    rejectReason: 'Gian lận',
    reviewedById: mod.id,
    revokedById: mod2.id,
    revokedAt: new Date('2026-10-10T06:00:00Z'),
  });
  expect(notifier.dms).toEqual([{ discordId: 'd-an', text: 'Lần nhận treo thưởng "Giết 3 ngỗng" (buổi 10/10) đã bị huỷ duyệt: Gian lận' }]);
  await expect(revokeBountyClaim(ctx, reviewer(mod2), id, 'Lần nữa')).rejects.toMatchObject({ code: 'NOT_APPROVED' });
});

test('revoking is refused once the season is closed', async () => {
  const id = await pendingClaim();
  await reviewBountyClaim(ctx, reviewer(mod), id, { approve: true });
  await closeSeason(ctx, '2026-10');
  await expect(revokeBountyClaim(ctx, reviewer(mod), id, 'Sai')).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
});
