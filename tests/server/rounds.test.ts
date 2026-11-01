import type { GameSession, Member, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import {
  createRound,
  deleteRound,
  getRoundImage,
  listSessionRounds,
  replaceRoundImage,
  updateRound,
} from '../../src/server/modules/rounds/service.js';
import { ensureSeason } from '../../src/server/modules/seasons/service.js';
import {
  getFactionTop,
  getFactionTotals,
  getRoleLeader,
  getRoleLeaderboard,
} from '../../src/server/modules/stats/leaderboard.js';
import { listMyReports, reviewReport } from '../../src/server/modules/stats/reports.js';
import { ROUND_SCORING_FROM, isRoundSeason, roundReportPoints, roundWon } from '../../src/shared/rounds.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';

/** 12:00 ngày 05/11/2026 giờ VN. */
const NOW = '2026-11-05T05:00:00Z';
/** Buổi 21:00 ngày 05/11/2026 giờ VN. */
const SESSION_AT = '2026-11-05T14:00:00Z';
const PLAYED_ON = '2026-11-05';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpg-body')]);

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let mod: Member;
let a: Member; // An
let b: Member; // Bình
let session: GameSession;
let goose: Role;
let duck: Role;
let pelican: Role;
let vigilante: Role;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  setNow(NOW);
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  a = await createMember(testDb, { displayName: 'An' });
  b = await createMember(testDb, { displayName: 'Bình' });
  session = await createSession(testDb, { startsAt: new Date(SESSION_AT), createdById: mod.id });
  goose = await roleByKey(testDb, 'goose');
  duck = await roleByKey(testDb, 'duck');
  pelican = await roleByKey(testDb, 'pelican');
  vigilante = await roleByKey(testDb, 'vigilante'); // 5 điểm mỗi phát trúng, bắn sai −3
});
afterEach(() => vi.restoreAllMocks());

const modR = () => ({ id: mod.id, accessLevel: mod.accessLevel });

/** Ván mới qua service (ảnh PNG), phe thắng tuỳ chọn; trả về id. */
async function round(winner: 'goose' | 'duck' | 'neutral' | null = null): Promise<number> {
  return (await createRound(ctx, mod.id, session.id, PNG, winner)).id;
}

type RoundReport = { memberId: number; roleId: number; roundId: number; value?: number; penaltyValue?: number; status?: 'pending' | 'approved' | 'rejected'; playedOn?: string };

/** Lần khai theo ván ghi thẳng vào DB (luồng khai là Task 3); mặc định đã duyệt. */
async function roundReport(o: RoundReport): Promise<number> {
  const status = o.status ?? 'approved';
  const r = await testDb.statReport.create({
    data: {
      memberId: o.memberId,
      roleId: o.roleId,
      roundId: o.roundId,
      sessionId: session.id,
      playedOn: dateOnlyToDb(o.playedOn ?? PLAYED_ON),
      value: o.value ?? 0,
      penaltyValue: o.penaltyValue ?? 0,
      status,
      createdAt: ctx.now(),
      ...(status === 'pending' ? {} : { reviewedById: mod.id, reviewedAt: ctx.now() }),
      ...(status === 'rejected' ? { rejectReason: 'sai' } : {}),
    },
  });
  return r.id;
}

/** Lần khai theo ngày (không ván), đã duyệt. */
async function dayReport(memberId: number, roleId: number, value: number, playedOn: string): Promise<void> {
  await testDb.statReport.create({
    data: { memberId, roleId, playedOn: dateOnlyToDb(playedOn), value, status: 'approved', reviewedById: mod.id, reviewedAt: ctx.now() },
  });
}

const scoreOf = async (roleId: number, memberId: number, seasonId = '2026-11') =>
  (await getRoleLeaderboard(ctx, roleId, seasonId)).find((r) => r.memberId === memberId)?.score ?? null;

// ---------------------------------------------------------------------------
// Hàm dùng chung
// ---------------------------------------------------------------------------

