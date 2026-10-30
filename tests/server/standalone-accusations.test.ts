import type { Member, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { closeSeason, runSeasonJobs } from '../../src/server/modules/seasons/service.js';
import { getFactionTotals, getRoleLeaderboard } from '../../src/server/modules/stats/leaderboard.js';
import { listPendingReports, reviewReport, revokeReport, submitReport } from '../../src/server/modules/stats/reports.js';
import {
  MAX_ACCUSATIONS_PER_DAY,
  listMyStandaloneAccusations,
  listPendingStandaloneAccusations,
  listRecentlyApprovedStandaloneAccusations,
  reviewStandaloneAccusation,
  revokeStandaloneAccusation,
  submitStandaloneAccusation,
} from '../../src/server/modules/stats/standalone-accusations.js';
import type { StandaloneReviewDecision } from '../../src/server/modules/stats/standalone-accusations.js';
import type { StandaloneAccusationInputDto } from '../../src/shared/api-types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';

/** 12:00 ngày 10/10/2026 giờ VN: báo cáo được các trận từ 07/10 đến 10/10. */
const NOW = '2026-10-10T05:00:00Z';
const PLAYED_ON = '2026-10-10';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
/** Người gửi (An), người bị báo cáo (Bình), người bị bắn (Cường), người gửi thứ hai (Dũng). */
let an: Member;
let binh: Member;
let cuong: Member;
let dung: Member;
let mod: Member;
let admin: Member;
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
const row = (id: number) => testDb.playerAccusation.findUniqueOrThrow({ where: { id } });
const penaltyRows = () => testDb.statReport.findMany({ where: { source: 'accusation' }, orderBy: { id: 'asc' } });

/** Báo cáo mặc định: Bình (Dân phòng) bắn Cường — phe Ngỗng, ngày 10/10. */
const input = (o: Partial<StandaloneAccusationInputDto> = {}): StandaloneAccusationInputDto => ({
  playedOn: PLAYED_ON,
  accusedId: binh.id,
  accusedRoleId: vigilante.id,
  victimId: cuong.id,
  victimFaction: 'goose',
  ...o,
});
const send = (by: Member = an, o: Partial<StandaloneAccusationInputDto> = {}) => submitStandaloneAccusation(ctx, by.id, input(o));
const review = (by: Member, id: number, d: StandaloneReviewDecision) => reviewStandaloneAccusation(ctx, asReviewer(by), id, d);
const approve = (id: number, by: Member = mod) => review(by, id, { approve: true });
const allBoard = async (viewer: Member = an) =>
  (await getFactionTotals(ctx, '2026-10', viewer.id)).boards.all.top.map((r) => [r.displayName, r.points]);

// ---------------------------------------------------------------------------
// Gửi
// ---------------------------------------------------------------------------

test('a standalone accusation is stored without a report, with session and trimmed note, and listed under "my accusations"', async () => {
  const session = await createSession(testDb, { startsAt: new Date('2026-10-10T13:00:00Z') });
  const dto = await send(an, { sessionId: session.id, note: '  Clip ở phút 3  ' });
  expect(dto).toEqual({
    id: dto.id,
    status: 'pending',
    reporter: { id: an.id, displayName: 'An' },
    accused: { id: binh.id, displayName: 'Bình' },
    accusedRole: { id: vigilante.id, nameVi: 'Dân phòng', icon: vigilante.icon, faction: 'goose', penaltyPoints: 3 },
    victim: { id: cuong.id, displayName: 'Cường' },
    victimFaction: 'goose',
    playedOn: PLAYED_ON,
    session: { id: session.id, startsAt: '2026-10-10T13:00:00.000Z', modeName: expect.any(String) },
    note: 'Clip ở phút 3',
    rejectReason: null,
    duplicate: false,
    createdAt: new Date(NOW).toISOString(),
    reviewedBy: null,
    reviewedAt: null,
  });
  expect(await row(dto.id)).toMatchObject({ reportId: null, reporterId: an.id, playedOn: dateOnlyToDb(PLAYED_ON), sessionId: session.id });
  // Không tạo lần khai nào.
  expect(await testDb.statReport.count()).toBe(0);

  setNow('2026-10-10T05:01:00Z');
  const second = await send(an, { victimId: dung.id, victimFaction: 'duck', note: '   ' });
  expect(second).toMatchObject({ note: null, session: null });
  expect((await listMyStandaloneAccusations(ctx, an.id)).map((a) => a.id)).toEqual([second.id, dto.id]);
  expect(await listMyStandaloneAccusations(ctx, dung.id)).toEqual([]);
});

test('submit checks: active reporter, day window, open season, note, session, and the four accusation fields', async () => {
  const left = await createMember(testDb, { displayName: 'Đã rời', status: 'left' });
  await expect(send(left)).rejects.toMatchObject({ code: 'FORBIDDEN' });

  await expect(send(an, { playedOn: '10/10/2026' })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Ngày chơi không hợp lệ' });
  await expect(send(an, { playedOn: '2026-02-30' })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Ngày chơi không hợp lệ' });
  await expect(send(an, { playedOn: '2026-10-11' })).rejects.toMatchObject({ code: 'PLAYED_ON_OUT_OF_WINDOW' });
  await expect(send(an, { playedOn: '2026-10-06' })).rejects.toMatchObject({ code: 'PLAYED_ON_OUT_OF_WINDOW' });
  await expect(send(an, { playedOn: '2026-10-07' })).resolves.toMatchObject({ status: 'pending' });

  await expect(send(an, { note: 'x'.repeat(301) })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Ghi chú tối đa 300 ký tự' });

  const otherDay = await createSession(testDb, { startsAt: new Date('2026-10-09T13:00:00Z') });
  const cancelled = await createSession(testDb, { startsAt: new Date('2026-10-10T13:00:00Z'), status: 'cancelled' });
  await expect(send(an, { sessionId: 99_999 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Buổi chơi không hợp lệ' });
  await expect(send(an, { sessionId: cancelled.id })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Buổi chơi đã bị huỷ' });
  await expect(send(an, { sessionId: otherDay.id })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Buổi chơi không khớp ngày chơi' });

  const cases: [Partial<StandaloneAccusationInputDto> | Record<string, unknown>, string][] = [
    [{ victimFaction: undefined }, 'Báo cáo cần đủ người bị báo cáo, role, người bị bắn và phe'],
    [{ victimFaction: 'bird' as never }, 'Báo cáo cần đủ người bị báo cáo, role, người bị bắn và phe'],
    [{ accusedId: an.id }, 'Không thể tự báo cáo chính mình'],
    [{ victimId: binh.id }, 'Người bị bắn phải khác người bị báo cáo'],
    [{ accusedId: left.id }, 'Người bị báo cáo không còn trong server'],
    [{ accusedRoleId: duck.id }, 'Role bị báo cáo phải đang bật và có điểm trừ'],
    [{ victimId: left.id }, 'Người bị bắn không còn trong server'],
  ];
  for (const [o, message] of cases) {
    await expect(send(an, o as Partial<StandaloneAccusationInputDto>), message).rejects.toMatchObject({ code: 'VALIDATION', message });
  }
  // Thiếu hẳn một trường hay có trường lạ → sai dạng.
  const { victimId: _v, ...missing } = input();
  await expect(submitStandaloneAccusation(ctx, an.id, missing as StandaloneAccusationInputDto)).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(submitStandaloneAccusation(ctx, an.id, { ...input(), extra: 1 } as StandaloneAccusationInputDto)).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Dữ liệu không hợp lệ',
  });
  expect(await testDb.playerAccusation.count()).toBe(1);

  // Mùa đã chốt.
  setNow('2026-11-02T05:00:00Z');
  await closeSeason(ctx, '2026-10');
  await expect(send(an, { playedOn: '2026-10-31' })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
});

test('at most 10 accusations per reporter per VN day (by send time)', async () => {
  expect(MAX_ACCUSATIONS_PER_DAY).toBe(10);
  const victims = await Promise.all(Array.from({ length: 11 }, (_, i) => createMember(testDb, { displayName: `V${i}` })));
  for (let i = 0; i < 10; i++) await send(an, { victimId: victims[i]!.id });
  await expect(send(an, { victimId: victims[10]!.id })).rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'Bạn đã gửi quá 10 báo cáo hôm nay' });
  // Người khác không bị ảnh hưởng; sang ngày VN mới thì gửi tiếp được.
  await expect(send(dung, { victimId: victims[10]!.id })).resolves.toMatchObject({ status: 'pending' });
  setNow('2026-10-10T17:00:00Z'); // 00:00 ngày 11/10 giờ VN
  await expect(send(an, { victimId: victims[10]!.id })).resolves.toMatchObject({ status: 'pending' });
});

// ---------------------------------------------------------------------------
// Vụ và báo cáo trùng
// ---------------------------------------------------------------------------

test('the queue shows only the earliest pending accusation of a case; the duplicate waits, then comes up when the first is rejected', async () => {
  const first = await send(an);
  setNow('2026-10-10T05:01:00Z');
  const dup = await send(dung);
  expect(dup).toMatchObject({ status: 'pending', duplicate: true });
  const other = await send(dung, { victimId: an.id, victimFaction: 'duck' });

  expect((await listPendingStandaloneAccusations(ctx)).map((a) => a.id)).toEqual([first.id, other.id]);
  expect((await listMyStandaloneAccusations(ctx, dung.id)).find((a) => a.id === dup.id)).toMatchObject({ duplicate: true });
  expect((await listMyStandaloneAccusations(ctx, an.id))[0]).toMatchObject({ duplicate: false });

  await expect(approve(dup.id)).rejects.toMatchObject({
    code: 'NOT_PENDING',
    message: 'Báo cáo này trùng với báo cáo của An đang chờ — quyết báo cáo đó trước',
  });
  expect((await row(dup.id)).status).toBe('pending');

  await review(mod, first.id, { approve: false, reason: ' Clip không rõ ' });
  expect(await row(first.id)).toMatchObject({ status: 'rejected', rejectReason: 'Clip không rõ', reviewedById: mod.id });
  expect((await listPendingStandaloneAccusations(ctx)).map((a) => a.id)).toEqual([dup.id, other.id]);
  await approve(dup.id);
  expect((await row(dup.id)).status).toBe('approved');
  expect(await penaltyRows()).toHaveLength(1);
});

test('standalone and old attached accusations share a case: an attached earlier one blocks, and approving supersedes the rest', async () => {
  // Báo cáo cũ gắn lần khai (sớm hơn) của Dũng cùng vụ.
  const report = await submitReport(ctx, dung.id, { roleId: duck.id, value: 1, playedOn: PLAYED_ON });
  const attached = await testDb.playerAccusation.create({
    data: { reportId: report.id, reporterId: dung.id, accusedId: binh.id, accusedRoleId: vigilante.id, victimId: cuong.id, victimFaction: 'goose', playedOn: report.playedOn, createdAt: ctx.now() },
  });
  setNow('2026-10-10T05:01:00Z');
  const mine = await send(an);
  expect(mine.duplicate).toBe(true);
  expect(await listPendingStandaloneAccusations(ctx)).toEqual([]);
  await expect(approve(mine.id)).rejects.toMatchObject({ code: 'NOT_PENDING', message: expect.stringContaining('Dũng') });

  // Báo cáo cũ bị bác qua lần khai → báo cáo độc lập hiện lên; duyệt → vụ bị trừ điểm.
  await reviewReport(ctx, asReviewer(mod), report.id, { approve: true, accusation: 'reject', reason: 'Không rõ' });
  expect((await listPendingStandaloneAccusations(ctx)).map((a) => a.id)).toEqual([mine.id]);

  // Một báo cáo gắn lần khai của vụ khác (người bị bắn khác), còn chờ.
  setNow('2026-10-10T05:02:00Z');
  const later = await submitReport(ctx, cuong.id, { roleId: duck.id, value: 1, playedOn: PLAYED_ON });
  const laterAcc = await testDb.playerAccusation.create({
    data: { reportId: later.id, reporterId: cuong.id, accusedId: binh.id, accusedRoleId: vigilante.id, victimId: dung.id, victimFaction: 'goose', playedOn: later.playedOn, createdAt: ctx.now() },
  });
  await approve(mine.id);
  expect((await row(attached.id)).status).toBe('rejected');
  // Vụ khác (người bị bắn khác) không bị đụng.
  expect((await row(laterAcc.id)).status).toBe('pending');
  expect((await listPendingReports(ctx)).find((r) => r.id === later.id)?.accusation).toMatchObject({ id: laterAcc.id });
});

test('approving supersedes other pending accusations of the case; later ones for a penalised case are stored superseded', async () => {
  const first = await send(an);
  setNow('2026-10-10T05:01:00Z');
  const dup = await send(dung);
  // Báo cáo cũ gắn lần khai cùng vụ, còn chờ (lần khai của nó vẫn chờ duyệt).
  const report = await submitReport(ctx, cuong.id, { roleId: duck.id, value: 1, playedOn: PLAYED_ON });
  const attached = await testDb.playerAccusation.create({
    data: { reportId: report.id, reporterId: cuong.id, accusedId: binh.id, accusedRoleId: vigilante.id, victimId: cuong.id, victimFaction: 'goose', playedOn: report.playedOn, createdAt: ctx.now() },
  });

  await approve(first.id);
  expect(await row(dup.id)).toMatchObject({ status: 'superseded', rejectReason: 'Đã có người báo cáo trước', reviewedById: mod.id });
  expect((await row(attached.id)).status).toBe('superseded');
  expect((await testDb.statReport.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('pending');

  setNow('2026-10-10T06:00:00Z');
  const late = await send(cuong, { victimId: dung.id });
  expect(late.status).toBe('pending'); // vụ khác
  const lateSame = await send(await createMember(testDb, { displayName: 'Giang' }));
  expect(lateSame).toMatchObject({ status: 'superseded', rejectReason: 'Đã có người báo cáo trước', duplicate: false });
  expect((await listPendingStandaloneAccusations(ctx)).map((a) => a.id)).toEqual([late.id]);
});

// ---------------------------------------------------------------------------
// Duyệt / từ chối
// ---------------------------------------------------------------------------

test('approve: penalty row for the accused, DM, holder re-checked; reporter +1 only in the "all" totals board', async () => {
  // Bình đang hoá thân Dân phòng (5 điểm, duyệt trước), Em cũng 5 điểm nhưng duyệt sau.
  const em = await createMember(testDb, { displayName: 'Em' });
  const own = await submitReport(ctx, binh.id, { roleId: vigilante.id, value: 1, playedOn: '2026-10-09' });
  await reviewReport(ctx, asReviewer(mod), own.id, { approve: true });
  setNow('2026-10-10T05:00:30Z');
  const emReport = await submitReport(ctx, em.id, { roleId: vigilante.id, value: 1, playedOn: '2026-10-09' });
  await reviewReport(ctx, asReviewer(mod), emReport.id, { approve: true });
  notifier.announcements.length = 0;

  setNow('2026-10-10T05:01:00Z');
  const a = await send(an);
  setNow('2026-10-10T06:00:00Z');
  await approve(a.id);

  const [penalty] = await penaltyRows();
  expect(penalty).toMatchObject({
    memberId: binh.id,
    roleId: vigilante.id,
    playedOn: dateOnlyToDb(PLAYED_ON),
    value: 0,
    penaltyValue: 1,
    bonusPoints: 0,
    source: 'accusation',
    status: 'approved',
    reviewedById: mod.id,
    reviewedAt: new Date('2026-10-10T06:00:00Z'),
    note: 'Bị báo cáo: bắn Cường (phe Ngỗng)',
  });
  expect(await row(a.id)).toMatchObject({ status: 'approved', penaltyReportId: penalty!.id, reviewedById: mod.id });
  expect(notifier.dms).toEqual([{ discordId: binh.discordId, text: 'Bạn bị trừ 3 điểm (Dân phòng) ngày 10/10: bị báo cáo bắn Cường (phe Ngỗng).' }]);
  expect(notifier.announcements).toEqual(['👑 Em đã hoá thân Dân phòng mùa 2026-10!']);

  // +1 cho An chỉ ở "Cả 3 phe"; không vào bảng phe hay bảng role.
  const totals = await getFactionTotals(ctx, '2026-10', an.id);
  expect(totals.boards.all.me).toMatchObject({ displayName: 'An', points: 1 });
  expect(totals.boards.goose.me).toBeNull();
  expect(totals.boards.duck.me).toBeNull();
  expect(await allBoard()).toEqual([
    ['Em', 5],
    ['Bình', 2],
    ['An', 1],
  ]);
  expect((await getRoleLeaderboard(ctx, vigilante.id, '2026-10')).map((r) => r.displayName)).toEqual(['Em', 'Bình']);

  // Không duyệt lại được.
  await expect(approve(a.id)).rejects.toMatchObject({ code: 'NOT_PENDING', message: 'Báo cáo này đã được xử lý' });
  // Có trong "Đã duyệt gần đây" kèm người duyệt; người gửi không thấy người duyệt.
  expect(await listRecentlyApprovedStandaloneAccusations(ctx)).toEqual([
    expect.objectContaining({ id: a.id, status: 'approved', reviewedBy: { id: mod.id, displayName: 'Mod' }, reviewedAt: '2026-10-10T06:00:00.000Z' }),
  ]);
  expect((await listMyStandaloneAccusations(ctx, an.id))[0]).toMatchObject({ status: 'approved', reviewedBy: null, reviewedAt: null });
});

test('reject needs a reason and DMs the reporter; permissions: member forbidden, mod involved = SELF_REVIEW, admin allowed', async () => {
  const a = await send(an);
  await expect(review(an, a.id, { approve: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(review(mod, a.id, { approve: false, reason: '  ' })).rejects.toMatchObject({ code: 'REASON_REQUIRED', message: 'Cần ghi lý do từ chối' });
  await expect(review(mod, 99_999, { approve: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });

  await review(mod, a.id, { approve: false, reason: 'Không có clip' });
  expect(notifier.dms).toEqual([{ discordId: an.discordId, text: 'Báo cáo Bình (Dân phòng) bắn Cường (phe Ngỗng) ngày 10/10 bị bác: Không có clip' }]);
  await expect(review(mod, a.id, { approve: false, reason: 'x' })).rejects.toMatchObject({ code: 'NOT_PENDING' });

  // Mod là người gửi, hoặc người bị báo cáo.
  const byMod = await send(mod, { victimId: dung.id });
  const againstMod = await send(an, { accusedId: mod.id });
  for (const id of [byMod.id, againstMod.id]) {
    await expect(approve(id)).rejects.toMatchObject({ code: 'SELF_REVIEW', message: 'Mod không được duyệt báo cáo mà mình là người gửi hoặc người bị báo cáo' });
    await expect(review(mod, id, { approve: false, reason: 'x' })).rejects.toMatchObject({ code: 'SELF_REVIEW' });
  }
  await approve(againstMod.id, admin);
  expect((await row(againstMod.id)).status).toBe('approved');

  // Báo cáo cũ gắn lần khai không quyết qua đây.
  const report = await submitReport(ctx, dung.id, { roleId: duck.id, value: 1, playedOn: PLAYED_ON });
  const attached = await testDb.playerAccusation.create({
    data: { reportId: report.id, reporterId: dung.id, accusedId: cuong.id, accusedRoleId: vigilante.id, victimId: an.id, victimFaction: 'goose', playedOn: report.playedOn },
  });
  await expect(approve(attached.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('two mods approving duplicates at once: the accused is penalised once', async () => {
  const first = await send(an);
  setNow('2026-10-10T05:01:00Z');
  const dup = await send(dung);
  const mod2 = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod 2' });
  const [x, y] = await Promise.allSettled([approve(first.id), approve(dup.id, mod2)]);
  expect(x.status).toBe('fulfilled');
  expect(y.status).toBe('rejected');
  expect(await penaltyRows()).toHaveLength(1);
  expect((await row(dup.id)).status).toBe('superseded');
});

// ---------------------------------------------------------------------------
// Huỷ duyệt
// ---------------------------------------------------------------------------

test('revoke: accusation and its penalty row revoked together, DMs both, +1 gone; rules and re-revoke', async () => {
  const a = await send(an);
  await approve(a.id);
  const [penalty] = await penaltyRows();
  notifier.dms.length = 0;

  await expect(revokeStandaloneAccusation(ctx, asReviewer(mod), a.id, ' ')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  await expect(revokeStandaloneAccusation(ctx, asReviewer(an), a.id, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' });

  setNow('2026-10-11T03:00:00Z');
  await revokeStandaloneAccusation(ctx, asReviewer(mod), a.id, 'Nhầm người');
  expect(await row(a.id)).toMatchObject({
    status: 'revoked',
    rejectReason: 'Nhầm người',
    revokedById: mod.id,
    revokedAt: new Date('2026-10-11T03:00:00Z'),
    reviewedById: mod.id,
  });
  expect(await testDb.statReport.findUniqueOrThrow({ where: { id: penalty!.id } })).toMatchObject({ status: 'revoked', rejectReason: 'Nhầm người', revokedById: mod.id });
  expect(notifier.dms).toEqual([
    { discordId: an.discordId, text: 'Báo cáo Bình (Dân phòng) bắn Cường (phe Ngỗng) ngày 10/10 đã bị huỷ: Nhầm người' },
    { discordId: binh.discordId, text: 'Mục trừ điểm (Dân phòng) ngày 10/10 do bị báo cáo bắn Cường (phe Ngỗng) đã được gỡ: Nhầm người' },
  ]);
  expect(await allBoard()).toEqual([]);
  expect(await listRecentlyApprovedStandaloneAccusations(ctx)).toEqual([]);
  expect((await listMyStandaloneAccusations(ctx, an.id))[0]).toMatchObject({ status: 'revoked', rejectReason: 'Nhầm người' });

  await expect(revokeStandaloneAccusation(ctx, asReviewer(mod), a.id, 'x')).rejects.toMatchObject({ code: 'NOT_APPROVED' });

  // Vụ mở lại: báo cáo mới của vụ vào hàng chờ.
  const again = await send(dung);
  expect(again.status).toBe('pending');
  expect((await listPendingStandaloneAccusations(ctx)).map((x) => x.id)).toEqual([again.id]);
});

test('revoking the penalty row on its own (Đã duyệt gần đây) revokes the standalone accusation too; mod involved cannot', async () => {
  const a = await send(an);
  await approve(a.id);
  const [penalty] = await penaltyRows();
  notifier.dms.length = 0;

  await revokeReport(ctx, asReviewer(mod), penalty!.id, 'Sai role');
  expect(await row(a.id)).toMatchObject({ status: 'revoked', rejectReason: 'Sai role', revokedById: mod.id });
  expect(notifier.dms).toEqual([
    { discordId: binh.discordId, text: 'Mục trừ điểm (Dân phòng) ngày 10/10 do bị báo cáo bắn Cường (phe Ngỗng) đã được gỡ: Sai role' },
    { discordId: an.discordId, text: 'Báo cáo của bạn (Dân phòng, bắn Cường) ngày 10/10 đã bị huỷ: Sai role' },
  ]);
  expect(await allBoard()).toEqual([]);

  // Mod là người gửi: không huỷ được báo cáo (cả qua mục trừ điểm); admin thì được.
  const byMod = await send(mod, { victimId: dung.id });
  await approve(byMod.id, admin);
  const modPenalty = (await penaltyRows()).at(-1)!;
  await expect(revokeReport(ctx, asReviewer(mod), modPenalty.id, 'x')).rejects.toMatchObject({ code: 'SELF_REVIEW' });
  await expect(revokeStandaloneAccusation(ctx, asReviewer(mod), byMod.id, 'x')).rejects.toMatchObject({ code: 'SELF_REVIEW' });
  await revokeStandaloneAccusation(ctx, asReviewer(admin), byMod.id, 'x');
  expect((await row(byMod.id)).status).toBe('revoked');
});

test('an old attached accusation keeps scoring through bonusPoints, never twice in the totals', async () => {
  const report = await submitReport(ctx, an.id, { roleId: duck.id, value: 2, playedOn: PLAYED_ON });
  await testDb.playerAccusation.create({
    data: { reportId: report.id, reporterId: an.id, accusedId: binh.id, accusedRoleId: vigilante.id, victimId: cuong.id, victimFaction: 'goose', playedOn: report.playedOn, createdAt: ctx.now() },
  });
  await reviewReport(ctx, asReviewer(mod), report.id, { approve: true, accusation: 'approve' });
  // Vịt 2 mạng (điểm của role) + 1 bonus — không cộng thêm +1 kiểu độc lập.
  const duckPoints = (await getRoleLeaderboard(ctx, duck.id, '2026-10'))[0]!.score;
  expect((await getFactionTotals(ctx, '2026-10', an.id)).boards.all.me?.points).toBe(duckPoints);
  expect(await listMyStandaloneAccusations(ctx, an.id)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Chốt mùa, nhắc mod
// ---------------------------------------------------------------------------

test('closing the season rejects pending standalone accusations of that season; approved ones keep their +1', async () => {
  const pending = await send(an);
  const done = await send(dung, { victimId: an.id, victimFaction: 'duck' });
  await approve(done.id);
  // Báo cáo của mùa sau không bị đụng.
  setNow('2026-11-01T05:00:00Z');
  const next = await send(an, { playedOn: '2026-11-01' });

  await closeSeason(ctx, '2026-10');
  expect(await row(pending.id)).toMatchObject({ status: 'rejected', rejectReason: 'Mùa đã chốt', reviewedById: null });
  expect((await row(done.id)).status).toBe('approved');
  expect((await row(next.id)).status).toBe('pending');
  expect((await getFactionTotals(ctx, '2026-10', dung.id)).boards.all.me?.points).toBe(1);
  await expect(approve(pending.id)).rejects.toMatchObject({ code: 'NOT_PENDING' });
  await expect(revokeStandaloneAccusation(ctx, asReviewer(mod), done.id, 'x')).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
});

test('the day-3 nudge counts pending standalone accusations too', async () => {
  await send(an);
  await testDb.season.upsert({ where: { id: '2026-10' }, create: { id: '2026-10', startsAt: new Date('2026-09-30T17:00:00Z'), endsAt: new Date('2026-10-31T17:00:00Z') }, update: {} });
  setNow('2026-11-03T02:00:00Z'); // 09:00 ngày 03/11 giờ VN
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual(['📝 Mod ơi, còn 1 báo cáo người chơi của mùa 10/2026 chờ duyệt. Hạn chót 00:05 ngày 4.']);
});
