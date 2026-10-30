import type { Member, Prisma, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { listRoles } from '../../src/server/modules/roles/service.js';
import {
  buildSeasonSummary,
  closeSeason,
  ensureSeason,
  isSeasonClosed,
  listSeasons,
  runSeasonJobs,
} from '../../src/server/modules/seasons/service.js';
import type { SeasonTitle } from '../../src/server/modules/seasons/service.js';
import { getHall } from '../../src/server/modules/stats/leaderboard.js';
import { reviewReport, submitReport } from '../../src/server/modules/stats/reports.js';
import type { Faction } from '../../src/shared/api-types.js';
import { DEFAULT_TEST_NOW, makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';
import { patchDelegate } from '../helpers/prisma.js';

/** Giờ chốt mùa 10/2026: 00:05 ngày 04/11 giờ VN. */
const CLOSE_AT = '2026-11-03T17:05:00Z';
/** Giờ nhắc mod: 09:00 ngày 03/11 giờ VN. */
const NUDGE_AT = '2026-11-03T02:00:00Z';

const NUDGE_TEXT = (n: number, label: string) => `📝 Mod ơi, còn ${n} lần khai của mùa ${label} chờ duyệt. Hạn chót 00:05 ngày 4.`;

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let a: Member; // An
let b: Member; // Bình
let mod: Member;
let goose: Role;
let duck: Role;
let swordsman: Role;
let dodo: Role;
let cuckoo: Role;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx()); // now mặc định: 19:00 ngày 22/10/2026 giờ VN
  a = await createMember(testDb, { displayName: 'An' });
  b = await createMember(testDb, { displayName: 'Bình' });
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  goose = await roleByKey(testDb, 'goose');
  duck = await roleByKey(testDb, 'duck');
  swordsman = await roleByKey(testDb, 'swordsman');
  dodo = await roleByKey(testDb, 'dodo');
  cuckoo = await roleByKey(testDb, 'cuckoo');
});
afterEach(() => vi.restoreAllMocks());

const modR = () => ({ id: mod.id, accessLevel: mod.accessLevel });
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const silenceConsoleWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

const seasonRow = (id: string) => testDb.season.findUniqueOrThrow({ where: { id } });
const reportRow = (id: number) => testDb.statReport.findUniqueOrThrow({ where: { id } });
const titleRows = (seasonId: string) => testDb.roleTitle.findMany({ where: { seasonId }, orderBy: { roleId: 'asc' } });

/** Khai một lần (mặc định ngày 21/10 — trong cửa sổ của now mặc định); trả về id. */
async function submit(memberId: number, o: { roleId: number; value: number; playedOn?: string }): Promise<number> {
  const r = await submitReport(ctx, memberId, { roleId: o.roleId, value: o.value, playedOn: o.playedOn ?? '2026-10-21' });
  return r.id;
}

/** Khai rồi duyệt ngay. */
async function approved(memberId: number, o: { roleId: number; value: number; playedOn?: string }): Promise<number> {
  const id = await submit(memberId, o);
  await reviewReport(ctx, modR(), id, { approve: true });
  return id;
}

/**
 * Mùa 10/2026 có kết quả: An dẫn Vịt (5) và Cò gáy (2); Bình dẫn Ngỗng (3) và Kiếm sĩ (4);
 * Chim đa đa chỉ có lần khai 0 điểm (không ai hoá thân); một lần khai Kiếm sĩ của An còn
 * chờ duyệt. Các thông báo 👑 lúc duyệt được xoá để test chỉ thấy tin của việc chốt mùa.
 */
async function octoberSeason(): Promise<{ pendingId: number }> {
  await approved(a.id, { roleId: duck.id, value: 5 });
  await approved(a.id, { roleId: cuckoo.id, value: 2 });
  await approved(b.id, { roleId: goose.id, value: 3 });
  await approved(b.id, { roleId: swordsman.id, value: 4 });
  await approved(b.id, { roleId: dodo.id, value: 0 });
  const pendingId = await submit(a.id, { roleId: swordsman.id, value: 1 });
  notifier.announcements = [];
  return { pendingId };
}

/** Bảng tổng kết mong đợi của `octoberSeason` — theo phe, trong phe theo thứ tự danh mục; điểm kèm nhãn chỉ số. */
const OCTOBER_SUMMARY = [
  '📜 Tổng kết mùa 10/2026',
  '🪿 Phe Ngỗng',
  '• Ngỗng: Bình (3 lần vote trúng Vịt)',
  '🦆 Phe Vịt',
  '• Vịt: An (5 mạng đã giết)',
  '• Kiếm sĩ: Bình (4 mạng chém)',
  '🐦 Phe thứ 3',
  '• Cò gáy: An (2 trứng không bị đập)',
].join('\n');