test('roundWon / roundReportPoints / mùa luật ván', () => {
  expect(ROUND_SCORING_FROM).toBe('2026-11');
  expect(isRoundSeason('2026-10')).toBe(false);
  expect(isRoundSeason('2026-11')).toBe(true);
  expect(isRoundSeason('2027-01')).toBe(true);
  expect(roundWon('duck', 'duck', false)).toBe(true);
  expect(roundWon('goose', 'duck', false)).toBe(false);
  expect(roundWon('duck', null, false)).toBe(false);
  expect(roundWon('neutral', 'neutral', false)).toBe(false);
  expect(roundWon('neutral', 'neutral', true)).toBe(true);
  const role = { metricLabel: 'x', points: 5, extraMetricLabel: null, extraPoints: null, penaltyMetricLabel: 'y', penaltyMaxPerGame: 1, penaltyPoints: 3 };
  const r = { value: 2, extraValue: 0, penaltyValue: 1, bonusPoints: 1 };
  expect(roundReportPoints(r, role, 1, true)).toBe(1 + 10 - 3 + 1);
  expect(roundReportPoints(r, role, 2, true)).toBe(1 + 20 - 3 + 1);
  expect(roundReportPoints(r, role, 2, false)).toBe(-3 + 1);
});

// ---------------------------------------------------------------------------
// Điểm
// ---------------------------------------------------------------------------

test('thắng được +1 + chỉ số, thua và chưa chọn phe thắng được 0; games đếm ván', async () => {
  const r1 = await round('duck');
  const r2 = await round('goose');
  const r3 = await round(null);
  await roundReport({ memberId: a.id, roleId: duck.id, roundId: r1, value: 3 });
  await roundReport({ memberId: a.id, roleId: duck.id, roundId: r2, value: 2 });
  await roundReport({ memberId: a.id, roleId: duck.id, roundId: r3, value: 5 });
  const [row] = await getRoleLeaderboard(ctx, duck.id, '2026-11');
  expect(row).toMatchObject({ memberId: a.id, score: 1 + 3, games: 3 });
});

test('thua vẫn bị trừ điểm phạt; thắng thì cộng rồi trừ', async () => {
  const lost = await round('duck');
  const won = await round('goose');
  await roundReport({ memberId: a.id, roleId: vigilante.id, roundId: lost, value: 1, penaltyValue: 1 });
  await roundReport({ memberId: b.id, roleId: vigilante.id, roundId: won, value: 1, penaltyValue: 1 });
  // An chỉ có điểm âm → không lên bảng role; Tổng điểm phe Ngỗng cũng không (tổng ≤ 0).
  expect(await scoreOf(vigilante.id, a.id)).toBeNull();
  expect(await scoreOf(vigilante.id, b.id)).toBe(1 + 5 - 3);
  const totals = await getFactionTotals(ctx, '2026-11', a.id);
  expect(totals.boards.goose.top.map((t) => [t.memberId, t.points])).toEqual([[b.id, 3]]);
  // Âm của An kéo tổng "Cả 3 phe" khi An có điểm khác.
  const r3 = await round('goose');
  await roundReport({ memberId: a.id, roleId: goose.id, roundId: r3, value: 5 });
  const all = (await getFactionTotals(ctx, '2026-11', a.id)).boards.all.me;
  expect(all?.points).toBe(1 + 5 - 3);
});

test('Phe thứ 3 thắng: chỉ người được tick được cộng; chưa tick ai → không ai được', async () => {
  const r1 = await round('neutral');
  await roundReport({ memberId: a.id, roleId: pelican.id, roundId: r1, value: 2 });
  await roundReport({ memberId: b.id, roleId: pelican.id, roundId: r1, value: 4 });
  await roundReport({ memberId: mod.id, roleId: goose.id, roundId: r1, value: 1 });
  expect(await getRoleLeaderboard(ctx, pelican.id, '2026-11')).toEqual([]);

  await updateRound(ctx, mod.id, r1, { winnerIds: [a.id] });
  const rows = await getRoleLeaderboard(ctx, pelican.id, '2026-11');
  expect(rows.map((r) => [r.memberId, r.score])).toEqual([[a.id, 1 + 2]]);
  expect(await getRoleLeaderboard(ctx, goose.id, '2026-11')).toEqual([]);
  const top = await getFactionTop(ctx, '2026-11');
  expect(top.factions.neutral.map((r) => r.memberId)).toEqual([a.id]);
});

