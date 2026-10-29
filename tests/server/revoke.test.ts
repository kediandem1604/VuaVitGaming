import type { Member, Prisma, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { closeSeason } from '../../src/server/modules/seasons/service.js';
import { getFactionTop, getRoleLeader, getRoleLeaderboard } from '../../src/server/modules/stats/leaderboard.js';
import {
  listRecentlyApproved,
  reviewReport,
  revokeReport,
  submitReport,
  updateOwnReport,
} from '../../src/server/modules/stats/reports.js';
import { formatReportValue } from '../../src/shared/metric.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';
import { patchDelegate } from '../helpers/prisma.js';

/** 12:00 ngày 10/10/2026 giờ VN: khai được các trận từ 07/10 đến 10/10. */
const NOW = '2026-10-10T05:00:00Z';
/** Giờ huỷ duyệt trong các test: 10:00 ngày 11/10 giờ VN. */
const REVOKE_AT = '2026-10-11T03:00:00Z';
/** Sau giờ chốt mùa 10/2026 (00:05 ngày 04/11 giờ VN). */
const AFTER_CLOSE = '2026-11-03T18:00:00Z';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
/** Người khai mặc định (An). */
let member: Member;
let mod: Member;
let duck: Role;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  setNow(NOW);
  member = await createMember(testDb, { displayName: 'An' });
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  duck = await roleByKey(testDb, 'duck');
});
afterEach(() => vi.restoreAllMocks());

const asReviewer = (m: Member) => ({ id: m.id, accessLevel: m.accessLevel });
const reportRow = (id: number) => testDb.statReport.findUniqueOrThrow({ where: { id } });
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

/** Khai một lần (mặc định An, Vịt, 3 mạng, ngày 10/10); trả về id. */
async function submit(o: { memberId?: number; roleId?: number; value?: number; playedOn?: string } = {}): Promise<number> {
  const r = await submitReport(ctx, o.memberId ?? member.id, {
    roleId: o.roleId ?? duck.id,
    value: o.value ?? 3,
    playedOn: o.playedOn ?? '2026-10-10',
  });
  return r.id;
}

/** Khai rồi duyệt ngay bởi `by` (mặc định Mod); trả về id. */
async function approved(o: { memberId?: number; roleId?: number; value?: number; playedOn?: string; by?: Member } = {}): Promise<number> {
  const id = await submit(o);
  await reviewReport(ctx, asReviewer(o.by ?? mod), id, { approve: true });
  return id;
}

// ---------------------------------------------------------------------------
// Huỷ duyệt
// ---------------------------------------------------------------------------

test('revoking an approved report stores who, when and why, keeps the approver, and DMs the reporter', async () => {
  const id = await approved();
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Vịt mùa 2026-10!']);

  setNow(REVOKE_AT);
  await expect(revokeReport(ctx, asReviewer(mod), id, '  Clip không khớp  ')).resolves.toBeUndefined();

  expect(await reportRow(id)).toMatchObject({
    status: 'revoked',
    revokedById: mod.id,
    revokedAt: new Date(REVOKE_AT),
    rejectReason: 'Clip không khớp', // đã cắt khoảng trắng
    // Người duyệt ban đầu giữ nguyên.
    reviewedById: mod.id,
    reviewedAt: new Date(NOW),
    value: 3,
    playedOn: dateOnlyToDb('2026-10-10'),
  });

  // DM dùng nhãn thật của role trong seed qua `formatReportValue`.
  const text = `Lần khai ${duck.nameVi} (${formatReportValue({ value: 3, extraValue: 0, penaltyValue: 0 }, duck)}) ngày 10/10 đã bị huỷ duyệt: Clip không khớp`;
  expect(text).toBe('Lần khai Vịt (3 mạng đã giết) ngày 10/10 đã bị huỷ duyệt: Clip không khớp');
  expect(notifier.dms).toEqual([{ discordId: member.discordId, text }]);

  // Không còn ai dẫn đầu Vịt → không đăng gì thêm.
  expect(await getRoleLeader(ctx, duck.id, '2026-10')).toBeNull();
  expect(notifier.announcements).toHaveLength(1);
});