function octoberTitles(): { seasonId: string; roleId: number; memberId: number; score: number }[] {
  return [
    { seasonId: '2026-10', roleId: goose.id, memberId: b.id, score: 3 },
    { seasonId: '2026-10', roleId: duck.id, memberId: a.id, score: 5 },
    { seasonId: '2026-10', roleId: swordsman.id, memberId: b.id, score: 4 },
    { seasonId: '2026-10', roleId: cuckoo.id, memberId: a.id, score: 2 },
  ].sort((x, y) => x.roleId - y.roleId);
}

/** Lần khai đã duyệt chèn thẳng vào DB (bỏ qua cửa sổ 3 ngày) — cho các mùa đã qua. */
async function insertApproved(memberId: number, roleId: number, playedOn: string, value: number): Promise<void> {
  const reviewedAt = new Date(`${playedOn}T15:00:00Z`);
  await testDb.statReport.create({
    data: { memberId, roleId, playedOn: dateOnlyToDb(playedOn), value, status: 'approved', reviewedById: mod.id, reviewedAt, createdAt: reviewedAt },
  });
}

// ---------------------------------------------------------------------------
// Nền (Task 15)
// ---------------------------------------------------------------------------

test('ensureSeason is idempotent and uses VN month boundaries', async () => {
  await ensureSeason(ctx, '2026-10');
  await ensureSeason(ctx, '2026-10');
  // 00:00 ngày 01/10 giờ VN = 17:00Z ngày 30/09; kết thúc = 00:00 ngày 01/11 giờ VN.
  expect(await testDb.season.findMany()).toEqual([
    {
      id: '2026-10',
      startsAt: new Date('2026-09-30T17:00:00Z'),
      endsAt: new Date('2026-10-31T17:00:00Z'),
      closedAt: null,
      reviewNudgedAt: null,
      summaryPending: false,
    },
  ]);

  // Năm nhuận và tháng 12 cuộn năm.
  await ensureSeason(ctx, '2024-02');
  expect(await testDb.season.findUnique({ where: { id: '2024-02' } })).toMatchObject({
    startsAt: new Date('2024-01-31T17:00:00Z'),
    endsAt: new Date('2024-02-29T17:00:00Z'),
  });
  await ensureSeason(ctx, '2026-12');
  expect(await testDb.season.findUnique({ where: { id: '2026-12' } })).toMatchObject({
    startsAt: new Date('2026-11-30T17:00:00Z'),
    endsAt: new Date('2026-12-31T17:00:00Z'),
  });

  // Mùa đã có (kể cả đã chốt) không bị đụng tới.
  const closedAt = new Date(CLOSE_AT);
  await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt, reviewNudgedAt: closedAt } });
  await ensureSeason(ctx, '2026-10');
  expect(await testDb.season.findUniqueOrThrow({ where: { id: '2026-10' } })).toMatchObject({ closedAt, reviewNudgedAt: closedAt });

  // Hai bên tạo cùng lúc: đúng một dòng, không ném lỗi.
  await Promise.all([ensureSeason(ctx, '2027-01'), ensureSeason(ctx, '2027-01'), ensureSeason(ctx, '2027-01')]);
  expect(await testDb.season.count({ where: { id: '2027-01' } })).toBe(1);
  expect(await testDb.season.count()).toBe(4);

  // Mã mùa sai định dạng là lỗi lập trình (người gọi phải kiểm tra trước).
  await expect(ensureSeason(ctx, '2026-13')).rejects.toThrow();
  await expect(ensureSeason(ctx, '2026/10')).rejects.toThrow();
});

test('isSeasonClosed is false until closedAt is set', async () => {
  expect(await isSeasonClosed(ctx, '2026-10')).toBe(false); // chưa có dòng = chưa chốt
  await ensureSeason(ctx, '2026-10');
  expect(await isSeasonClosed(ctx, '2026-10')).toBe(false);
  await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt: ctx.now() } });
  expect(await isSeasonClosed(ctx, '2026-10')).toBe(true);
  expect(await isSeasonClosed(ctx, '2026-09')).toBe(false);
});

// ---------------------------------------------------------------------------
// Chốt mùa
// ---------------------------------------------------------------------------

