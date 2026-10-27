import type { Member, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { closeSeason } from '../../src/server/modules/seasons/service.js';
import { getRoleLeaderboard } from '../../src/server/modules/stats/leaderboard.js';
import {
  getReportDto,
  listMyReports,
  listPendingReports,
  listRecentlyApproved,
  reviewReport,
  revokeReport,
  submitReport,
  updateOwnReport,
} from '../../src/server/modules/stats/reports.js';
import type { ReviewDecision } from '../../src/server/modules/stats/reports.js';
import type { AccusationInputDto, Faction } from '../../src/shared/api-types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';

/** 12:00 ngày 10/10/2026 giờ VN: khai được các trận từ 07/10 đến 10/10. */
const NOW = '2026-10-10T05:00:00Z';
const PLAYED_ON = '2026-10-10';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
/** Người báo cáo (An), người bị báo cáo (Bình), người bị bắn (Cường), người báo cáo thứ hai (Dũng). */
let an: Member;
let binh: Member;
let cuong: Member;
let dung: Member;
let mod: Member;
let admin: Member;
/** Role của lần khai người báo cáo (không có chỉ số phạt). */
let duck: Role;
/** Dân phòng: 5 điểm mỗi phát trúng, phạt 3 điểm mỗi phát bắn sai. */
let vigilante: Role;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  setNow(NOW);
  an = await createMember(testDb, { displayName: 'An' });
  binh = await createMember(testDb, { displayName: 'Bình' });
  cuong = await createMember(testDb, { displayName: 'Cường' });
  dung = await createMember(testDb, { displayName: 'Dũng' });
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  admin = await createMember(testDb, { accessLevel: 'admin', displayName: 'Admin' });
  duck = await roleByKey(testDb, 'duck');
  vigilante = await roleByKey(testDb, 'vigilante');
});
afterEach(() => vi.restoreAllMocks());

const asReviewer = (m: Member) => ({ id: m.id, accessLevel: m.accessLevel });
const reportRow = (id: number) => testDb.statReport.findUniqueOrThrow({ where: { id } });
const accusationOf = (reportId: number) => testDb.playerAccusation.findUniqueOrThrow({ where: { reportId } });
const penaltyRows = () => testDb.statReport.findMany({ where: { source: 'accusation' }, orderBy: { id: 'asc' } });

/** Báo cáo mặc định: Bình (Dân phòng) bắn Cường — phe Ngỗng. */
const accusation = (o: Partial<AccusationInputDto> = {}): AccusationInputDto => ({
  accusedId: binh.id,
  accusedRoleId: vigilante.id,
  victimId: cuong.id,
  victimFaction: 'goose' as Faction,
  ...o,
});

/** Khai Vịt 2 mạng ngày 10/10 (mặc định An) kèm báo cáo `acc`; trả về id lần khai. */
async function submitWith(acc: AccusationInputDto | null = accusation(), o: { memberId?: number; playedOn?: string } = {}): Promise<number> {
  const r = await submitReport(ctx, o.memberId ?? an.id, {
    roleId: duck.id,
    value: 2,
    playedOn: o.playedOn ?? PLAYED_ON,
    ...(acc ? { accusation: acc } : {}),
  });
  return r.id;
}

const review = (by: Member, id: number, d: ReviewDecision) => reviewReport(ctx, asReviewer(by), id, d);
const approveBoth = (id: number, by = mod) => review(by, id, { approve: true, accusation: 'approve' });

// ---------------------------------------------------------------------------
// Gửi, sửa, bỏ
// ---------------------------------------------------------------------------