test('revoke rules', async () => {
  const admin = await createMember(testDb, { accessLevel: 'admin', displayName: 'Admin' });
  const modR = asReviewer(mod);
  const adminR = asReviewer(admin);

  const ok = await approved();
  const pending = await submit();
  const rejected = await submit();
  await reviewReport(ctx, modR, rejected, { approve: false, reason: 'Thiếu clip' });
  const ownOfMod = await approved({ memberId: mod.id, by: admin });
  const ownOfAdmin = await approved({ memberId: admin.id, by: admin });

  // Quyền → có lần khai → đang approved → không tự huỷ → lý do → mùa chưa chốt.
  await expect(revokeReport(ctx, asReviewer(member), ok, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(revokeReport(ctx, modR, 9999, 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(revokeReport(ctx, modR, 1.5, 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(revokeReport(ctx, modR, pending, 'x')).rejects.toMatchObject({
    code: 'NOT_APPROVED',
    message: 'Lần khai không còn ở trạng thái đã duyệt',
  });
  await expect(revokeReport(ctx, modR, rejected, 'x')).rejects.toMatchObject({ code: 'NOT_APPROVED' });
  await expect(revokeReport(ctx, modR, ownOfMod, 'x')).rejects.toMatchObject({
    code: 'SELF_REVIEW',
    message: 'Mod không được huỷ duyệt lần khai của mình',
  });
  await expect(revokeReport(ctx, modR, ok, '   ')).rejects.toMatchObject({ code: 'REASON_REQUIRED', message: 'Cần ghi lý do huỷ duyệt' });
  await expect(revokeReport(ctx, modR, ok, '')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  await expect(revokeReport(ctx, modR, ok, 'x'.repeat(201))).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Lý do huỷ duyệt tối đa 200 ký tự',
  });
  // Lý do sai kiểu (dữ liệu từ ngoài) là dữ liệu không hợp lệ; thiếu hẳn là thiếu lý do.
  await expect(revokeReport(ctx, modR, ok, 5 as never)).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(revokeReport(ctx, modR, ok, undefined as never)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  // Lần khai không còn approved được báo trước luật tự huỷ và lý do.
  const pendingOfMod = await submit({ memberId: mod.id });
  await expect(revokeReport(ctx, modR, pendingOfMod, '')).rejects.toMatchObject({ code: 'NOT_APPROVED' });

  // Mọi lần hỏng ở trên không đụng tới dữ liệu; không DM ai.
  expect(await reportRow(ok)).toMatchObject({ status: 'approved', revokedById: null, revokedAt: null, rejectReason: null });
  expect(await reportRow(ownOfMod)).toMatchObject({ status: 'approved' });
  // Chỉ có DM từ chối lúc dựng dữ liệu; các lần huỷ hỏng không DM ai.
  expect(notifier.dms.map((d) => d.text)).toEqual(['Lần khai Vịt (3 mạng đã giết) ngày 10/10 bị từ chối: Thiếu clip']);

  // Admin tự huỷ được; mod huỷ của người khác với lý do đúng 200 ký tự.
  await expect(revokeReport(ctx, adminR, ownOfAdmin, 'Khai nhầm')).resolves.toBeUndefined();
  expect(await reportRow(ownOfAdmin)).toMatchObject({ status: 'revoked', revokedById: admin.id, rejectReason: 'Khai nhầm', reviewedById: admin.id });
  await expect(revokeReport(ctx, modR, ok, `  ${'y'.repeat(200)}  `)).resolves.toBeUndefined();
  expect((await reportRow(ok)).rejectReason).toBe('y'.repeat(200));
  expect(notifier.dms.slice(1).map((d) => d.discordId)).toEqual([admin.discordId, member.discordId]);
  expect(notifier.dms[2]?.text).toBe(`Lần khai Vịt (3 mạng đã giết) ngày 10/10 đã bị huỷ duyệt: ${'y'.repeat(200)}`);

  // Đã huỷ rồi thì không huỷ lại được.
  await expect(revokeReport(ctx, adminR, ok, 'Lần hai')).rejects.toMatchObject({ code: 'NOT_APPROVED' });
  expect((await reportRow(ok)).rejectReason).toBe('y'.repeat(200));

  // Mùa đã chốt → SEASON_CLOSED, lần khai vẫn approved.
  setNow(AFTER_CLOSE);
  await closeSeason(ctx, '2026-10');
  await expect(revokeReport(ctx, adminR, ownOfMod, 'Muộn')).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
  expect(await reportRow(ownOfMod)).toMatchObject({ status: 'approved', revokedById: null });
  expect(notifier.dms).toHaveLength(3);
});

test('a DM failure does not undo the revoke', async () => {
  const errors = silenceConsoleError();
  const id = await approved();

  notifier.failDmFor.add(member.discordId);
  await expect(revokeReport(ctx, asReviewer(mod), id, 'Sai role')).resolves.toBeUndefined();
  expect(await reportRow(id)).toMatchObject({ status: 'revoked', revokedById: mod.id, rejectReason: 'Sai role' });
  expect(notifier.dms).toEqual([]);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(String(errors.mock.calls[0]?.[0])).toContain(String(id));

  // Discord sập hẳn (DM lẫn thông báo hoá thân): vẫn huỷ xong.
  notifier.failDmFor.clear();
  const other = await createMember(testDb, { displayName: 'Bình' });
  const id2 = await approved({ memberId: other.id, value: 5 });
  await approved({ value: 2 });
  notifier.down = true;
  await expect(revokeReport(ctx, asReviewer(mod), id2, 'Trùng trận')).resolves.toBeUndefined();
  expect(await reportRow(id2)).toMatchObject({ status: 'revoked', rejectReason: 'Trùng trận' });
  // An lại dẫn đầu Vịt nhưng Discord sập: lỗi DM + lỗi đăng chỉ ghi log.
  expect(await getRoleLeader(ctx, duck.id, '2026-10')).toMatchObject({ memberId: member.id, score: 2 });
  expect(errors).toHaveBeenCalledTimes(3);
});

test('two concurrent revokes: exactly one wins, one DM', async () => {
  const mod2 = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod 2' });
  const id = await approved();

  const outcomes = await Promise.allSettled([
    revokeReport(ctx, asReviewer(mod), id, 'Lý do 1'),
    revokeReport(ctx, asReviewer(mod2), id, 'Lý do 2'),
  ]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  const loser = outcomes.find((o) => o.status === 'rejected');
  expect(loser?.status === 'rejected' && loser.reason).toMatchObject({ code: 'NOT_APPROVED' });

  const row = await reportRow(id);
  const winner = outcomes[0]?.status === 'fulfilled' ? { by: mod.id, reason: 'Lý do 1' } : { by: mod2.id, reason: 'Lý do 2' };
  expect(row).toMatchObject({ status: 'revoked', revokedById: winner.by, rejectReason: winner.reason });
  expect(notifier.dms).toHaveLength(1);
  expect(notifier.dms[0]?.text).toContain(winner.reason);
});

// ---------------------------------------------------------------------------
// Điểm, hoá thân, chốt mùa
// ---------------------------------------------------------------------------

test('revoking the leader hands the incarnation to the next player and announces it; no one left → no post', async () => {
  const binh = await createMember(testDb, { displayName: 'Bình' });
  const swordsman = await roleByKey(testDb, 'swordsman');
  const anDuck = await approved({ value: 5 });
  await approved({ memberId: binh.id, value: 3 });
  const anSword = await approved({ roleId: swordsman.id, value: 4 });
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Vịt mùa 2026-10!', '👑 An đã hoá thân Kiếm sĩ mùa 2026-10!']);

  // Huỷ của An → Bình lên hoá thân Vịt.
  await revokeReport(ctx, asReviewer(mod), anDuck, 'Clip không khớp');
  expect(await getRoleLeader(ctx, duck.id, '2026-10')).toMatchObject({ memberId: binh.id, displayName: 'Bình', score: 3 });
  expect(notifier.announcements).toHaveLength(3);
  expect(notifier.announcements[2]).toBe('👑 Bình đã hoá thân Vịt mùa 2026-10!');

  // Kiếm sĩ chỉ có An → huỷ → không còn ai, không đăng gì.
  await revokeReport(ctx, asReviewer(mod), anSword, 'Khai nhầm role');
  expect(await getRoleLeader(ctx, swordsman.id, '2026-10')).toBeNull();
  expect(notifier.announcements).toHaveLength(3);
  expect(notifier.dms).toHaveLength(2);
});

test('leaderboard and season close ignore a revoked report', async () => {
  const binh = await createMember(testDb, { displayName: 'Bình' });
  const anDuck = await approved({ value: 5 });
  await approved({ memberId: binh.id, value: 3 });
  expect((await getRoleLeaderboard(ctx, duck.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([[member.id, 5], [binh.id, 3]]);

  await revokeReport(ctx, asReviewer(mod), anDuck, 'Clip không khớp');
  expect((await getRoleLeaderboard(ctx, duck.id, '2026-10')).map((r) => [r.memberId, r.score])).toEqual([[binh.id, 3]]);
  const top = await getFactionTop(ctx, '2026-10');
  expect(top.factions.duck.map((r) => [r.memberId, r.value])).toEqual([[binh.id, 3]]);

  setNow(AFTER_CLOSE);
  await closeSeason(ctx, '2026-10');
  expect(await testDb.roleTitle.findMany({ where: { seasonId: '2026-10' } })).toMatchObject([{ roleId: duck.id, memberId: binh.id, score: 3 }]);
  expect(await reportRow(anDuck)).toMatchObject({ status: 'revoked' });
});

test('revoke racing season close never leaves a title counting a revoked report', async () => {
  const binh = await createMember(testDb, { displayName: 'Bình' });
  const anDuck = await approved({ value: 5 });
  await approved({ memberId: binh.id, value: 3 });
  setNow(AFTER_CLOSE);

  const [revoke, close] = await Promise.allSettled([revokeReport(ctx, asReviewer(mod), anDuck, 'Clip không khớp'), closeSeason(ctx, '2026-10')]);
  expect(close.status).toBe('fulfilled');
  const titles = await testDb.roleTitle.findMany({ where: { seasonId: '2026-10', roleId: duck.id } });
  const row = await reportRow(anDuck);
  if (revoke.status === 'fulfilled') {
    // Huỷ trước khi chốt: danh hiệu Vịt thuộc Bình, không tính 5 điểm đã huỷ.
    expect(row).toMatchObject({ status: 'revoked', revokedById: mod.id });
    expect(titles).toMatchObject([{ memberId: binh.id, score: 3 }]);
    expect(notifier.dms).toHaveLength(1);
  } else {
    // Chốt trước: huỷ bị từ chối vì mùa đã chốt, lần khai vẫn approved và danh hiệu là của An.
    expect(revoke.reason).toMatchObject({ code: 'SEASON_CLOSED' });
    expect(row).toMatchObject({ status: 'approved', revokedById: null, revokedAt: null });
    expect(titles).toMatchObject([{ memberId: member.id, score: 5 }]);
    expect(notifier.dms).toEqual([]);
  }
  expect(await testDb.season.findUniqueOrThrow({ where: { id: '2026-10' } })).toMatchObject({ closedAt: new Date(AFTER_CLOSE) });
});

test('season close started while a revoke holds the season lock waits for it and skips the revoked report', async () => {
  const binh = await createMember(testDb, { displayName: 'Bình' });
  const anDuck = await approved({ value: 5 });
  await approved({ memberId: binh.id, value: 3 });
  setNow(AFTER_CLOSE);

  // Chen `closeSeason` vào đúng lúc giao dịch huỷ đã khoá dòng mùa và ghi xong nhưng chưa
  // commit: `closeSeason` phải đứng chờ ở `season.updateMany` cho tới khi huỷ commit, rồi
  // tính danh hiệu không có 5 điểm đã huỷ. Chỉ bọc giao dịch đầu tiên (của revokeReport);
  // giao dịch của closeSeason đi thẳng.
  let close: Promise<{ titles: number; autoRejected: number }> | null = null;
  const restore = patchDelegate(testDb, '$transaction', (original) =>
    (async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts?: unknown) => {
      if (close !== null) return (original as (f: typeof fn, o?: unknown) => Promise<unknown>).call(testDb, fn, opts);
      return (original as (f: typeof fn, o?: unknown) => Promise<unknown>).call(
        testDb,
        async (tx) => {
          const result = await fn(tx);
          close = closeSeason(ctx, '2026-10');
          // Đủ lâu để closeSeason tới chỗ cập nhật dòng mùa và bị khoá chặn.
          await new Promise((resolve) => setTimeout(resolve, 300));
          expect(await testDb.season.findUniqueOrThrow({ where: { id: '2026-10' } })).toMatchObject({ closedAt: null });
          return result;
        },
        opts,
      );
    }) as never,
  );
  try {
    await expect(revokeReport(ctx, asReviewer(mod), anDuck, 'Clip không khớp')).resolves.toBeUndefined();
    expect(close).not.toBeNull();
    expect(await close!).toEqual({ titles: 1, autoRejected: 0 });
  } finally {
    restore();
  }

  expect(await reportRow(anDuck)).toMatchObject({ status: 'revoked', revokedById: mod.id });
  expect(await testDb.roleTitle.findMany({ where: { seasonId: '2026-10' } })).toMatchObject([{ roleId: duck.id, memberId: binh.id, score: 3 }]);
  expect(await testDb.season.findUniqueOrThrow({ where: { id: '2026-10' } })).toMatchObject({ closedAt: new Date(AFTER_CLOSE) });
  expect(notifier.dms).toHaveLength(1);
});

test('a revoked report can no longer be edited or reviewed', async () => {
  const mod2 = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod 2' });
  const id = await approved();
  await revokeReport(ctx, asReviewer(mod), id, 'Clip không khớp');

  await expect(updateOwnReport(ctx, member.id, id, { value: 5 })).rejects.toMatchObject({ code: 'NOT_PENDING' });
  await expect(reviewReport(ctx, asReviewer(mod2), id, { approve: true })).rejects.toMatchObject({ code: 'NOT_PENDING' });
  await expect(reviewReport(ctx, asReviewer(mod2), id, { approve: false, reason: 'Muộn' })).rejects.toMatchObject({ code: 'NOT_PENDING' });
  expect(await reportRow(id)).toMatchObject({ status: 'revoked', value: 3, reviewedById: mod.id, rejectReason: 'Clip không khớp' });
  expect(notifier.dms).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Danh sách đã duyệt gần đây
// ---------------------------------------------------------------------------

test('listRecentlyApproved: approved reports of open seasons, newest review first, at most 50, with the approver', async () => {
  const binh = await createMember(testDb, { displayName: 'Bình' });
  const swordsman = await roleByKey(testDb, 'swordsman');
  expect(await listRecentlyApproved(ctx)).toEqual([]);

  const r1 = await approved({ playedOn: '2026-10-09' }); // duyệt lúc NOW
  setNow('2026-10-10T05:00:01Z');
  const r2 = await approved({ memberId: binh.id, roleId: swordsman.id, value: 4 });
  const r3 = await approved({ value: 1 }); // cùng reviewedAt với r2 → id lớn hơn đứng trước
  await submit(); // pending: không hiện
  const rejected = await submit();
  await reviewReport(ctx, asReviewer(mod), rejected, { approve: false, reason: 'Thiếu clip' });
  const revoked = await approved({ value: 2 });
  await revokeReport(ctx, asReviewer(mod), revoked, 'Khai nhầm');

  const list = await listRecentlyApproved(ctx);
  expect(list.map((r) => r.id)).toEqual([r3, r2, r1]);
  expect(list[2]).toEqual({
    id: r1,
    member: { id: member.id, displayName: 'An' },
    role: {
      id: duck.id,
      nameVi: 'Vịt',
      icon: '🦆',
      metricLabel: 'Số mạng đã giết',
      maxPerGame: 15,
      points: 1,
      extraMetricLabel: null,
      extraMaxPerGame: null,
      extraPoints: null,
      penaltyMetricLabel: null,
      penaltyMaxPerGame: null,
      penaltyPoints: null,
    },
    value: 3,
    extraValue: 0,
    penaltyValue: 0,
    bonusPoints: 0,
    source: 'self',
    multiplier: 1,
    points: 3,
    playedOn: '2026-10-09',
    sessionId: null,
    note: null,
    status: 'approved',
    rejectReason: null,
    createdAt: '2026-10-10T05:00:00.000Z',
    highlightUrl: null,
    accusation: null,
    accusationDuplicate: false,
    accusationWaitingFor: null,
    penaltyOf: null,
    reviewedBy: { id: mod.id, displayName: 'Mod' },
    reviewedAt: '2026-10-10T05:00:00.000Z',
  });
  expect(list[0]).toMatchObject({ id: r3, member: { displayName: 'An' }, reviewedAt: '2026-10-10T05:00:01.000Z' });
  expect(list[1]).toMatchObject({ id: r2, member: { displayName: 'Bình' }, role: { nameVi: 'Kiếm sĩ' }, value: 4, reviewedBy: { displayName: 'Mod' } });

  // Nạp thẳng 51 lần đã duyệt (bỏ giới hạn 30/ngày) với reviewedAt tăng dần → chỉ 50 dòng mới nhất.
  await testDb.statReport.createMany({
    data: Array.from({ length: 51 }, (_, i) => ({
      memberId: binh.id,
      roleId: duck.id,
      playedOn: dateOnlyToDb('2026-10-08'),
      value: 1 + (i % 10),
      status: 'approved' as const,
      reviewedById: mod.id,
      reviewedAt: new Date(Date.UTC(2026, 9, 10, 6, 0, i)),
      createdAt: new Date('2026-10-10T05:30:00Z'),
    })),
  });
  const capped = await listRecentlyApproved(ctx);
  expect(capped).toHaveLength(50);
  expect(capped[0]?.reviewedAt).toBe('2026-10-10T06:00:50.000Z');
  expect(capped[49]?.reviewedAt).toBe('2026-10-10T06:00:01.000Z');
  expect(capped.every((r) => r.status === 'approved' && r.reviewedBy?.displayName === 'Mod')).toBe(true);
});

test('listRecentlyApproved includes last month until it closes', async () => {
  setNow('2026-11-02T05:00:00Z'); // 12:00 ngày 02/11 VN: cửa sổ 30/10 → 02/11
  const octA = await approved({ playedOn: '2026-10-30', value: 5 });
  const octB = await approved({ playedOn: '2026-10-31', value: 2 });
  setNow('2026-11-02T05:00:01Z');
  const nov = await approved({ playedOn: '2026-11-01', value: 4 });
  // Mùa 09 chưa có dòng (coi là chưa chốt) nhưng không phải mùa hiện tại/mùa trước → không hiện.
  await testDb.statReport.create({
    data: {
      memberId: member.id,
      roleId: duck.id,
      playedOn: dateOnlyToDb('2026-09-15'),
      value: 9,
      status: 'approved',
      reviewedById: mod.id,
      reviewedAt: new Date('2026-11-02T05:00:02Z'),
    },
  });
  expect((await listRecentlyApproved(ctx)).map((r) => r.id)).toEqual([nov, octB, octA]);

  // Lần khai tháng 10 vẫn huỷ được khi mùa 10 chưa chốt.
  await expect(revokeReport(ctx, asReviewer(mod), octA, 'Clip không khớp')).resolves.toBeUndefined();
  expect((await listRecentlyApproved(ctx)).map((r) => r.id)).toEqual([nov, octB]);

  // Mùa 10 chốt → lần khai tháng 10 rời danh sách và không huỷ được nữa.
  await closeSeason(ctx, '2026-10');
  expect((await listRecentlyApproved(ctx)).map((r) => r.id)).toEqual([nov]);
  await expect(revokeReport(ctx, asReviewer(mod), octB, 'Muộn')).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
  expect(await reportRow(octB)).toMatchObject({ status: 'approved' });
});