test('not closed before close time', async () => {
  await octoberSeason();
  setNow('2026-11-03T17:04:00Z');
  await runSeasonJobs(ctx);
  expect(await isSeasonClosed(ctx, '2026-10')).toBe(false);
  expect(await testDb.roleTitle.count()).toBe(0);
  // Một phút trước giờ chốt vẫn là "trước giờ chốt": chưa có tổng kết; lời nhắc mod còn nợ
  // từ 09:00 ngày 3 (chưa ghi dấu, còn lần khai chờ) thì vẫn gửi.
  expect(notifier.announcements).toEqual([NUDGE_TEXT(1, '10/2026')]);
});

test('closes at 00:05 on the 4th (VN)', async () => {
  const { pendingId } = await octoberSeason();
  setNow(CLOSE_AT);
  await runSeasonJobs(ctx);

  expect(await isSeasonClosed(ctx, '2026-10')).toBe(true);
  expect(await seasonRow('2026-10')).toMatchObject({ closedAt: new Date(CLOSE_AT), summaryPending: false, reviewNudgedAt: null });

  // Lần khai chờ duyệt bị từ chối tự động — không có người duyệt.
  expect(await reportRow(pendingId)).toMatchObject({
    status: 'rejected',
    rejectReason: 'Mùa đã chốt',
    reviewedAt: new Date(CLOSE_AT),
    reviewedById: null,
  });
  expect(await testDb.statReport.count({ where: { status: 'approved' } })).toBe(5); // lần khai đã duyệt không bị đụng

  // Top 1 mỗi role có điểm > 0 (Chim đa đa chỉ có 0 điểm → không có danh hiệu).
  expect(await testDb.roleTitle.count({ where: { seasonId: '2026-10' } })).toBe(4);
  expect(await titleRows('2026-10')).toEqual(octoberTitles());

  // Bảng tổng kết đăng một lần, đúng thứ tự phe và thứ tự danh mục trong phe.
  expect(notifier.announcements).toEqual([OCTOBER_SUMMARY]);

  // Đại sảnh của mùa đã chốt đọc từ role_titles.
  const hall = await getHall(ctx, '2026-10');
  expect(hall.closed).toBe(true);
  expect(hall.roles.find((r) => r.role.key === 'duck')?.holder).toEqual({ memberId: a.id, displayName: 'An', score: 5 });
  expect(hall.roles.find((r) => r.role.key === 'dodo')?.holder).toBeNull();
});

test('closing twice is harmless', async () => {
  await octoberSeason();
  setNow(CLOSE_AT);
  expect(await closeSeason(ctx, '2026-10')).toEqual({ titles: 4, autoRejected: 1 });
  const titles = await titleRows('2026-10');

  // Một lần khai được duyệt lọt vào sau khi chốt (vượt qua kiểm tra của reports.ts) không
  // làm đổi danh hiệu đã trao: lần chốt sau không tính lại.
  await insertApproved(b.id, duck.id, '2026-10-30', 99);
  setNow('2026-11-03T17:06:00Z');
  expect(await closeSeason(ctx, '2026-10')).toEqual({ titles: 0, autoRejected: 0 });
  await runSeasonJobs(ctx);

  expect(await titleRows('2026-10')).toEqual(titles);
  expect(await seasonRow('2026-10')).toMatchObject({ closedAt: new Date(CLOSE_AT), summaryPending: false });
  expect(notifier.announcements).toEqual([OCTOBER_SUMMARY]);
});

test('late report for a closed month is refused', async () => {
  await octoberSeason();
  setNow('2026-11-03T17:06:00Z');
  await runSeasonJobs(ctx);
  expect(await isSeasonClosed(ctx, '2026-10')).toBe(true);
  // 3 ngày lùi từ 04/11 là 01/11 → tháng 10 đã ngoài cửa sổ trước cả giờ chốt
  await expect(submitReport(ctx, a.id, { roleId: duck.id, value: 1, playedOn: '2026-10-31' })).rejects.toMatchObject({
    code: 'PLAYED_ON_OUT_OF_WINDOW',
  });
});

test('submit after close is SEASON_CLOSED', async () => {
  // phòng thủ: mùa bị chốt khi ngày chơi vẫn trong cửa sổ
  await ensureSeason(ctx, '2026-10');
  await closeSeason(ctx, '2026-10'); // now mặc định 22/10
  await expect(submitReport(ctx, a.id, { roleId: duck.id, value: 1, playedOn: '2026-10-21' })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });

  // Mùa không có ai hoá thân vẫn có tổng kết (một dòng).
  expect(notifier.announcements).toEqual(['📜 Tổng kết mùa 10/2026: chưa có ai hoá thân.']);
  expect(await seasonRow('2026-10')).toMatchObject({ closedAt: new Date(DEFAULT_TEST_NOW), summaryPending: false });
});