test('an accusation rides along a new report; PATCH replaces, keeps, moves its date, or removes it (null)', async () => {
  const id = await submitWith();
  expect(await accusationOf(id)).toMatchObject({
    reporterId: an.id,
    accusedId: binh.id,
    accusedRoleId: vigilante.id,
    victimId: cuong.id,
    victimFaction: 'goose',
    playedOn: dateOnlyToDb(PLAYED_ON),
    status: 'pending',
    createdAt: new Date(NOW),
  });
  const dto = await getReportDto(ctx, id);
  expect(dto.accusation).toEqual({
    id: (await accusationOf(id)).id,
    status: 'pending',
    accused: { id: binh.id, displayName: 'Bình' },
    accusedRole: { id: vigilante.id, nameVi: 'Dân phòng', icon: vigilante.icon, penaltyPoints: 3 },
    victim: { id: cuong.id, displayName: 'Cường' },
    victimFaction: 'goose',
    rejectReason: null,
  });
  expect(dto.accusationDuplicate).toBe(false);
  expect(dto.penaltyOf).toBeNull();

  // Không gửi `accusation` → giữ nguyên; đổi ngày chơi → báo cáo theo ngày mới.
  const first = await accusationOf(id);
  await updateOwnReport(ctx, an.id, id, { value: 3, playedOn: '2026-10-09' });
  expect(await accusationOf(id)).toMatchObject({ id: first.id, playedOn: dateOnlyToDb('2026-10-09') });

  // Gửi y hệt → không tạo lại (giữ chỗ sớm nhất trong vụ); gửi khác → thay.
  await updateOwnReport(ctx, an.id, id, { accusation: accusation() });
  expect((await accusationOf(id)).id).toBe(first.id);
  await updateOwnReport(ctx, an.id, id, { accusation: accusation({ victimId: dung.id, victimFaction: 'duck' }) });
  expect(await accusationOf(id)).toMatchObject({ victimId: dung.id, victimFaction: 'duck', status: 'pending' });

  // `null` = bỏ báo cáo.
  await updateOwnReport(ctx, an.id, id, { accusation: null });
  expect(await testDb.playerAccusation.count()).toBe(0);
  expect((await getReportDto(ctx, id)).accusation).toBeNull();

  // Thêm báo cáo khi sửa lần khai chưa có.
  const plain = await submitWith(null);
  await updateOwnReport(ctx, an.id, plain, { accusation: accusation() });
  expect((await accusationOf(plain)).status).toBe('pending');
});

test('accusation checks: all four fields, no self-accusation, victim ≠ accused, active members, a role with a penalty', async () => {
  const left = await createMember(testDb, { displayName: 'Đã rời', status: 'left' });
  const cases: [unknown, string][] = [
    [{ accusedId: binh.id, accusedRoleId: vigilante.id, victimId: cuong.id }, 'Báo cáo cần đủ người bị báo cáo, role, người bị bắn và phe'],
    [{ ...accusation(), victimFaction: 'bird' }, 'Báo cáo cần đủ người bị báo cáo, role, người bị bắn và phe'],
    [accusation({ accusedId: an.id }), 'Không thể tự báo cáo chính mình'],
    [accusation({ victimId: binh.id }), 'Người bị bắn phải khác người bị báo cáo'],
    [accusation({ accusedId: left.id }), 'Người bị báo cáo không còn trong server'],
    [accusation({ accusedId: 99_999 }), 'Người bị báo cáo không còn trong server'],
    [accusation({ accusedRoleId: duck.id }), 'Role bị báo cáo phải đang bật và có điểm trừ'],
    [accusation({ victimId: left.id }), 'Người bị bắn không còn trong server'],
  ];
  for (const [acc, message] of cases) {
    await expect(submitWith(acc as AccusationInputDto), message).rejects.toMatchObject({ code: 'VALIDATION', message });
  }
  // Không lần khai nào được tạo khi báo cáo sai.
  expect(await testDb.statReport.count()).toBe(0);

  // Sửa cũng kiểm như vậy, và báo cáo cũ còn nguyên.
  const id = await submitWith();
  await expect(updateOwnReport(ctx, an.id, id, { accusation: accusation({ accusedId: an.id }) })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Không thể tự báo cáo chính mình',
  });
  expect((await accusationOf(id)).accusedId).toBe(binh.id);
});

// ---------------------------------------------------------------------------
// Hàng chờ và báo cáo trùng
// ---------------------------------------------------------------------------

test('the queue attaches only the earliest pending accusation of a case; later duplicates are hidden with a flag', async () => {
  const first = await submitWith();
  setNow('2026-10-10T05:01:00Z');
  const dup = await submitWith(accusation(), { memberId: dung.id });
  // Khác người bị bắn → vụ khác, hiện riêng.
  const other = await submitWith(accusation({ victimId: dung.id }), { memberId: cuong.id });

  const queue = await listPendingReports(ctx);
  const byId = new Map(queue.map((r) => [r.id, r]));
  expect(byId.get(first)).toMatchObject({ accusation: { accused: { displayName: 'Bình' } }, accusationDuplicate: false });
  expect(byId.get(dup)).toMatchObject({ accusation: null, accusationDuplicate: true });
  expect(byId.get(other)).toMatchObject({ accusation: { victim: { displayName: 'Dũng' } }, accusationDuplicate: false });

  // Người khai trùng vẫn thấy báo cáo của mình (đang chờ) kèm cờ trùng.
  expect((await listMyReports(ctx, dung.id))[0]).toMatchObject({ accusation: { status: 'pending' }, accusationDuplicate: true });
});

// ---------------------------------------------------------------------------
// Duyệt
// ---------------------------------------------------------------------------