test('ngày nhân điểm nhân phần chỉ số của lần khai thắng, không nhân +1 hay điểm phạt', async () => {
  await testDb.scoreMultiplierDay.create({ data: { day: dateOnlyToDb(PLAYED_ON), multiplier: 2, createdById: mod.id } });
  const r1 = await round('goose');
  await roundReport({ memberId: a.id, roleId: vigilante.id, roundId: r1, value: 2, penaltyValue: 1 });
  expect(await scoreOf(vigilante.id, a.id)).toBe(1 + 2 * 5 * 2 - 3);
  const [dto] = await listMyReports(ctx, a.id);
  expect(dto).toMatchObject({ multiplier: 2, points: 1 + 20 - 3, round: { id: r1, number: 1, sessionId: session.id, winnerFaction: 'goose', won: true } });
});

test('mùa 10 (không có ván) giữ nguyên điểm; lần khai theo ngày và theo ván cùng ô cộng đúng', async () => {
  await dayReport(a.id, duck.id, 4, '2026-10-20');
  expect(await scoreOf(duck.id, a.id, '2026-10')).toBe(4);
  const before = await getFactionTotals(ctx, '2026-10', a.id);

  // Ô hỗn hợp trong mùa 11: một lần theo ngày (công thức cũ) + một ván thắng + một ván thua.
  await dayReport(a.id, duck.id, 2, '2026-11-02');
  const won = await round('duck');
  const lost = await round('goose');
  await roundReport({ memberId: a.id, roleId: duck.id, roundId: won, value: 3 });
  await roundReport({ memberId: a.id, roleId: duck.id, roundId: lost, value: 7 });
  const [row] = await getRoleLeaderboard(ctx, duck.id, '2026-11');
  expect(row).toMatchObject({ score: 2 + (1 + 3), games: 3 });

  expect(await scoreOf(duck.id, a.id, '2026-10')).toBe(4);
  expect(await getFactionTotals(ctx, '2026-10', a.id)).toEqual(before);
});

test('lần khai chờ duyệt/bị từ chối không tính; ReportDto.round của lần khai theo ngày là null', async () => {
  const r1 = await round('duck');
  await roundReport({ memberId: a.id, roleId: duck.id, roundId: r1, value: 3, status: 'pending' });
  await roundReport({ memberId: b.id, roleId: duck.id, roundId: r1, value: 3, status: 'rejected' });
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-11')).toEqual([]);
  await dayReport(a.id, duck.id, 1, '2026-10-20');
  const mine = await listMyReports(ctx, a.id);
  expect(mine.map((d) => d.round?.id ?? null).sort()).toEqual([r1, null].sort());
  const pending = mine.find((d) => d.round !== null);
  expect(pending).toMatchObject({ points: 1 + 3, round: { won: true } });
});