test('closeSeason validates the id and creates the season row if missing', async () => {
  for (const bad of ['2026-13', '2026-00', '2026/10', '2026-1', 'abc', '']) {
    await expect(closeSeason(ctx, bad)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Mùa không hợp lệ' });
  }
  expect(await testDb.season.count()).toBe(0);

  expect(await closeSeason(ctx, '2026-09')).toEqual({ titles: 0, autoRejected: 0 });
  expect(await seasonRow('2026-09')).toEqual({
    id: '2026-09',
    startsAt: new Date('2026-08-31T17:00:00Z'),
    endsAt: new Date('2026-09-30T17:00:00Z'),
    closedAt: new Date(DEFAULT_TEST_NOW),
    reviewNudgedAt: null,
    summaryPending: false,
  });
  expect(notifier.announcements).toEqual(['📜 Tổng kết mùa 09/2026: chưa có ai hoá thân.']);
});

test('closeSeason rolls back entirely when a step inside the transaction fails', async () => {
  const { pendingId } = await octoberSeason();
  setNow(CLOSE_AT);

  // Chặn INSERT vào role_titles ngay trong PostgreSQL: bước cuối của giao dịch thất bại
  // → đặt closedAt và từ chối lần khai chờ (hai bước trước) phải được hoàn tác theo.
  await testDb.$executeRawUnsafe('DROP TRIGGER IF EXISTS ggd_test_block ON role_titles');
  await testDb.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION ggd_test_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test: role_titles bi chan'; END $$`,
  );
  await testDb.$executeRawUnsafe('CREATE TRIGGER ggd_test_block BEFORE INSERT ON role_titles FOR EACH ROW EXECUTE FUNCTION ggd_test_block()');
  try {
    await expect(closeSeason(ctx, '2026-10')).rejects.toThrow(/role_titles bi chan/);
  } finally {
    await testDb.$executeRawUnsafe('DROP TRIGGER IF EXISTS ggd_test_block ON role_titles');
    await testDb.$executeRawUnsafe('DROP FUNCTION IF EXISTS ggd_test_block()');
  }

  expect(await isSeasonClosed(ctx, '2026-10')).toBe(false);
  expect(await seasonRow('2026-10')).toMatchObject({ closedAt: null, summaryPending: false });
  expect(await testDb.roleTitle.count()).toBe(0);
  expect(await reportRow(pendingId)).toMatchObject({ status: 'pending', rejectReason: null, reviewedAt: null });
  expect(notifier.announcements).toEqual([]);

  // Lỗi đã qua: lần chốt sau chạy trọn.
  expect(await closeSeason(ctx, '2026-10')).toEqual({ titles: 4, autoRejected: 1 });
  expect(notifier.announcements).toEqual([OCTOBER_SUMMARY]);
});

// ---------------------------------------------------------------------------
// Tổng kết: đăng bù khi Discord sập
// ---------------------------------------------------------------------------

test('Discord down at close: titles stored, summary posted once when Discord is back', async () => {
  const { pendingId } = await octoberSeason();
  const errors = silenceConsoleError();

  setNow(CLOSE_AT);
  notifier.down = true;
  await runSeasonJobs(ctx);
  expect(await seasonRow('2026-10')).toMatchObject({ closedAt: new Date(CLOSE_AT), summaryPending: true });
  expect(await titleRows('2026-10')).toEqual(octoberTitles());
  expect(await reportRow(pendingId)).toMatchObject({ status: 'rejected', rejectReason: 'Mùa đã chốt' });
  expect(notifier.announcements).toEqual([]);
  expect(errors).toHaveBeenCalledTimes(1);

  // Vẫn sập ở lượt sau: không chốt lại, không đăng gì, chỉ ghi log.
  setNow('2026-11-03T17:06:00Z');
  await runSeasonJobs(ctx);
  expect(await seasonRow('2026-10')).toMatchObject({ closedAt: new Date(CLOSE_AT), summaryPending: true });
  expect(notifier.announcements).toEqual([]);
  expect(errors).toHaveBeenCalledTimes(2);

  // Discord trở lại: đăng đúng một lần, y như lần đầu, rồi tắt cờ.
  notifier.down = false;
  setNow('2026-11-03T17:07:00Z');
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([OCTOBER_SUMMARY]);
  expect(await seasonRow('2026-10')).toMatchObject({ summaryPending: false });

  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([OCTOBER_SUMMARY]);
  expect(errors).toHaveBeenCalledTimes(2);
});