test('three decisions: approve both, approve but drop the accusation (reason needed), reject both; a decision is required', async () => {
  const a = await submitWith();
  const b = await submitWith(accusation({ victimId: dung.id }));
  const c = await submitWith(accusation({ accusedId: dung.id }));

  await expect(review(mod, a, { approve: true })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Cần chọn duyệt hay bỏ báo cáo kèm lần khai',
  });
  await expect(review(mod, a, { approve: false, reason: 'Sai' })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(review(mod, a, { approve: false, reason: 'Sai', accusation: 'approve' })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Lần khai bị từ chối thì báo cáo cũng bị bác',
  });
  await expect(review(mod, b, { approve: true, accusation: 'reject' })).rejects.toMatchObject({
    code: 'REASON_REQUIRED',
    message: 'Cần ghi lý do bỏ báo cáo',
  });
  expect((await reportRow(a)).status).toBe('pending');

  // "Duyệt" → cả hai đúng.
  await approveBoth(a);
  expect(await reportRow(a)).toMatchObject({ status: 'approved', bonusPoints: 1 });
  expect(await accusationOf(a)).toMatchObject({ status: 'approved', reviewedById: mod.id, reviewedAt: new Date(NOW) });

  // "Duyệt, bỏ báo cáo" → lần khai duyệt (không bonus), báo cáo bị bác kèm lý do.
  await review(mod, b, { approve: true, accusation: 'reject', reason: '  Không đủ bằng chứng ' });
  expect(await reportRow(b)).toMatchObject({ status: 'approved', bonusPoints: 0, rejectReason: null });
  expect(await accusationOf(b)).toMatchObject({ status: 'rejected', rejectReason: 'Không đủ bằng chứng', penaltyReportId: null });

  // "Từ chối" → lần khai bị từ chối, báo cáo bị bác cùng lý do.
  await review(mod, c, { approve: false, reason: 'Khai sai', accusation: 'reject' });
  expect(await reportRow(c)).toMatchObject({ status: 'rejected', rejectReason: 'Khai sai' });
  expect(await accusationOf(c)).toMatchObject({ status: 'rejected', rejectReason: 'Khai sai' });

  // Chỉ báo cáo đúng tạo mục trừ điểm.
  expect(await penaltyRows()).toHaveLength(1);
});

test('a correct accusation: reporter +1, an approved penalty row for the accused, duplicates superseded, DM, holder re-checked', async () => {
  // Bình đang hoá thân Dân phòng (5 điểm, duyệt trước), Em cũng 5 điểm nhưng duyệt sau.
  const em = await createMember(testDb, { displayName: 'Em' });
  const own = await submitReport(ctx, binh.id, { roleId: vigilante.id, value: 1, playedOn: '2026-10-09' });
  await review(mod, own.id, { approve: true });
  setNow('2026-10-10T05:00:30Z');
  const emReport = await submitReport(ctx, em.id, { roleId: vigilante.id, value: 1, playedOn: '2026-10-09' });
  await review(mod, emReport.id, { approve: true });
  notifier.announcements.length = 0;

  setNow('2026-10-10T05:01:00Z');
  const first = await submitWith();
  setNow('2026-10-10T05:02:00Z');
  const dup = await submitWith(accusation(), { memberId: dung.id });
  setNow('2026-10-10T06:00:00Z');
  await approveBoth(first);

  expect(await reportRow(first)).toMatchObject({ status: 'approved', bonusPoints: 1 });
  const [penalty] = await penaltyRows();
  expect(penalty).toMatchObject({
    memberId: binh.id,
    roleId: vigilante.id,
    playedOn: dateOnlyToDb(PLAYED_ON),
    value: 0,
    extraValue: 0,
    penaltyValue: 1,
    bonusPoints: 0,
    source: 'accusation',
    status: 'approved',
    reviewedById: mod.id,
    reviewedAt: new Date('2026-10-10T06:00:00Z'),
    note: 'Bị báo cáo: bắn Cường (phe Ngỗng)',
  });
  expect((await accusationOf(first)).penaltyReportId).toBe(penalty?.id);
  expect(await accusationOf(dup)).toMatchObject({ status: 'superseded', rejectReason: 'Đã có người báo cáo trước' });
  // Lần khai của người báo cáo trùng vẫn chờ duyệt, giờ không còn khung báo cáo nào hiện.
  expect((await reportRow(dup)).status).toBe('pending');
  expect((await listPendingReports(ctx)).find((r) => r.id === dup)).toMatchObject({ accusation: null, accusationDuplicate: false });

  expect(notifier.dms).toEqual([{ discordId: binh.discordId, text: 'Bạn bị trừ 3 điểm (Dân phòng) ngày 10/10: bị báo cáo bắn Cường (phe Ngỗng).' }]);

  // Bình còn 5 − 3 = 2 điểm → Em lên dẫn đầu, đăng hoá thân.
  const board = await getRoleLeaderboard(ctx, vigilante.id, '2026-10');
  expect(board.map((r) => [r.displayName, r.score, r.games])).toEqual([
    ['Em', 5, 1],
    ['Bình', 2, 1], // mục trừ điểm không đếm vào số trận
  ]);
  // Lần khai Vịt của An cũng vừa được duyệt (An lần đầu hoá thân Vịt), rồi tới role bị trừ.
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Vịt mùa 2026-10!', '👑 Em đã hoá thân Dân phòng mùa 2026-10!']);

  // Người bị báo cáo thấy mục trừ điểm trong "Lần khai của tôi" kèm báo cáo đã tạo ra nó.
  const mine = await listMyReports(ctx, binh.id);
  expect(mine[0]).toMatchObject({
    id: penalty?.id,
    source: 'accusation',
    points: -3,
    accusation: null,
    penaltyOf: { status: 'approved', victim: { displayName: 'Cường' }, victimFaction: 'goose' },
  });

  // Duyệt lần khai trùng sau đó: báo cáo đã superseded, không cần (và không được) quyết định.
  await review(mod, dup, { approve: true });
  expect(await penaltyRows()).toHaveLength(1);
});