test('đổi phe thắng sau khi đã duyệt → bảng và hoá thân đổi, thông báo không lặp', async () => {
  const r1 = await round('duck');
  // An: Vịt 2 ở ván thắng → 3 điểm. Bình: Vịt 1 ở ván 2 (Ngỗng thắng) → 0.
  const pendingId = await roundReport({ memberId: a.id, roleId: duck.id, roundId: r1, value: 2, status: 'pending' });
  await reviewReport(ctx, modR(), pendingId, { approve: true });
  const r2 = await round('goose');
  await roundReport({ memberId: b.id, roleId: duck.id, roundId: r2, value: 1 });
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Vịt mùa 2026-11!']);
  expect((await getRoleLeader(ctx, duck.id, '2026-11'))?.memberId).toBe(a.id);

  // Ván 1 đổi sang Ngỗng thắng, ván 2 sang Vịt thắng → Bình hoá thân.
  await updateRound(ctx, mod.id, r1, { winnerFaction: 'goose' });
  expect(await getRoleLeaderboard(ctx, duck.id, '2026-11')).toEqual([]);
  expect(notifier.announcements).toHaveLength(1);
  await updateRound(ctx, mod.id, r2, { winnerFaction: 'duck' });
  expect((await getRoleLeader(ctx, duck.id, '2026-11'))?.memberId).toBe(b.id);
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Vịt mùa 2026-11!', '👑 Bình đã hoá thân Vịt mùa 2026-11!']);

  // Gửi lại cùng phe thắng → không đổi người → không đăng thêm.
  await updateRound(ctx, mod.id, r2, { winnerFaction: 'duck' });
  expect(notifier.announcements).toHaveLength(2);
  const [dto] = await listMyReports(ctx, a.id);
  expect(dto).toMatchObject({ points: 0, round: { winnerFaction: 'goose', won: false } });
});

test('một ván nhiều role: mỗi role đổi người hoá thân đăng đúng một lần', async () => {
  const r1 = await round(null);
  await roundReport({ memberId: a.id, roleId: duck.id, roundId: r1, value: 1 });
  await roundReport({ memberId: b.id, roleId: duck.id, roundId: r1, value: 2 });
  await roundReport({ memberId: mod.id, roleId: goose.id, roundId: r1, value: 1 });
  await updateRound(ctx, mod.id, r1, { winnerFaction: 'duck' });
  expect(notifier.announcements).toEqual(['👑 Bình đã hoá thân Vịt mùa 2026-11!']);
  await updateRound(ctx, mod.id, r1, { winnerFaction: 'goose' });
  expect(notifier.announcements).toEqual(['👑 Bình đã hoá thân Vịt mùa 2026-11!', '👑 Mod đã hoá thân Ngỗng mùa 2026-11!']);
});

// ---------------------------------------------------------------------------
// Sửa phe thắng / người thắng
// ---------------------------------------------------------------------------

test('người thắng phải là người đã khai role Phe thứ 3 ở ván (pending/approved); đổi phe khác xoá danh sách', async () => {
  const r1 = await round('neutral');
  await roundReport({ memberId: a.id, roleId: pelican.id, roundId: r1, value: 1, status: 'pending' });
  await roundReport({ memberId: b.id, roleId: goose.id, roundId: r1, value: 1 });
  await roundReport({ memberId: mod.id, roleId: pelican.id, roundId: r1, value: 1, status: 'rejected' });

  await expect(updateRound(ctx, mod.id, r1, { winnerIds: [b.id] })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Người thắng phải là người đã khai role Phe thứ 3 ở ván này',
  });
  await expect(updateRound(ctx, mod.id, r1, { winnerIds: [mod.id] })).rejects.toMatchObject({ code: 'VALIDATION' });
  const ok = await updateRound(ctx, mod.id, r1, { winnerIds: [a.id, a.id] });
  expect(ok.winnerIds).toEqual([a.id]);
  // Không gửi winnerIds khi vẫn neutral → giữ.
  expect((await updateRound(ctx, mod.id, r1, { winnerFaction: 'neutral' })).winnerIds).toEqual([a.id]);

  await expect(updateRound(ctx, mod.id, r1, { winnerFaction: 'duck', winnerIds: [a.id] })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Chỉ chọn người thắng khi Phe thứ 3 thắng',
  });
  const duckWon = await updateRound(ctx, mod.id, r1, { winnerFaction: 'duck' });
  expect(duckWon).toMatchObject({ winnerFaction: 'duck', winnerIds: [] });
  expect(await testDb.gameRoundWinner.count()).toBe(0);
  // Về neutral: danh sách cũ đã xoá, không tự quay lại.
  expect((await updateRound(ctx, mod.id, r1, { winnerFaction: 'neutral' })).winnerIds).toEqual([]);
  expect((await updateRound(ctx, mod.id, r1, { winnerFaction: null })).winnerFaction).toBeNull();
});