test('a summary that fails midway is reposted whole on the next run', async () => {
  // Mùa 09 đã chốt, chưa đăng tổng kết, mọi role đang bật đều có người hoá thân với tên
  // dài → bảng vượt 2000 ký tự và phải chia nhiều phần.
  const long = await createMember(testDb, { displayName: 'Nguyễn Văn Người Chơi Có Tên Rất Dài' });
  await ensureSeason(ctx, '2026-09');
  await testDb.season.update({ where: { id: '2026-09' }, data: { closedAt: ctx.now(), summaryPending: true } });
  const roles = await listRoles(ctx);
  await testDb.roleTitle.createMany({ data: roles.map((r, i) => ({ seasonId: '2026-09', roleId: r.id, memberId: long.id, score: i + 1 })) });
  const expected = buildSeasonSummary(
    '2026-09',
    roles.map((r, i) => ({
      faction: r.faction,
      roleName: r.nameVi,
      displayName: long.displayName,
      score: i + 1,
      metricLabel: r.metricLabel,
      points: r.points,
      extraMetricLabel: r.extraMetricLabel,
      extraPoints: r.extraPoints,
      penaltyMetricLabel: r.penaltyMetricLabel,
      penaltyMaxPerGame: r.penaltyMaxPerGame,
      penaltyPoints: r.penaltyPoints,
    })),
  );
  expect(expected.length).toBeGreaterThanOrEqual(2);

  // Phần thứ hai rớt.
  const errors = silenceConsoleError();
  let calls = 0;
  vi.spyOn(notifier, 'announce').mockImplementation(async (text) => {
    calls += 1;
    if (calls === 2) throw new Error('FakeNotifier: rớt mạng giữa chừng');
    notifier.announcements.push(text);
  });
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([expected[0]]);
  expect(await seasonRow('2026-09')).toMatchObject({ summaryPending: true });
  expect(errors).toHaveBeenCalledTimes(1);

  // Lượt sau đăng lại cả bảng (phần đầu lặp — chấp nhận) rồi tắt cờ.
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([expected[0], ...expected]);
  expect(await seasonRow('2026-09')).toMatchObject({ summaryPending: false });

  await runSeasonJobs(ctx);
  expect(notifier.announcements).toHaveLength(1 + expected.length);
});

test('a stray pending report in an already-closed season is auto-rejected on the next run', async () => {
  await octoberSeason();
  setNow(CLOSE_AT);
  await runSeasonJobs(ctx);
  const titles = await titleRows('2026-10');

  // Lọt vào sau giờ chốt (khe kiểm-tra-rồi-ghi của reports.ts).
  const stray = await testDb.statReport.create({
    data: { memberId: a.id, roleId: duck.id, playedOn: dateOnlyToDb('2026-10-31'), value: 9, createdAt: ctx.now() },
  });
  const warns = silenceConsoleWarn();
  setNow('2026-11-03T17:06:00Z');
  await runSeasonJobs(ctx);

  expect(await reportRow(stray.id)).toMatchObject({
    status: 'rejected',
    rejectReason: 'Mùa đã chốt',
    reviewedAt: new Date('2026-11-03T17:06:00Z'),
    reviewedById: null,
  });
  expect(await titleRows('2026-10')).toEqual(titles);
  expect(notifier.announcements).toEqual([OCTOBER_SUMMARY]);
  expect(warns).toHaveBeenCalledTimes(1);

  // Lượt sau không còn gì để dọn (và không ghi log).
  await runSeasonJobs(ctx);
  expect(warns).toHaveBeenCalledTimes(1);
});