test('two duplicates reviewed at the same moment: the accused is penalised once', async () => {
  const first = await submitWith();
  setNow('2026-10-10T05:01:00Z');
  const dup = await submitWith(accusation(), { memberId: dung.id });
  const mod2 = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod 2' });

  // Hai lượt xếp hàng trên dòng mùa; thứ tự nào cũng xong cả hai.
  await Promise.all([approveBoth(first), review(mod2, dup, { approve: true })]);
  expect(await penaltyRows()).toHaveLength(1);
  expect(await accusationOf(dup)).toMatchObject({ status: 'superseded', rejectReason: 'Đã có người báo cáo trước' });
  expect((await reportRow(dup)).status).toBe('approved');
});

test('a decision sent for an accusation that is hidden or gone → NOT_PENDING "xem lại"; no extra penalty', async () => {
  const first = await submitWith();
  setNow('2026-10-10T05:01:00Z');
  const dup = await submitWith(accusation(), { memberId: dung.id });
  await expect(review(mod, dup, { approve: true, accusation: 'approve' })).rejects.toMatchObject({
    code: 'NOT_PENDING',
    message: 'Lần khai vừa được sửa, hãy xem lại',
  });
  // Người khai vừa bỏ báo cáo trước khi mod bấm.
  await updateOwnReport(ctx, an.id, first, { accusation: null });
  await expect(approveBoth(first)).rejects.toMatchObject({ code: 'NOT_PENDING', message: 'Lần khai vừa được sửa, hãy xem lại' });
  expect(await penaltyRows()).toHaveLength(0);
  expect((await reportRow(first)).status).toBe('pending');
});

test('rejecting the shown accusation brings the next pending duplicate up', async () => {
  const first = await submitWith();
  setNow('2026-10-10T05:01:00Z');
  const dup = await submitWith(accusation(), { memberId: dung.id });

  await review(mod, first, { approve: true, accusation: 'reject', reason: 'Clip không rõ' });
  const shown = (await listPendingReports(ctx)).find((r) => r.id === dup);
  expect(shown).toMatchObject({ accusation: { id: (await accusationOf(dup)).id }, accusationDuplicate: false });
  await approveBoth(dup);
  expect(await penaltyRows()).toHaveLength(1);
});