test('sửa ván: dữ liệu sai, ván không có, mùa đã chốt', async () => {
  const r1 = await round();
  await expect(updateRound(ctx, mod.id, r1, { winnerFaction: 'chicken' })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateRound(ctx, mod.id, r1, { extra: 1 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateRound(ctx, mod.id, 999, { winnerFaction: 'duck' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await ensureSeason(ctx, '2026-11');
  await testDb.season.update({ where: { id: '2026-11' }, data: { closedAt: ctx.now() } });
  await expect(updateRound(ctx, mod.id, r1, { winnerFaction: 'duck' })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
});

// ---------------------------------------------------------------------------
// Thêm / đổi ảnh / xoá
// ---------------------------------------------------------------------------

test('thêm ván: số tiếp theo; xoá ván cuối không cấp lại số; xoá ván giữa giữ số', async () => {
  const one = await createRound(ctx, mod.id, session.id, PNG, 'duck');
  expect(one).toMatchObject({ number: 1, sessionId: session.id, winnerFaction: 'duck', winnerIds: [], reports: [] });
  expect(one.imageUrl).toBe(`/api/rounds/${one.id}/image?v=${new Date(NOW).getTime()}`);
  const two = await createRound(ctx, mod.id, session.id, JPG, null);
  const three = await createRound(ctx, mod.id, session.id, PNG, null);
  expect([two.number, three.number]).toEqual([2, 3]);
  await deleteRound(ctx, three.id);
  expect((await createRound(ctx, mod.id, session.id, PNG, null)).number).toBe(4);
  await deleteRound(ctx, two.id);
  const list = await listSessionRounds(ctx, session.id, a.id);
  expect(list.rounds.map((r) => r.number)).toEqual([1, 4]);
  // Buổi khác đánh số riêng.
  const other = await createSession(testDb, { startsAt: new Date(SESSION_AT), createdById: mod.id });
  expect((await createRound(ctx, mod.id, other.id, PNG, null)).number).toBe(1);
});

test('thêm ván cùng lúc không trùng số', async () => {
  const made = await Promise.all(Array.from({ length: 5 }, () => createRound(ctx, mod.id, session.id, PNG, null)));
  expect(made.map((r) => r.number).sort()).toEqual([1, 2, 3, 4, 5]);
});

test('thêm ván: ảnh sai loại / quá lớn, buổi huỷ, buổi không có', async () => {
  const gif = Buffer.from('GIF89a-not-allowed');
  await expect(createRound(ctx, mod.id, session.id, gif, null)).rejects.toMatchObject({ code: 'INVALID_IMAGE', message: 'Chỉ nhận ảnh PNG, JPG hoặc WebP' });
  await expect(createRound(ctx, mod.id, session.id, Buffer.alloc(0), null)).rejects.toMatchObject({ message: 'Chỉ nhận ảnh PNG, JPG hoặc WebP' });
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  await expect(createRound(ctx, mod.id, session.id, big, null)).rejects.toMatchObject({ code: 'INVALID_IMAGE', message: 'Ảnh tối đa 5 MB' });
  const exact = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length)]);
  expect((await createRound(ctx, mod.id, session.id, exact, null)).number).toBe(1);

  await expect(createRound(ctx, mod.id, 999, PNG, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await testDb.gameSession.update({ where: { id: session.id }, data: { status: 'cancelled' } });
  await expect(createRound(ctx, mod.id, session.id, PNG, null)).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN', message: 'Buổi chơi đã bị huỷ' });
  expect(await testDb.gameRound.count()).toBe(1);
});

test('đổi ảnh: thay nội dung, mime và mốc đổi ảnh', async () => {
  const r1 = await round();
  setNow('2026-11-05T06:00:00Z');
  const dto = await replaceRoundImage(ctx, mod.id, r1, JPG);
  expect(dto.imageUpdatedAt).toBe('2026-11-05T06:00:00.000Z');
  const img = await getRoundImage(ctx, r1);
  expect(img?.mime).toBe('image/jpeg');
  expect(img?.buf.equals(JPG)).toBe(true);
  await expect(replaceRoundImage(ctx, mod.id, r1, Buffer.from('nope'))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  await expect(replaceRoundImage(ctx, mod.id, 999, PNG)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('xoá ván: chặn khi có lần khai chờ duyệt/đã duyệt; lần khai bị từ chối được gỡ khỏi ván', async () => {
  const r1 = await round('neutral');
  const pending = await roundReport({ memberId: a.id, roleId: pelican.id, roundId: r1, status: 'pending' });
  const rejected = await roundReport({ memberId: b.id, roleId: duck.id, roundId: r1, status: 'rejected' });
  await updateRound(ctx, mod.id, r1, { winnerIds: [a.id] });
  await expect(deleteRound(ctx, r1)).rejects.toMatchObject({ code: 'ROUND_HAS_REPORTS', message: 'Ván đã có lần khai — không xoá được' });

  await testDb.statReport.update({ where: { id: pending }, data: { status: 'rejected', rejectReason: 'sai', reviewedById: mod.id, reviewedAt: ctx.now() } });
  await deleteRound(ctx, r1);
  expect(await testDb.gameRound.count()).toBe(0);
  expect(await testDb.gameRoundWinner.count()).toBe(0);
  expect((await testDb.statReport.findUniqueOrThrow({ where: { id: rejected } })).roundId).toBeNull();
  await expect(deleteRound(ctx, r1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('UNIQUE một phần: một lần khai còn hiệu lực mỗi (ván, người)', async () => {
  const r1 = await round();
  await roundReport({ memberId: a.id, roleId: duck.id, roundId: r1, status: 'rejected' });
  await roundReport({ memberId: a.id, roleId: duck.id, roundId: r1, status: 'pending' });
  await expect(roundReport({ memberId: a.id, roleId: goose.id, roundId: r1, status: 'approved' })).rejects.toMatchObject({ code: 'P2002' });
});

// ---------------------------------------------------------------------------
// Trang buổi
// ---------------------------------------------------------------------------

test('trang buổi: ván theo số, lần khai công khai (pending/approved), của mình kèm ReportDto', async () => {
  const r1 = await round('neutral');
  const r2 = await round('duck');
  const mineId = await roundReport({ memberId: a.id, roleId: pelican.id, roundId: r1, value: 2, status: 'pending' });
  await roundReport({ memberId: b.id, roleId: duck.id, roundId: r1, value: 1 });
  await roundReport({ memberId: mod.id, roleId: goose.id, roundId: r1, status: 'rejected' });
  await roundReport({ memberId: b.id, roleId: duck.id, roundId: r2, value: 3 });
  await updateRound(ctx, mod.id, r1, { winnerIds: [a.id] });

  const dto = await listSessionRounds(ctx, session.id, a.id);
  expect(dto.session).toMatchObject({ id: session.id, startsAt: SESSION_AT.replace('Z', '.000Z'), status: 'scheduled' });
  expect(dto.rounds.map((r) => [r.number, r.winnerFaction, r.winnerIds])).toEqual([
    [1, 'neutral', [a.id]],
    [2, 'duck', []],
  ]);
  const [first] = dto.rounds;
  expect(first!.reports.map((r) => [r.member.displayName, r.role.faction, r.status, r.won])).toEqual([
    ['An', 'neutral', 'pending', true],
    ['Bình', 'duck', 'approved', false],
  ]);
  expect(first!.reports[0]!.mine).toMatchObject({ id: mineId, value: 2, points: 1 + 2, round: { id: r1, won: true } });
  expect(first!.reports[1]!.mine).toBeNull();
  // Bình xem: thấy lần khai của mình ở cả hai ván, của An thì không có chỉ số.
  const asB = await listSessionRounds(ctx, session.id, b.id);
  expect(asB.rounds.map((r) => r.reports.map((x) => x.mine?.id ?? null))).toEqual([[null, expect.any(Number)], [expect.any(Number)]]);
  await expect(listSessionRounds(ctx, 999, a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