test('seasons are handled oldest first and a failing season does not block the others', async () => {
  // Bot nằm im nhiều tháng: ba mùa tới hạn cùng lúc.
  for (const id of ['2026-07', '2026-08', '2026-09']) await ensureSeason(ctx, id);
  await insertApproved(a.id, goose.id, '2026-07-10', 2);
  await insertApproved(b.id, duck.id, '2026-08-10', 3);
  await insertApproved(a.id, cuckoo.id, '2026-09-10', 4);

  // Mùa 08 lỗi DB đúng một lần (ở bước ensureSeason của closeSeason).
  const errors = silenceConsoleError();
  let failed = false;
  const restore = patchDelegate(testDb.season, 'upsert', (original) =>
    ((args: Prisma.SeasonUpsertArgs) => {
      if (args.where.id === '2026-08' && !failed) {
        failed = true;
        throw new Error('test: DB lỗi');
      }
      return original(args);
    }) as never,
  );
  setNow('2026-10-05T00:00:00Z');
  try {
    await runSeasonJobs(ctx);
  } finally {
    restore();
  }
  expect(failed).toBe(true);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(await isSeasonClosed(ctx, '2026-07')).toBe(true);
  expect(await isSeasonClosed(ctx, '2026-08')).toBe(false);
  expect(await isSeasonClosed(ctx, '2026-09')).toBe(true);
  expect(notifier.announcements).toEqual([
    '📜 Tổng kết mùa 07/2026\n🪿 Phe Ngỗng\n• Ngỗng: An (2 lần vote trúng Vịt)',
    '📜 Tổng kết mùa 09/2026\n🐦 Phe thứ 3\n• Cò gáy: An (4 trứng không bị đập)',
  ]);

  // Lượt sau chốt nốt mùa 08.
  await runSeasonJobs(ctx);
  expect(await isSeasonClosed(ctx, '2026-08')).toBe(true);
  expect(notifier.announcements).toHaveLength(3);
  expect(notifier.announcements[2]).toBe('📜 Tổng kết mùa 08/2026\n🦆 Phe Vịt\n• Vịt: Bình (3 mạng đã giết)');
  expect(await testDb.roleTitle.count()).toBe(3);
});

// ---------------------------------------------------------------------------
// Nhắc mod ngày 3
// ---------------------------------------------------------------------------

test('nudge on the 3rd only once and only with pending', async () => {
  // Mùa 09 không còn gì chờ duyệt → không nhắc, không ghi dấu.
  await ensureSeason(ctx, '2026-09');
  setNow('2026-10-03T02:00:00Z');
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([]);
  expect(await seasonRow('2026-09')).toMatchObject({ reviewNudgedAt: null });

  // Có lần khai chờ xuất hiện sau đó trong ngày 3 → lượt sau nhắc.
  const lateId = await submit(a.id, { roleId: duck.id, value: 2, playedOn: '2026-09-30' });
  setNow('2026-10-03T03:00:00Z');
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([NUDGE_TEXT(1, '09/2026')]);
  expect(await seasonRow('2026-09')).toMatchObject({ reviewNudgedAt: new Date('2026-10-03T03:00:00Z'), closedAt: null });

  // Dọn: mod duyệt nốt rồi mùa 09 chốt, để phần sau chỉ còn mùa 10.
  await reviewReport(ctx, modR(), lateId, { approve: false, reason: 'Trùng' });
  await testDb.season.update({ where: { id: '2026-09' }, data: { closedAt: ctx.now() } });
  notifier.announcements = [];

  // Mùa 10 với 2 lần khai chờ: chưa tới 09:00 → không nhắc; 09:00 → nhắc đúng một lần.
  setNow(DEFAULT_TEST_NOW);
  await octoberSeason();
  await submit(b.id, { roleId: goose.id, value: 1 });
  setNow('2026-11-03T01:59:00Z');
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([]);

  setNow(NUDGE_AT);
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([NUDGE_TEXT(2, '10/2026')]);
  expect(await seasonRow('2026-10')).toMatchObject({ reviewNudgedAt: new Date(NUDGE_AT), closedAt: null });

  setNow('2026-11-03T02:01:00Z');
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([NUDGE_TEXT(2, '10/2026')]);
  expect(await isSeasonClosed(ctx, '2026-10')).toBe(false);
});

/** Lần nhận treo thưởng chờ duyệt chèn thẳng vào DB, buổi chơi lúc `startsAt`, ngày chơi `playedOn`. */
async function insertPendingClaim(memberId: number, startsAt: string, playedOn: string): Promise<void> {
  const session = await createSession(testDb, { startsAt: new Date(startsAt), createdById: mod.id });
  const bounty = await testDb.bounty.create({ data: { title: 'Thắng 1 ván', points: 3, sessionId: session.id, createdById: mod.id } });
  await testDb.bountyClaim.create({
    data: { bountyId: bounty.id, memberId, sessionId: session.id, playedOn: dateOnlyToDb(playedOn), points: 3, source: 'web' },
  });
}