test('a mod cannot decide an accusation against themselves (SELF_REVIEW); an admin can', async () => {
  const id = await submitWith(accusation({ accusedId: mod.id }));
  await expect(approveBoth(id)).rejects.toMatchObject({ code: 'SELF_REVIEW', message: 'Mod không được duyệt báo cáo về chính mình' });
  await expect(review(mod, id, { approve: true, accusation: 'reject', reason: 'x' })).rejects.toMatchObject({ code: 'SELF_REVIEW' });
  expect((await reportRow(id)).status).toBe('pending');
  await approveBoth(id, admin);
  expect(await penaltyRows()).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Huỷ duyệt
// ---------------------------------------------------------------------------

test("revoking the reporter's report revokes the penalty too (same reason), keeps the bonus on the revoked row, DMs both", async () => {
  const id = await submitWith();
  await approveBoth(id);
  const [penalty] = await penaltyRows();
  notifier.dms.length = 0;

  setNow('2026-10-11T03:00:00Z');
  await revokeReport(ctx, asReviewer(mod), id, 'Báo cáo sai');
  expect(await reportRow(id)).toMatchObject({ status: 'revoked', bonusPoints: 1 });
  expect(await reportRow(penalty!.id)).toMatchObject({
    status: 'revoked',
    rejectReason: 'Báo cáo sai',
    revokedById: mod.id,
    revokedAt: new Date('2026-10-11T03:00:00Z'),
  });
  expect((await accusationOf(id)).status).toBe('approved');
  expect(notifier.dms).toEqual([
    { discordId: an.discordId, text: 'Lần khai Vịt (2 mạng đã giết) ngày 10/10 đã bị huỷ duyệt: Báo cáo sai' },
    { discordId: binh.discordId, text: 'Mục trừ điểm (Dân phòng) ngày 10/10 do bị báo cáo bắn Cường (phe Ngỗng) đã được gỡ: Báo cáo sai' },
  ]);
});

test('the penalty row can be revoked on its own: DM the accused, accusation and bonus stay; a later cascade is a no-op', async () => {
  const id = await submitWith();
  await approveBoth(id);
  const [penalty] = await penaltyRows();
  notifier.dms.length = 0;

  // Mục trừ điểm có trong "Đã duyệt gần đây".
  expect((await listRecentlyApproved(ctx)).map((r) => r.id)).toContain(penalty!.id);

  await revokeReport(ctx, asReviewer(mod), penalty!.id, 'Nhầm người');
  expect((await reportRow(penalty!.id)).status).toBe('revoked');
  expect((await accusationOf(id)).status).toBe('approved');
  expect(await reportRow(id)).toMatchObject({ status: 'approved', bonusPoints: 1 });
  expect(notifier.dms).toEqual([
    { discordId: binh.discordId, text: 'Mục trừ điểm (Dân phòng) ngày 10/10 do bị báo cáo bắn Cường (phe Ngỗng) đã được gỡ: Nhầm người' },
  ]);

  // Huỷ lần khai người báo cáo sau đó: không lỗi, không DM thừa cho người bị báo cáo.
  notifier.dms.length = 0;
  await revokeReport(ctx, asReviewer(mod), id, 'Huỷ luôn');
  expect((await reportRow(penalty!.id)).rejectReason).toBe('Nhầm người');
  expect(notifier.dms).toEqual([{ discordId: an.discordId, text: 'Lần khai Vịt (2 mạng đã giết) ngày 10/10 đã bị huỷ duyệt: Huỷ luôn' }]);
});

test("a mod who is the accused cannot revoke the reporter's report (it would lift their own penalty)", async () => {
  const id = await submitWith(accusation({ accusedId: mod.id }));
  await approveBoth(id, admin);
  await expect(revokeReport(ctx, asReviewer(mod), id, 'x')).rejects.toMatchObject({ code: 'SELF_REVIEW' });
  expect((await reportRow(id)).status).toBe('approved');
});

// ---------------------------------------------------------------------------
// Chốt mùa, mục trừ điểm
// ---------------------------------------------------------------------------

test('closing the season rejects pending accusations of the auto-rejected reports with the same reason', async () => {
  const id = await submitWith();
  setNow('2026-11-03T18:00:00Z');
  await closeSeason(ctx, '2026-10');
  expect((await reportRow(id)).status).toBe('rejected');
  expect(await accusationOf(id)).toMatchObject({ status: 'rejected', rejectReason: 'Mùa đã chốt' });
});

test('penalty rows never enter the queue, cannot be edited, and do not count toward the daily cap', async () => {
  const id = await submitWith();
  await approveBoth(id);
  const [penalty] = await penaltyRows();

  expect((await listPendingReports(ctx)).map((r) => r.id)).not.toContain(penalty!.id);
  await expect(updateOwnReport(ctx, binh.id, penalty!.id, { value: 1 })).rejects.toMatchObject({ code: 'NOT_PENDING' });
  await expect(review(mod, penalty!.id, { approve: true })).rejects.toMatchObject({ code: 'NOT_PENDING' });

  // Bình vẫn khai được đủ 30 lần hôm nay dù đã có một mục trừ điểm tạo hôm nay.
  for (let i = 0; i < 30; i++) await submitReport(ctx, binh.id, { roleId: duck.id, value: 1, playedOn: PLAYED_ON });
  await expect(submitReport(ctx, binh.id, { roleId: duck.id, value: 1, playedOn: PLAYED_ON })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
});