test('nudge counts pending bounty claims too (only claims, or both)', async () => {
  // Mùa 10 chỉ có lần nhận treo thưởng chờ duyệt → vẫn nhắc, bỏ phần lần khai.
  await ensureSeason(ctx, '2026-10');
  await insertPendingClaim(a.id, '2026-10-21T14:00:00Z', '2026-10-21');
  await insertPendingClaim(b.id, '2026-10-22T14:00:00Z', '2026-10-22');
  setNow(NUDGE_AT);
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual(['📝 Mod ơi, còn 2 lần nhận treo thưởng của mùa 10/2026 chờ duyệt. Hạn chót 00:05 ngày 4.']);
  expect(await seasonRow('2026-10')).toMatchObject({ reviewNudgedAt: new Date(NUDGE_AT) });

  // Mùa 11 có cả hai → nêu cả hai số.
  notifier.announcements = [];
  await ensureSeason(ctx, '2026-11');
  await testDb.statReport.create({
    data: { memberId: a.id, roleId: duck.id, playedOn: dateOnlyToDb('2026-11-20'), value: 1, status: 'pending' },
  });
  await insertPendingClaim(a.id, '2026-11-20T14:00:00Z', '2026-11-20');
  setNow('2026-12-03T02:00:00Z');
  await runSeasonJobs(ctx);
  expect(notifier.announcements.at(-1)).toBe(
    '📝 Mod ơi, còn 1 lần khai và 1 lần nhận treo thưởng của mùa 11/2026 chờ duyệt. Hạn chót 00:05 ngày 4.',
  );
});

test('nudge is not marked when the announcement fails and is retried next tick', async () => {
  await octoberSeason();
  const errors = silenceConsoleError();

  setNow(NUDGE_AT);
  notifier.down = true;
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([]);
  expect(await seasonRow('2026-10')).toMatchObject({ reviewNudgedAt: null, closedAt: null });
  expect(errors).toHaveBeenCalledTimes(1);

  notifier.down = false;
  setNow('2026-11-03T02:01:00Z');
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([NUDGE_TEXT(1, '10/2026')]);
  expect(await seasonRow('2026-10')).toMatchObject({ reviewNudgedAt: new Date('2026-11-03T02:01:00Z') });
});

test('nudge is not sent once the close time has passed', async () => {
  await octoberSeason();
  // Bot nằm im cả ngày 3; tỉnh lại đúng giờ chốt → chốt luôn, không nhắc nữa.
  setNow(CLOSE_AT);
  await runSeasonJobs(ctx);
  expect(notifier.announcements).toEqual([OCTOBER_SUMMARY]);
  expect(await seasonRow('2026-10')).toMatchObject({ reviewNudgedAt: null, closedAt: new Date(CLOSE_AT) });
});

// ---------------------------------------------------------------------------
// Văn bản tổng kết
// ---------------------------------------------------------------------------

const FACTIONS: Faction[] = ['goose', 'duck', 'neutral'];

function manyTitles(n: number): SeasonTitle[] {
  return Array.from({ length: n }, (_, i) => ({
    faction: FACTIONS[i % 3]!,
    roleName: `Role số ${i + 1}`,
    displayName: `Người chơi có tên khá dài số ${i + 1}`,
    score: i + 1,
    metricLabel: 'Số mạng đã giết',
    points: 1,
    extraMetricLabel: null,
    extraPoints: null,
    penaltyMetricLabel: null,
    penaltyMaxPerGame: null,
    penaltyPoints: null,
  }));
}

/** Role thường trong `SeasonTitle`: ×1, không có chỉ số phụ hay phạt. */
const plain = (metricLabel: string) => ({
  metricLabel,
  points: 1,
  extraMetricLabel: null,
  extraPoints: null,
  penaltyMetricLabel: null,
  penaltyMaxPerGame: null,
  penaltyPoints: null,
});

test('summary split under Discord limit', () => {
  const titles = manyTitles(120);
  const parts = buildSeasonSummary('2026-10', titles);
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000);

  // Tiêu đề chỉ ở phần đầu; các phần sau không lặp lại.
  expect(parts[0]!.startsWith('📜 Tổng kết mùa 10/2026\n')).toBe(true);
  for (const p of parts.slice(1)) expect(p).not.toContain('📜');

  // Cắt đúng ranh giới dòng: ghép lại được y nguyên các dòng, theo phe rồi theo thứ tự đưa vào.
  const expectedLines = ['📜 Tổng kết mùa 10/2026'];
  for (const [faction, heading] of [
    ['goose', '🪿 Phe Ngỗng'],
    ['duck', '🦆 Phe Vịt'],
    ['neutral', '🐦 Phe thứ 3'],
  ] as const) {
    expectedLines.push(heading, ...titles.filter((t) => t.faction === faction).map((t) => `• ${t.roleName}: ${t.displayName} (${t.score} mạng đã giết)`));
  }
  expect(parts.flatMap((p) => p.split('\n'))).toEqual(expectedLines);
  for (const p of parts) expect(p).toMatch(/^\S[\s\S]*\S$/); // không bắt đầu/kết thúc bằng xuống dòng
});

test('summary groups by faction in order, omits empty factions, and has a one-line empty form', () => {
  expect(
    buildSeasonSummary('2026-01', [
      { faction: 'neutral', roleName: 'Cò gáy', displayName: 'An', score: 2, ...plain('Số trứng không bị đập') },
      { faction: 'goose', roleName: 'Ngỗng', displayName: 'Bình', score: 3, ...plain('Số lần vote trúng Vịt') },
      { faction: 'goose', roleName: 'Thầy đồng', displayName: 'An', score: 1, ...plain('Số xác ẩn được bạn phát hiện') },
    ]),
  ).toEqual([
    '📜 Tổng kết mùa 01/2026\n🪿 Phe Ngỗng\n• Ngỗng: Bình (3 lần vote trúng Vịt)\n• Thầy đồng: An (1 xác ẩn được bạn phát hiện)\n🐦 Phe thứ 3\n• Cò gáy: An (2 trứng không bị đập)',
  ]);
  expect(buildSeasonSummary('2026-12', [{ faction: 'duck', roleName: 'Vịt', displayName: 'An', score: 15, ...plain('Số mạng đã giết') }])).toEqual([
    '📜 Tổng kết mùa 12/2026\n🦆 Phe Vịt\n• Vịt: An (15 mạng đã giết)',
  ]);
  expect(buildSeasonSummary('2026-10', [])).toEqual(['📜 Tổng kết mùa 10/2026: chưa có ai hoá thân.']);
});

test('summary writes "N điểm" for a role with an extra metric', () => {
  const assassin = { ...plain('Số mạng đã giết'), extraMetricLabel: 'Số lần ám sát trong cuộc họp', extraPoints: 3 };
  expect(
    buildSeasonSummary('2026-10', [
      { faction: 'duck', roleName: 'Ám sát', displayName: 'An', score: 10, ...assassin },
      { faction: 'duck', roleName: 'Vịt', displayName: 'Bình', score: 5, ...plain('Số mạng đã giết') },
    ]),
  ).toEqual(['📜 Tổng kết mùa 10/2026\n🦆 Phe Vịt\n• Ám sát: An (10 điểm)\n• Vịt: Bình (5 mạng đã giết)']);
});

test('closing a season writes extra-metric points to role_titles and the summary reads "N điểm"', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  // An: 4 + 2 × 3 = 10; Bình: 9 → An hoá thân Ám sát với 10 điểm.
  await reviewReport(ctx, modR(), (await submitReport(ctx, a.id, { roleId: assassin.id, value: 4, extraValue: 2, playedOn: '2026-10-21' })).id, { approve: true });
  await reviewReport(ctx, modR(), (await submitReport(ctx, b.id, { roleId: assassin.id, value: 9, playedOn: '2026-10-21' })).id, { approve: true });
  notifier.announcements = [];

  setNow(CLOSE_AT);
  expect(await closeSeason(ctx, '2026-10')).toEqual({ titles: 1, autoRejected: 0 });
  expect(await titleRows('2026-10')).toMatchObject([{ roleId: assassin.id, memberId: a.id, score: 10 }]);
  expect(notifier.announcements).toEqual(['📜 Tổng kết mùa 10/2026\n🦆 Phe Vịt\n• Ám sát: An (10 điểm)']);
});

// ---------------------------------------------------------------------------
// Danh sách mùa
// ---------------------------------------------------------------------------

test('listSeasons includes the current season', async () => {
  // Chưa có dòng nào: vẫn có mùa hiện tại (now mặc định 22/10).
  expect(await listSeasons(ctx)).toEqual([{ id: '2026-10', closed: false }]);

  await ensureSeason(ctx, '2026-08');
  await ensureSeason(ctx, '2026-09');
  await testDb.season.update({ where: { id: '2026-09' }, data: { closedAt: ctx.now() } });
  const expected = [
    { id: '2026-10', closed: false },
    { id: '2026-09', closed: true },
    { id: '2026-08', closed: false },
  ];
  expect(await listSeasons(ctx)).toEqual(expected);

  // Mùa hiện tại đã có dòng: không nhân đôi.
  await ensureSeason(ctx, '2026-10');
  expect(await listSeasons(ctx)).toEqual(expected);

  await closeSeason(ctx, '2026-10');
  expect((await listSeasons(ctx))[0]).toEqual({ id: '2026-10', closed: true });

  // Sang tháng: mùa mới đứng đầu dù chưa có dòng.
  setNow('2026-10-31T17:00:00Z'); // 00:00 ngày 01/11 giờ VN
  expect((await listSeasons(ctx)).map((s) => s.id)).toEqual(['2026-11', '2026-10', '2026-09', '2026-08']);
});
