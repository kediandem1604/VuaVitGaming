import type { Member, Prisma, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { ensureSeason } from '../../src/server/modules/seasons/service.js';
import {
  listMyReports,
  listPendingReports,
  reviewReport,
  submitReport,
  updateOwnReport,
} from '../../src/server/modules/stats/reports.js';
import type { ReportDto } from '../../src/shared/api-types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';
import { patchDelegate } from '../helpers/prisma.js';

/** 12:00 ngày 10/10/2026 giờ VN: khai được các trận từ 07/10 đến 10/10. */
const NOW = '2026-10-10T05:00:00Z';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
/** Người khai mặc định. */
let member: Member;
let duck: Role;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  setNow(NOW);
  member = await createMember(testDb, { displayName: 'An' });
  duck = await roleByKey(testDb, 'duck');
});
afterEach(() => vi.restoreAllMocks());

type SubmitOverrides = {
  memberId?: number;
  roleKey?: string;
  roleId?: number;
  value?: number;
  extraValue?: number;
  penaltyValue?: number;
  playedOn?: string;
  sessionId?: number | null;
  note?: string | null;
};

/** Khai mặc định: Vịt, 3 mạng, ngày 10/10, không buổi, không ghi chú, không chỉ số phụ/phạt; ghi đè từng trường. */
async function submit(o: SubmitOverrides = {}) {
  const roleId = o.roleId ?? (o.roleKey ? (await roleByKey(testDb, o.roleKey)).id : duck.id);
  return submitReport(ctx, o.memberId ?? member.id, {
    roleId,
    value: o.value ?? 3,
    playedOn: o.playedOn ?? '2026-10-10',
    ...(o.extraValue !== undefined ? { extraValue: o.extraValue } : {}),
    ...(o.penaltyValue !== undefined ? { penaltyValue: o.penaltyValue } : {}),
    ...(o.sessionId !== undefined ? { sessionId: o.sessionId } : {}),
    ...(o.note !== undefined ? { note: o.note } : {}),
  });
}

/** Phần role trong `ReportDto` của một role không có chỉ số phụ. */
const roleDtoOf = (role: Role): ReportDto['role'] => ({
  id: role.id,
  nameVi: role.nameVi,
  icon: role.icon,
  metricLabel: role.metricLabel,
  maxPerGame: role.maxPerGame,
  points: role.points,
  extraMetricLabel: role.extraMetricLabel,
  extraMaxPerGame: role.extraMaxPerGame,
  extraPoints: role.extraPoints,
  penaltyMetricLabel: role.penaltyMetricLabel,
  penaltyMaxPerGame: role.penaltyMaxPerGame,
  penaltyPoints: role.penaltyPoints,
});

const reportRow = (id: number) => testDb.statReport.findUniqueOrThrow({ where: { id } });
const mod = (displayName = 'Mod') => createMember(testDb, { accessLevel: 'mod', displayName });
const admin = () => createMember(testDb, { accessLevel: 'admin', displayName: 'Admin' });
const asReviewer = (m: Member) => ({ id: m.id, accessLevel: m.accessLevel });
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Khai điểm
// ---------------------------------------------------------------------------

test('submit stores a pending report with the clock time and ensures the season', async () => {
  const r = await submit({ note: '  Trận cuối tối qua  ' });
  expect(r).toEqual({
    id: r.id,
    memberId: member.id,
    roleId: duck.id,
    sessionId: null,
    playedOn: dateOnlyToDb('2026-10-10'),
    value: 3,
    extraValue: 0,
    penaltyValue: 0,
    bonusPoints: 0,
    source: 'self',
    note: 'Trận cuối tối qua',
    status: 'pending',
    reviewedById: null,
    reviewedAt: null,
    rejectReason: null,
    revokedById: null,
    revokedAt: null,
    createdAt: new Date(NOW), // từ đồng hồ của ctx, không phải giờ thật
    highlightChannelId: null,
    highlightMessageId: null,
  });
  expect(await reportRow(r.id)).toEqual(r);

  // Mùa của ngày chơi được tạo kèm (một lần).
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

  // Ghi chú rỗng/toàn khoảng trắng/vắng mặt/null → null; giá trị 0 hợp lệ.
  expect((await submit({ note: '' })).note).toBeNull();
  expect((await submit({ note: '   ' })).note).toBeNull();
  expect((await submit({ note: null })).note).toBeNull();
  expect((await submit()).note).toBeNull();
  expect((await submit({ value: 0 })).value).toBe(0);
  expect(await testDb.season.count()).toBe(1);
  expect(notifier.dms).toEqual([]);
  expect(notifier.announcements).toEqual([]);
});

test('played-on window', async () => {
  await expect(submit({ playedOn: '2026-10-07' })).resolves.toBeDefined();
  await expect(submit({ playedOn: '2026-10-10' })).resolves.toBeDefined();
  await expect(submit({ playedOn: '2026-10-06' })).rejects.toMatchObject({
    code: 'PLAYED_ON_OUT_OF_WINDOW',
    message: 'Chỉ khai được trận trong 3 ngày gần nhất',
  });
  await expect(submit({ playedOn: '2026-10-11' })).rejects.toMatchObject({ code: 'PLAYED_ON_OUT_OF_WINDOW' });

  // "Hôm nay" tính theo giờ VN, không theo UTC.
  setNow('2026-10-10T16:59:59Z'); // 23:59:59 ngày 10/10 VN
  await expect(submit({ playedOn: '2026-10-07' })).resolves.toBeDefined();
  setNow('2026-10-10T17:00:00Z'); // 00:00 ngày 11/10 VN
  await expect(submit({ playedOn: '2026-10-07' })).rejects.toMatchObject({ code: 'PLAYED_ON_OUT_OF_WINDOW' });
  await expect(submit({ playedOn: '2026-10-08' })).resolves.toBeDefined();
  await expect(submit({ playedOn: '2026-10-11' })).resolves.toBeDefined();

  // Sai định dạng hoặc ngày không tồn tại.
  for (const bad of ['10/10/2026', '2026-10-1', '2026-13-01', '2026-02-30', '', '2026-10-10T00:00:00Z', ' 2026-10-10']) {
    await expect(submit({ playedOn: bad })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Ngày chơi không hợp lệ' });
  }
  expect(await testDb.statReport.count()).toBe(5);
});

test('value bounds use role max', async () => {
  await expect(submit({ roleKey: 'swordsman', value: 16 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Giá trị phải từ 0 đến 15',
  });
  await expect(submit({ value: -1 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE', message: 'Giá trị phải từ 0 đến 15' });
  await expect(submit({ value: 2.5 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  await expect(submit({ value: Number.NaN })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  await expect(submit({ value: Number.POSITIVE_INFINITY })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  await expect(submit({ roleKey: 'cuckoo', value: 31 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Giá trị phải từ 0 đến 30',
  });
  await expect(submit({ roleKey: 'gravy', value: 2 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE', message: 'Giá trị phải từ 0 đến 1' });

  // Biên hợp lệ.
  await expect(submit({ roleKey: 'swordsman', value: 15 })).resolves.toMatchObject({ value: 15 });
  await expect(submit({ roleKey: 'cuckoo', value: 30 })).resolves.toMatchObject({ value: 30 });
  await expect(submit({ roleKey: 'gravy', value: 1 })).resolves.toMatchObject({ value: 1 });
  await expect(submit({ value: 0 })).resolves.toMatchObject({ value: 0 });

  // Giới hạn đọc từ role hiện tại: admin nâng giới hạn thì khai được ngay.
  await testDb.role.update({ where: { id: duck.id }, data: { maxPerGame: 20 } });
  await expect(submit({ value: 20 })).resolves.toMatchObject({ value: 20 });
  await expect(submit({ value: 21 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE', message: 'Giá trị phải từ 0 đến 20' });
  expect(await testDb.statReport.count()).toBe(5);
});

// ---------------------------------------------------------------------------
// Chỉ số phụ (Ám sát: giết ×1, ám sát trong họp ×3)
// ---------------------------------------------------------------------------

test('an extra-metric report stores extraValue and the DTO carries points and the role limits', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  expect(assassin).toMatchObject({ maxPerGame: 15, extraMetricLabel: 'Số lần ám sát trong cuộc họp', extraMaxPerGame: 2, extraPoints: 3 });

  const r = await submit({ roleId: assassin.id, value: 4, extraValue: 2 });
  expect(r).toMatchObject({ value: 4, extraValue: 2, status: 'pending' });
  expect(await reportRow(r.id)).toMatchObject({ value: 4, extraValue: 2 });

  const [dto] = await listMyReports(ctx, member.id);
  expect(dto).toEqual({
    id: r.id,
    member: { id: member.id, displayName: 'An' },
    role: {
      id: assassin.id,
      nameVi: 'Ám sát',
      icon: '🗡️',
      metricLabel: 'Số mạng đã giết',
      maxPerGame: 15,
      points: 1,
      extraMetricLabel: 'Số lần ám sát trong cuộc họp',
      extraMaxPerGame: 2,
      extraPoints: 3,
      penaltyMetricLabel: null,
      penaltyMaxPerGame: null,
      penaltyPoints: null,
    },
    value: 4,
    extraValue: 2,
    penaltyValue: 0,
    bonusPoints: 0,
    source: 'self',
    points: 10, // 4 + 2 × 3
    playedOn: '2026-10-10',
    sessionId: null,
    note: null,
    status: 'pending',
    rejectReason: null,
    createdAt: '2026-10-10T05:00:00.000Z',
    highlightUrl: null,
    accusation: null,
    accusationDuplicate: false,
    accusationWaitingFor: null,
    penaltyOf: null,
  });

  // Không gửi extraValue → 0; chỉ chỉ số phụ cũng được (0 + 1 × 3).
  const bare = await submit({ roleId: assassin.id, value: 5 });
  expect(bare.extraValue).toBe(0);
  const onlyExtra = await submit({ roleId: assassin.id, value: 0, extraValue: 1 });
  expect((await listMyReports(ctx, member.id)).map((d) => [d.id, d.points])).toEqual([
    [onlyExtra.id, 3],
    [bare.id, 5],
    [r.id, 10],
  ]);

  // Role không có chỉ số phụ: điểm = giá trị, ba trường phụ null, extraValue 0.
  const plain = await submit({ value: 7 });
  const plainDto = (await listMyReports(ctx, member.id)).find((d) => d.id === plain.id);
  expect(plainDto).toMatchObject({ value: 7, extraValue: 0, points: 7, role: roleDtoOf(duck) });
  expect(plainDto?.role).toEqual({
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
  });

  // `points` đọc extraPoints HIỆN TẠI của role: admin đổi điểm thì DTO đổi theo.
  await testDb.role.update({ where: { id: assassin.id }, data: { extraPoints: 5 } });
  expect((await listMyReports(ctx, member.id)).find((d) => d.id === r.id)).toMatchObject({ points: 14, role: { extraPoints: 5 } });
});

test('extraValue bounds: 0..extraMaxPerGame on an extra-metric role, exactly 0 elsewhere', async () => {
  const assassin = await roleByKey(testDb, 'assassin');

  await expect(submit({ roleId: assassin.id, value: 4, extraValue: 3 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Chỉ số phụ phải từ 0 đến 2',
  });
  await expect(submit({ roleId: assassin.id, extraValue: -1 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE', message: 'Chỉ số phụ phải từ 0 đến 2' });
  await expect(submit({ roleId: assassin.id, extraValue: 1.5 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  await expect(submit({ roleId: assassin.id, extraValue: Number.NaN })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  // Sai kiểu là dữ liệu không hợp lệ.
  await expect(submit({ roleId: assassin.id, extraValue: '1' as never })).rejects.toMatchObject({ code: 'VALIDATION' });
  // Giá trị chính kiểm trước chỉ số phụ.
  await expect(submit({ roleId: assassin.id, value: 16, extraValue: 9 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Giá trị phải từ 0 đến 15',
  });

  // Biên hợp lệ.
  await expect(submit({ roleId: assassin.id, value: 15, extraValue: 2 })).resolves.toMatchObject({ value: 15, extraValue: 2 });
  await expect(submit({ roleId: assassin.id, value: 0, extraValue: 0 })).resolves.toMatchObject({ value: 0, extraValue: 0 });

  // Giới hạn đọc từ role hiện tại.
  await testDb.role.update({ where: { id: assassin.id }, data: { extraMaxPerGame: 4 } });
  await expect(submit({ roleId: assassin.id, extraValue: 4 })).resolves.toMatchObject({ extraValue: 4 });
  await expect(submit({ roleId: assassin.id, extraValue: 5 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE', message: 'Chỉ số phụ phải từ 0 đến 4' });

  // Role không có chỉ số phụ: extraValue phải là 0 (0 hoặc vắng mặt đều được).
  await expect(submit({ extraValue: 1 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Role này không có chỉ số phụ' });
  await expect(submit({ roleKey: 'swordsman', extraValue: 2 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Role này không có chỉ số phụ' });
  await expect(submit({ extraValue: 0 })).resolves.toMatchObject({ extraValue: 0 });
  await expect(submit()).resolves.toMatchObject({ extraValue: 0 });
  expect(await testDb.statReport.count()).toBe(5);
});

test('editing keeps the stored extraValue unless sent, and re-checks it against the merged role', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  const r = await submit({ roleId: assassin.id, value: 4, extraValue: 2 });

  // Không gửi extraValue → giữ nguyên; gửi thì đổi và kiểm giới hạn.
  expect(await updateOwnReport(ctx, member.id, r.id, { value: 5 })).toMatchObject({ value: 5, extraValue: 2 });
  expect(await updateOwnReport(ctx, member.id, r.id, { note: 'x' })).toMatchObject({ value: 5, extraValue: 2 });
  expect(await updateOwnReport(ctx, member.id, r.id, { extraValue: 1 })).toMatchObject({ value: 5, extraValue: 1 });
  await expect(updateOwnReport(ctx, member.id, r.id, { extraValue: 3 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Chỉ số phụ phải từ 0 đến 2',
  });
  await expect(updateOwnReport(ctx, member.id, r.id, { extraValue: -1 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });

  // Đổi sang role không có chỉ số phụ khi còn extraValue > 0 → lỗi; gửi kèm extraValue 0 thì được.
  await expect(updateOwnReport(ctx, member.id, r.id, { roleId: duck.id })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Role này không có chỉ số phụ',
  });
  expect(await reportRow(r.id)).toMatchObject({ roleId: assassin.id, value: 5, extraValue: 1 });
  expect(await updateOwnReport(ctx, member.id, r.id, { roleId: duck.id, extraValue: 0 })).toMatchObject({ roleId: duck.id, value: 5, extraValue: 0 });

  // Role thường không nhận extraValue > 0 khi sửa; đổi về Ám sát kèm extraValue thì được.
  await expect(updateOwnReport(ctx, member.id, r.id, { extraValue: 1 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Role này không có chỉ số phụ' });
  expect(await updateOwnReport(ctx, member.id, r.id, { roleId: assassin.id, extraValue: 2 })).toMatchObject({ roleId: assassin.id, extraValue: 2 });
  await expect(updateOwnReport(ctx, member.id, r.id, { extraValue: '2' as never })).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await reportRow(r.id)).toMatchObject({ roleId: assassin.id, value: 5, extraValue: 2, status: 'pending' });
});

test('an extraValue edit between the mod reading and approving is refused', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  const m = await mod();
  const r = await submit({ roleId: assassin.id, value: 4, extraValue: 1 });

  // Người khai sửa chỉ số phụ ngay sau lần đọc đầu tiên của mod (role/ngày/giá trị chính không đổi).
  let intercepted = false;
  const restore = patchDelegate(testDb.statReport, 'findUnique', (original) =>
    (async (args: Prisma.StatReportFindUniqueArgs) => {
      const row = await original(args);
      if (!intercepted) {
        intercepted = true;
        await updateOwnReport(ctx, member.id, r.id, { extraValue: 2 });
      }
      return row;
    }) as never,
  );
  try {
    await expect(reviewReport(ctx, asReviewer(m), r.id, { approve: true })).rejects.toMatchObject({
      code: 'NOT_PENDING',
      message: 'Lần khai vừa được sửa, hãy xem lại',
    });
  } finally {
    restore();
  }
  expect(intercepted).toBe(true);
  expect(await reportRow(r.id)).toMatchObject({ status: 'pending', value: 4, extraValue: 2, reviewedById: null });
  expect(notifier.announcements).toEqual([]);

  // Mod xem lại rồi duyệt: tính đúng số mới (4 + 2 × 3 = 10).
  await reviewReport(ctx, asReviewer(m), r.id, { approve: true });
  expect(await reportRow(r.id)).toMatchObject({ status: 'approved', extraValue: 2 });
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Ám sát mùa 2026-10!']);
});

test('rejection DM of an extra-metric report reads "x + y"', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  const m = await mod();
  const r = await submit({ roleId: assassin.id, value: 4, extraValue: 2, playedOn: '2026-10-09' });
  await reviewReport(ctx, asReviewer(m), r.id, { approve: false, reason: 'Thiếu clip' });
  expect(notifier.dms).toEqual([
    {
      discordId: member.discordId,
      text: 'Lần khai Ám sát (4 mạng đã giết + 2 lần ám sát trong cuộc họp) ngày 09/10 bị từ chối: Thiếu clip',
    },
  ]);
});

// ---------------------------------------------------------------------------
// Chỉ số phạt (spec điểm role §3, §5)
// ---------------------------------------------------------------------------

test('a penalty report stores penaltyValue; points subtract it and the DTO carries the role penalty fields', async () => {
  // Cảnh sát trưởng (seed): ×3, tối đa 10; phạt "Số phát bắn sai" tối đa 10, −1 mỗi phát.
  const sheriff = await roleByKey(testDb, 'sheriff');
  expect(sheriff).toMatchObject({ points: 3, maxPerGame: 10, penaltyMetricLabel: 'Số phát bắn sai', penaltyMaxPerGame: 10, penaltyPoints: 1 });

  const r = await submit({ roleId: sheriff.id, value: 4, penaltyValue: 2 });
  expect(r).toMatchObject({ value: 4, extraValue: 0, penaltyValue: 2, status: 'pending' });
  expect(await reportRow(r.id)).toMatchObject({ value: 4, penaltyValue: 2 });

  // DTO: điểm = 4 × 3 − 2 × 1 = 10; role mang đủ ba trường phạt.
  const [dto] = await listMyReports(ctx, member.id);
  expect(dto).toMatchObject({ value: 4, penaltyValue: 2, points: 10, role: roleDtoOf(sheriff) });

  // Không gửi penaltyValue → 0; điểm có thể âm (0 × 3 − 3 × 1).
  const bare = await submit({ roleId: sheriff.id, value: 1 });
  expect(bare.penaltyValue).toBe(0);
  const negative = await submit({ roleId: sheriff.id, value: 0, penaltyValue: 3 });
  const dtos = await listMyReports(ctx, member.id);
  expect(dtos.find((d) => d.id === negative.id)?.points).toBe(-3);
  expect(dtos.find((d) => d.id === bare.id)?.points).toBe(3);
});

test('penaltyValue bounds: 0..penaltyMaxPerGame on a penalty role, exactly 0 elsewhere, checked after the extra metric', async () => {
  const sheriff = await roleByKey(testDb, 'sheriff');
  const vigilante = await roleByKey(testDb, 'vigilante');
  expect(vigilante).toMatchObject({ points: 5, maxPerGame: 1, penaltyMaxPerGame: 1, penaltyPoints: 3 });

  await expect(submit({ roleId: sheriff.id, value: 4, penaltyValue: 11 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Chỉ số phạt phải từ 0 đến 10',
  });
  await expect(submit({ roleId: vigilante.id, value: 1, penaltyValue: 2 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Chỉ số phạt phải từ 0 đến 1',
  });
  await expect(submit({ roleId: sheriff.id, value: 1, penaltyValue: -1 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE', message: 'Chỉ số phạt phải từ 0 đến 10' });
  await expect(submit({ roleId: sheriff.id, value: 1, penaltyValue: 1.5 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  await expect(submit({ roleId: sheriff.id, value: 1, penaltyValue: Number.NaN })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  // Sai kiểu là dữ liệu không hợp lệ chung.
  await expect(submit({ roleId: sheriff.id, value: 1, penaltyValue: '1' as never })).rejects.toMatchObject({ code: 'VALIDATION' });
  // Thứ tự kiểm: giá trị chính → chỉ số phụ → chỉ số phạt.
  await expect(submit({ roleId: sheriff.id, value: 11, penaltyValue: 99 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Giá trị phải từ 0 đến 10',
  });
  await expect(submit({ roleId: sheriff.id, value: 1, extraValue: 1, penaltyValue: 99 })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Role này không có chỉ số phụ',
  });
  // Hai đầu mút hợp lệ.
  await expect(submit({ roleId: sheriff.id, value: 10, penaltyValue: 10 })).resolves.toMatchObject({ value: 10, penaltyValue: 10 });
  await expect(submit({ roleId: vigilante.id, value: 0, penaltyValue: 1 })).resolves.toMatchObject({ value: 0, penaltyValue: 1 });
  await expect(submit({ roleId: sheriff.id, value: 0, penaltyValue: 0 })).resolves.toMatchObject({ penaltyValue: 0 });

  // Role không có chỉ số phạt: penaltyValue phải là 0 (0 hoặc vắng mặt đều được).
  await expect(submit({ penaltyValue: 1 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Role này không có chỉ số phạt' });
  await expect(submit({ roleKey: 'assassin', penaltyValue: 1 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Role này không có chỉ số phạt' });
  await expect(submit({ penaltyValue: 0 })).resolves.toMatchObject({ penaltyValue: 0 });
  await expect(submit()).resolves.toMatchObject({ penaltyValue: 0 });
});

test('editing keeps the stored penaltyValue unless sent, and re-checks it against the merged role', async () => {
  const sheriff = await roleByKey(testDb, 'sheriff');
  const r = await submit({ roleId: sheriff.id, value: 4, penaltyValue: 2 });

  // Không gửi penaltyValue → giữ nguyên; gửi thì đổi và kiểm giới hạn.
  expect(await updateOwnReport(ctx, member.id, r.id, { value: 5 })).toMatchObject({ value: 5, penaltyValue: 2 });
  expect(await updateOwnReport(ctx, member.id, r.id, { note: 'x' })).toMatchObject({ value: 5, penaltyValue: 2 });
  expect(await updateOwnReport(ctx, member.id, r.id, { penaltyValue: 1 })).toMatchObject({ value: 5, penaltyValue: 1 });
  await expect(updateOwnReport(ctx, member.id, r.id, { penaltyValue: 11 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Chỉ số phạt phải từ 0 đến 10',
  });
  await expect(updateOwnReport(ctx, member.id, r.id, { penaltyValue: -1 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  await expect(updateOwnReport(ctx, member.id, r.id, { penaltyValue: '2' as never })).rejects.toMatchObject({ code: 'VALIDATION' });

  // Đổi sang role không có chỉ số phạt khi còn penaltyValue > 0 → lỗi; gửi kèm penaltyValue 0 thì được.
  await expect(updateOwnReport(ctx, member.id, r.id, { roleId: duck.id })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Role này không có chỉ số phạt',
  });
  expect(await reportRow(r.id)).toMatchObject({ roleId: sheriff.id, value: 5, penaltyValue: 1 });
  expect(await updateOwnReport(ctx, member.id, r.id, { roleId: duck.id, penaltyValue: 0 })).toMatchObject({ roleId: duck.id, value: 5, penaltyValue: 0 });

  // Role thường không nhận penaltyValue > 0 khi sửa; đổi về Cảnh sát trưởng kèm penaltyValue thì được.
  await expect(updateOwnReport(ctx, member.id, r.id, { penaltyValue: 1 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Role này không có chỉ số phạt' });
  expect(await updateOwnReport(ctx, member.id, r.id, { roleId: sheriff.id, penaltyValue: 3 })).toMatchObject({ roleId: sheriff.id, penaltyValue: 3 });
  expect(await reportRow(r.id)).toMatchObject({ roleId: sheriff.id, value: 5, penaltyValue: 3, status: 'pending' });
});

test('a penaltyValue edit between the mod reading and approving is refused', async () => {
  const sheriff = await roleByKey(testDb, 'sheriff');
  const m = await mod();
  const r = await submit({ roleId: sheriff.id, value: 4, penaltyValue: 1 });

  // Người khai sửa chỉ số phạt ngay sau lần đọc đầu tiên của mod (role/ngày/giá trị chính/chỉ số phụ không đổi).
  let intercepted = false;
  const restore = patchDelegate(testDb.statReport, 'findUnique', (original) =>
    (async (args: Prisma.StatReportFindUniqueArgs) => {
      const row = await original(args);
      if (!intercepted) {
        intercepted = true;
        await updateOwnReport(ctx, member.id, r.id, { penaltyValue: 2 });
      }
      return row;
    }) as never,
  );
  try {
    await expect(reviewReport(ctx, asReviewer(m), r.id, { approve: true })).rejects.toMatchObject({
      code: 'NOT_PENDING',
      message: 'Lần khai vừa được sửa, hãy xem lại',
    });
  } finally {
    restore();
  }
  expect(intercepted).toBe(true);
  expect(await reportRow(r.id)).toMatchObject({ status: 'pending', value: 4, penaltyValue: 2, reviewedById: null });
  expect(notifier.announcements).toEqual([]);

  // Mod xem lại rồi duyệt: tính đúng số mới (4 × 3 − 2 × 1 = 10).
  await reviewReport(ctx, asReviewer(m), r.id, { approve: true });
  expect(await reportRow(r.id)).toMatchObject({ status: 'approved', penaltyValue: 2 });
  expect(notifier.announcements).toEqual(['👑 An đã hoá thân Cảnh sát trưởng mùa 2026-10!']);
});

test('rejection DM of a penalty report reads "x − z"; penaltyValue 0 is not mentioned', async () => {
  const sheriff = await roleByKey(testDb, 'sheriff');
  const m = await mod();
  const r = await submit({ roleId: sheriff.id, value: 4, penaltyValue: 1, playedOn: '2026-10-09' });
  await reviewReport(ctx, asReviewer(m), r.id, { approve: false, reason: 'Thiếu clip' });
  const zero = await submit({ roleId: sheriff.id, value: 2, penaltyValue: 0, playedOn: '2026-10-09' });
  await reviewReport(ctx, asReviewer(m), zero.id, { approve: false, reason: 'Sai ngày' });
  expect(notifier.dms).toEqual([
    { discordId: member.discordId, text: 'Lần khai Cảnh sát trưởng (4 phát bắn trúng kẻ xấu − 1 phát bắn sai) ngày 09/10 bị từ chối: Thiếu clip' },
    { discordId: member.discordId, text: 'Lần khai Cảnh sát trưởng (2 phát bắn trúng kẻ xấu) ngày 09/10 bị từ chối: Sai ngày' },
  ]);
});

test('inactive role rejected', async () => {
  const inquisitor = await roleByKey(testDb, 'inquisitor'); // role chế độ đặc biệt: nạp sẵn nhưng tắt
  expect(inquisitor.active).toBe(false);
  await expect(submit({ roleId: inquisitor.id })).rejects.toMatchObject({ code: 'ROLE_INACTIVE', message: 'Role này đang tắt' });

  // Role bị tắt sau này cũng không khai thêm được.
  await testDb.role.update({ where: { id: duck.id }, data: { active: false } });
  await expect(submit()).rejects.toMatchObject({ code: 'ROLE_INACTIVE' });

  // Role không tồn tại hoặc id sai kiểu là dữ liệu không hợp lệ.
  await expect(submit({ roleId: 9999 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Role không hợp lệ' });
  await expect(submit({ roleId: 1.5 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(submit({ roleId: 0 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(submit({ roleId: -1 })).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await testDb.statReport.count()).toBe(0);
});

test('a member who left (or does not exist) cannot submit', async () => {
  const gone = await createMember(testDb, { status: 'left', leftAt: new Date('2026-10-01T00:00:00Z') });
  await expect(submit({ memberId: gone.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(submit({ memberId: 9999 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await testDb.statReport.count()).toBe(0);
  expect(await testDb.season.count()).toBe(0);
});

test('a closed season refuses new reports even inside the 3-day window', async () => {
  // 12:00 ngày 02/10 VN: cửa sổ 29/09 → 02/10, nhưng mùa 2026-09 đã chốt.
  setNow('2026-10-02T05:00:00Z');
  await ensureSeason(ctx, '2026-09');
  await testDb.season.update({ where: { id: '2026-09' }, data: { closedAt: new Date('2026-10-01T00:00:00Z') } });

  await expect(submit({ playedOn: '2026-09-30' })).rejects.toMatchObject({ code: 'SEASON_CLOSED', message: 'Mùa này đã chốt' });
  await expect(submit({ playedOn: '2026-09-29' })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
  await expect(submit({ playedOn: '2026-10-01' })).resolves.toBeDefined();
  await expect(submit({ playedOn: '2026-10-02' })).resolves.toBeDefined();

  // Mùa chưa có dòng nghĩa là chưa chốt; dòng được tạo khi khai.
  expect(await testDb.season.findUnique({ where: { id: '2026-10' } })).toMatchObject({ closedAt: null });
  expect(await testDb.statReport.count()).toBe(2);
});

test('note is trimmed and limited to 300 characters', async () => {
  await expect(submit({ note: 'x'.repeat(301) })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Ghi chú tối đa 300 ký tự' });
  expect((await submit({ note: 'x'.repeat(300) })).note).toBe('x'.repeat(300));
  // Đếm sau khi cắt khoảng trắng.
  expect((await submit({ note: `  ${'x'.repeat(300)}  ` })).note).toBe('x'.repeat(300));
  expect(await testDb.statReport.count()).toBe(2);
});

test('session must exist and start on the played-on day (VN)', async () => {
  const evening = await createSession(testDb, { startsAt: new Date('2026-10-09T14:00:00Z') }); // 21:00 ngày 09/10 VN
  await expect(submit({ sessionId: evening.id, playedOn: '2026-10-09' })).resolves.toMatchObject({ sessionId: evening.id });
  await expect(submit({ sessionId: evening.id, playedOn: '2026-10-10' })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Buổi chơi không khớp ngày chơi',
  });

  // Buổi 00:30 ngày 10/10 VN (17:30Z ngày 09/10) thuộc ngày 10/10 theo giờ VN.
  const afterMidnight = await createSession(testDb, { startsAt: new Date('2026-10-09T17:30:00Z') });
  await expect(submit({ sessionId: afterMidnight.id, playedOn: '2026-10-10' })).resolves.toMatchObject({ sessionId: afterMidnight.id });
  await expect(submit({ sessionId: afterMidnight.id, playedOn: '2026-10-09' })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Buổi chơi không khớp ngày chơi',
  });

  await expect(submit({ sessionId: 9999 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Buổi chơi không hợp lệ' });
  await expect(submit({ sessionId: 1.5 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(submit({ sessionId: null })).resolves.toMatchObject({ sessionId: null });
  expect(await testDb.statReport.count()).toBe(3);
});

test('31st report of the day is rate limited', async () => {
  for (let i = 0; i < 30; i += 1) await submit({ playedOn: i % 2 === 0 ? '2026-10-10' : '2026-10-09' });
  await expect(submit()).rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'Bạn đã khai quá 30 lần hôm nay' });
  await expect(submit({ roleKey: 'swordsman', playedOn: '2026-10-08' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  expect(await testDb.statReport.count({ where: { memberId: member.id } })).toBe(30);

  // Giới hạn tính theo người: người khác vẫn khai được.
  const other = await createMember(testDb, { displayName: 'Bình' });
  await expect(submit({ memberId: other.id })).resolves.toBeDefined();

  // Lần khai đã duyệt vẫn tính vào số lần khai trong ngày.
  const a = await admin();
  const first = await testDb.statReport.findFirstOrThrow({ where: { memberId: member.id }, orderBy: { id: 'asc' } });
  await reviewReport(ctx, asReviewer(a), first.id, { approve: true });
  await expect(submit()).rejects.toMatchObject({ code: 'RATE_LIMITED' });

  // Ngày tính theo giờ VN: 23:59:59 vẫn là hôm nay, 00:00 (17:00Z) là ngày mới.
  setNow('2026-10-10T16:59:59Z');
  await expect(submit()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  setNow('2026-10-10T17:00:00Z');
  await expect(submit({ playedOn: '2026-10-11' })).resolves.toBeDefined();
  expect(await testDb.statReport.count({ where: { memberId: member.id } })).toBe(31);
});

// ---------------------------------------------------------------------------
// Duyệt
// ---------------------------------------------------------------------------

test('review rules', async () => {
  const m = await mod();
  const a = await admin();
  const ownReportOfMod = await submit({ memberId: m.id });
  const ownReportOfAdmin = await submit({ memberId: a.id });
  const r = await submit();
  const modR = asReviewer(m);

  await expect(reviewReport(ctx, { id: m.id, accessLevel: 'mod' }, ownReportOfMod.id, { approve: true })).rejects.toMatchObject({
    code: 'SELF_REVIEW',
    message: 'Mod không được tự duyệt lần khai của mình',
  });
  await expect(reviewReport(ctx, modR, ownReportOfMod.id, { approve: false, reason: 'Tự từ chối' })).rejects.toMatchObject({ code: 'SELF_REVIEW' });
  await expect(reviewReport(ctx, { id: a.id, accessLevel: 'admin' }, ownReportOfAdmin.id, { approve: true })).resolves.toBeUndefined();
  await expect(reviewReport(ctx, modR, r.id, { approve: false, reason: '  ' })).rejects.toMatchObject({
    code: 'REASON_REQUIRED',
    message: 'Cần ghi lý do từ chối',
  });
  await expect(reviewReport(ctx, modR, r.id, { approve: false, reason: '' })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  await expect(reviewReport(ctx, modR, r.id, { approve: false, reason: 'x'.repeat(201) })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Lý do từ chối tối đa 200 ký tự',
  });
  // Lý do thiếu hẳn (dữ liệu từ ngoài) cũng là thiếu lý do.
  await expect(
    reviewReport(ctx, modR, r.id, { approve: false } as unknown as { approve: false; reason: string }),
  ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });

  // Thành viên thường không duyệt được dù accessLevel được truyền thẳng (phòng thủ nhiều lớp).
  await expect(reviewReport(ctx, asReviewer(member), ownReportOfMod.id, { approve: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(reviewReport(ctx, modR, 9999, { approve: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(reviewReport(ctx, modR, 1.5, { approve: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });

  // Mọi lần từ chối lỗi ở trên không đụng tới lần khai.
  expect(await reportRow(r.id)).toMatchObject({ status: 'pending', reviewedById: null, reviewedAt: null, rejectReason: null });
  expect(await reportRow(ownReportOfMod.id)).toMatchObject({ status: 'pending' });
  expect(await reportRow(ownReportOfAdmin.id)).toMatchObject({
    status: 'approved',
    reviewedById: a.id,
    reviewedAt: new Date(NOW),
    rejectReason: null,
  });

  // Mod duyệt lần khai của người khác; admin duyệt lần khai của mod.
  setNow('2026-10-10T06:00:00Z');
  await expect(reviewReport(ctx, modR, r.id, { approve: true })).resolves.toBeUndefined();
  expect(await reportRow(r.id)).toMatchObject({
    status: 'approved',
    reviewedById: m.id,
    reviewedAt: new Date('2026-10-10T06:00:00Z'),
    rejectReason: null,
    createdAt: new Date(NOW),
  });
  await reviewReport(ctx, asReviewer(a), ownReportOfMod.id, { approve: true });
  expect(await reportRow(ownReportOfMod.id)).toMatchObject({ status: 'approved', reviewedById: a.id });

  // Duyệt không DM ai. Lần duyệt đầu đưa Admin lên hoá thân Vịt → một thông báo; hai lần sau
  // cùng 3 điểm nhưng đạt muộn hơn nên Admin vẫn giữ (chi tiết ở leaderboard.test.ts).
  expect(notifier.dms).toEqual([]);
  expect(notifier.announcements).toEqual(['👑 Admin đã hoá thân Vịt mùa 2026-10!']);
});

test('rejection DMs reporter with reason', async () => {
  const m = await mod();
  const r = await submit({ value: 7, playedOn: '2026-10-08' });

  await expect(reviewReport(ctx, asReviewer(m), r.id, { approve: false, reason: '  Ảnh chụp mờ, không thấy số  ' })).resolves.toBeUndefined();
  expect(await reportRow(r.id)).toMatchObject({
    status: 'rejected',
    reviewedById: m.id,
    reviewedAt: new Date(NOW),
    rejectReason: 'Ảnh chụp mờ, không thấy số',
  });
  expect(notifier.dms).toEqual([
    {
      discordId: member.discordId,
      text: 'Lần khai Vịt (7 mạng đã giết) ngày 08/10 bị từ chối: Ảnh chụp mờ, không thấy số',
    },
  ]);
  expect(notifier.dms[0]?.text).toContain('bị từ chối');
  expect(notifier.dms[0]?.text).toContain('Ảnh chụp mờ, không thấy số');

  // Lý do dài đúng 200 ký tự được nhận; DM dùng lý do đã cắt khoảng trắng.
  const r2 = await submit({ roleKey: 'swordsman', value: 2 });
  await reviewReport(ctx, asReviewer(m), r2.id, { approve: false, reason: 'y'.repeat(200) });
  expect((await reportRow(r2.id)).rejectReason).toBe('y'.repeat(200));
  expect(notifier.dms[1]?.text).toBe(`Lần khai Kiếm sĩ (2 mạng chém) ngày 10/10 bị từ chối: ${'y'.repeat(200)}`);

  // DM lỗi: lần khai vẫn bị từ chối, lỗi chỉ ghi log, hàm không ném.
  const errors = silenceConsoleError();
  const r3 = await submit();
  notifier.failDmFor.add(member.discordId);
  await expect(reviewReport(ctx, asReviewer(m), r3.id, { approve: false, reason: 'Sai role' })).resolves.toBeUndefined();
  expect(await reportRow(r3.id)).toMatchObject({ status: 'rejected', rejectReason: 'Sai role', reviewedById: m.id });
  expect(errors).toHaveBeenCalledTimes(1);
  expect(String(errors.mock.calls[0]?.[0])).toContain(String(r3.id));
  expect(notifier.dms).toHaveLength(2);

  // Discord sập hẳn: như trên.
  notifier.failDmFor.clear();
  notifier.down = true;
  const r4 = await submit();
  await expect(reviewReport(ctx, asReviewer(m), r4.id, { approve: false, reason: 'Trùng' })).resolves.toBeUndefined();
  expect((await reportRow(r4.id)).status).toBe('rejected');
  expect(errors).toHaveBeenCalledTimes(2);
  expect(notifier.announcements).toEqual([]);
});

test('cannot review or edit twice', async () => {
  const m1 = await mod('Mod 1');
  const m2 = await mod('Mod 2');
  const r = await submit();

  await reviewReport(ctx, asReviewer(m1), r.id, { approve: true });
  await expect(reviewReport(ctx, asReviewer(m1), r.id, { approve: true })).rejects.toMatchObject({
    code: 'NOT_PENDING',
    message: 'Lần khai này đã được xử lý',
  });
  await expect(reviewReport(ctx, asReviewer(m2), r.id, { approve: false, reason: 'Muộn' })).rejects.toMatchObject({ code: 'NOT_PENDING' });
  await expect(updateOwnReport(ctx, member.id, r.id, { value: 5 })).rejects.toMatchObject({ code: 'NOT_PENDING' });
  expect(await reportRow(r.id)).toMatchObject({ status: 'approved', reviewedById: m1.id, value: 3, rejectReason: null });

  // Đã từ chối cũng không sửa/duyệt lại được.
  const r2 = await submit();
  await reviewReport(ctx, asReviewer(m1), r2.id, { approve: false, reason: 'Thiếu ảnh' });
  await expect(updateOwnReport(ctx, member.id, r2.id, { value: 5 })).rejects.toMatchObject({ code: 'NOT_PENDING' });
  await expect(reviewReport(ctx, asReviewer(m2), r2.id, { approve: true })).rejects.toMatchObject({ code: 'NOT_PENDING' });
  expect(await reportRow(r2.id)).toMatchObject({ status: 'rejected', reviewedById: m1.id, rejectReason: 'Thiếu ảnh' });
  expect(notifier.dms).toHaveLength(1);
});

test('concurrent reviews by two mods: exactly one wins, the other sees NOT_PENDING', async () => {
  const m1 = await mod('Mod 1');
  const m2 = await mod('Mod 2');
  const r = await submit();

  const [first, second] = await Promise.allSettled([
    reviewReport(ctx, asReviewer(m1), r.id, { approve: true }),
    reviewReport(ctx, asReviewer(m2), r.id, { approve: false, reason: 'Trùng trận' }),
  ]);
  const outcomes = [first, second];
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  const loser = outcomes.find((o) => o.status === 'rejected');
  expect(loser?.status === 'rejected' && loser.reason).toMatchObject({ code: 'NOT_PENDING' });

  const row = await reportRow(r.id);
  if (first.status === 'fulfilled') {
    expect(row).toMatchObject({ status: 'approved', reviewedById: m1.id, rejectReason: null });
    expect(notifier.dms).toEqual([]);
  } else {
    expect(row).toMatchObject({ status: 'rejected', reviewedById: m2.id, rejectReason: 'Trùng trận' });
    expect(notifier.dms).toHaveLength(1);
  }
});

test('a revoked report must carry who, when and why (CHECK)', async () => {
  const m = await mod();
  const a = await admin();
  const r = await submit();
  await reviewReport(ctx, asReviewer(m), r.id, { approve: true });
  const revokedAt = new Date('2026-10-11T03:00:00Z');

  // CHECK `stat_reports_revoked_complete`: `revoked` mà thiếu người huỷ, giờ huỷ hoặc lý do
  // → Postgres 23514 (Prisma bọc trong P2010, mã gốc ở `meta.code`).
  const checkViolation = { code: 'P2010', meta: { code: '23514' } };
  await expect(
    testDb.$executeRaw`UPDATE stat_reports SET status = 'revoked', revoked_at = ${revokedAt}, reject_reason = 'Clip không khớp' WHERE id = ${r.id}`,
  ).rejects.toMatchObject(checkViolation);
  await expect(
    testDb.$executeRaw`UPDATE stat_reports SET status = 'revoked', revoked_by = ${a.id}, reject_reason = 'Clip không khớp' WHERE id = ${r.id}`,
  ).rejects.toMatchObject(checkViolation);
  await expect(
    testDb.$executeRaw`UPDATE stat_reports SET status = 'revoked', revoked_by = ${a.id}, revoked_at = ${revokedAt} WHERE id = ${r.id}`,
  ).rejects.toMatchObject(checkViolation);
  // Ba lần hỏng ở trên không đụng tới lần khai.
  expect(await reportRow(r.id)).toMatchObject({ status: 'approved', revokedById: null, revokedAt: null, rejectReason: null });

  // Đủ cả ba → thành công; người duyệt ban đầu (`reviewed_by`/`reviewed_at`) giữ nguyên.
  await testDb.$executeRaw`UPDATE stat_reports SET status = 'revoked', revoked_by = ${a.id}, revoked_at = ${revokedAt}, reject_reason = 'Clip không khớp' WHERE id = ${r.id}`;
  expect(await reportRow(r.id)).toMatchObject({
    status: 'revoked',
    revokedById: a.id,
    revokedAt,
    rejectReason: 'Clip không khớp',
    reviewedById: m.id,
    reviewedAt: new Date(NOW),
  });
  // Quan hệ `revokedBy` đọc được người huỷ; lần khai bị huỷ không còn là `approved`.
  const withRevoker = await testDb.statReport.findUniqueOrThrow({ where: { id: r.id }, include: { revokedBy: true } });
  expect(withRevoker.revokedBy?.displayName).toBe('Admin');
  expect(await testDb.statReport.count({ where: { status: 'approved' } })).toBe(0);
});

test('a report in a closed season can no longer be reviewed', async () => {
  const m = await mod();
  const r = await submit({ playedOn: '2026-10-09' });
  await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt: ctx.now() } });

  await expect(reviewReport(ctx, asReviewer(m), r.id, { approve: true })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
  await expect(reviewReport(ctx, asReviewer(m), r.id, { approve: false, reason: 'Muộn' })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
  expect(await reportRow(r.id)).toMatchObject({ status: 'pending', reviewedById: null });
  expect(notifier.dms).toEqual([]);

  // Người khai cũng không sửa được lần khai đó nữa (mùa đã chốt).
  await expect(updateOwnReport(ctx, member.id, r.id, { value: 4 })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
});

// ---------------------------------------------------------------------------
// Sửa lần khai của mình
// ---------------------------------------------------------------------------

test('updateOwnReport re-validates the merged report and keeps createdAt', async () => {
  const s = await createSession(testDb, { startsAt: new Date('2026-10-09T14:00:00Z') }); // 21:00 ngày 09/10 VN
  const swordsman = await roleByKey(testDb, 'swordsman');
  const cuckoo = await roleByKey(testDb, 'cuckoo');
  const r = await submit({ note: 'cũ' });

  setNow('2026-10-10T06:00:00Z'); // một giờ sau: createdAt không đổi
  const updated = await updateOwnReport(ctx, member.id, r.id, {
    roleId: swordsman.id,
    value: 15,
    playedOn: '2026-10-09',
    sessionId: s.id,
    note: '  mới  ',
  });
  expect(updated).toEqual({
    ...r,
    roleId: swordsman.id,
    value: 15,
    playedOn: dateOnlyToDb('2026-10-09'),
    sessionId: s.id,
    note: 'mới',
  });
  expect(await reportRow(r.id)).toEqual(updated);

  // Chỉ trường được truyền thay đổi; ghi chú '' → null; sessionId null bỏ buổi; patch rỗng không đổi gì.
  expect(await updateOwnReport(ctx, member.id, r.id, { note: '' })).toMatchObject({ roleId: swordsman.id, value: 15, note: null, sessionId: s.id });
  expect(await updateOwnReport(ctx, member.id, r.id, { sessionId: null })).toMatchObject({ sessionId: null, playedOn: dateOnlyToDb('2026-10-09') });
  expect(await updateOwnReport(ctx, member.id, r.id, {})).toEqual(await reportRow(r.id));

  // Kiểm tra lại trên giá trị gộp: giới hạn theo role hiện tại/mới, ngày, ghi chú, buổi, role tắt.
  await expect(updateOwnReport(ctx, member.id, r.id, { value: 16 })).rejects.toMatchObject({
    code: 'VALUE_OUT_OF_RANGE',
    message: 'Giá trị phải từ 0 đến 15',
  });
  await expect(updateOwnReport(ctx, member.id, r.id, { roleId: cuckoo.id, value: 16 })).resolves.toMatchObject({ roleId: cuckoo.id, value: 16 });
  await expect(updateOwnReport(ctx, member.id, r.id, { roleId: swordsman.id })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' }); // 16 > 15
  await expect(updateOwnReport(ctx, member.id, r.id, { value: -1 })).rejects.toMatchObject({ code: 'VALUE_OUT_OF_RANGE' });
  await expect(updateOwnReport(ctx, member.id, r.id, { playedOn: '2026-10-06' })).rejects.toMatchObject({ code: 'PLAYED_ON_OUT_OF_WINDOW' });
  await expect(updateOwnReport(ctx, member.id, r.id, { playedOn: '2026-10-11' })).rejects.toMatchObject({ code: 'PLAYED_ON_OUT_OF_WINDOW' });
  await expect(updateOwnReport(ctx, member.id, r.id, { playedOn: 'hôm qua' })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Ngày chơi không hợp lệ' });
  await expect(updateOwnReport(ctx, member.id, r.id, { note: 'x'.repeat(301) })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Ghi chú tối đa 300 ký tự' });
  await expect(updateOwnReport(ctx, member.id, r.id, { sessionId: s.id, playedOn: '2026-10-10' })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Buổi chơi không khớp ngày chơi',
  });
  await expect(updateOwnReport(ctx, member.id, r.id, { sessionId: 9999 })).rejects.toMatchObject({ code: 'VALIDATION' });
  const inquisitor = await roleByKey(testDb, 'inquisitor');
  await expect(updateOwnReport(ctx, member.id, r.id, { roleId: inquisitor.id })).rejects.toMatchObject({ code: 'ROLE_INACTIVE' });
  await expect(updateOwnReport(ctx, member.id, r.id, { roleId: 9999 })).rejects.toMatchObject({ code: 'VALIDATION', message: 'Role không hợp lệ' });
  await expect(updateOwnReport(ctx, member.id, r.id, { value: 1, extra: true } as never)).rejects.toMatchObject({ code: 'VALIDATION' });

  // Buổi đã gắn phải vẫn khớp khi chỉ đổi ngày.
  await updateOwnReport(ctx, member.id, r.id, { sessionId: s.id, playedOn: '2026-10-09' });
  await expect(updateOwnReport(ctx, member.id, r.id, { playedOn: '2026-10-10' })).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Buổi chơi không khớp ngày chơi',
  });

  // Mọi lần sửa lỗi ở trên không đổi gì; vẫn pending.
  expect(await reportRow(r.id)).toMatchObject({
    roleId: cuckoo.id,
    value: 16,
    playedOn: dateOnlyToDb('2026-10-09'),
    sessionId: s.id,
    status: 'pending',
    createdAt: new Date(NOW),
  });

  // Không phải của mình hay không tồn tại → NOT_FOUND (không lộ sự tồn tại); người đã rời → FORBIDDEN.
  const other = await createMember(testDb, { displayName: 'Bình' });
  const theirs = await submit({ memberId: other.id });
  await expect(updateOwnReport(ctx, other.id, r.id, { value: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(updateOwnReport(ctx, member.id, 9999, { value: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(updateOwnReport(ctx, member.id, 1.5, { value: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await testDb.member.update({ where: { id: other.id }, data: { status: 'left' } });
  await expect(updateOwnReport(ctx, other.id, theirs.id, { value: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await reportRow(theirs.id)).value).toBe(3);
});

test('editing is not counted against the daily cap and follows the season of the new date', async () => {
  for (let i = 0; i < 30; i += 1) await submit();
  await expect(submit()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  const first = await testDb.statReport.findFirstOrThrow({ where: { memberId: member.id }, orderBy: { id: 'asc' } });
  await expect(updateOwnReport(ctx, member.id, first.id, { value: 4 })).resolves.toMatchObject({ value: 4 });
  await expect(updateOwnReport(ctx, member.id, first.id, { playedOn: '2026-10-09' })).resolves.toMatchObject({ playedOn: dateOnlyToDb('2026-10-09') });

  // Đầu tháng: khai cho ngày cuối tháng trước tạo (và kiểm tra) mùa trước.
  setNow('2026-11-02T05:00:00Z'); // 12:00 ngày 02/11 VN: cửa sổ 30/10 → 02/11
  const r = await submit({ playedOn: '2026-11-01' });
  expect((await testDb.season.findMany({ orderBy: { id: 'asc' } })).map((s) => s.id)).toEqual(['2026-10', '2026-11']);
  await testDb.season.deleteMany({ where: { id: '2026-10' } });
  await updateOwnReport(ctx, member.id, r.id, { playedOn: '2026-10-31' });
  expect((await testDb.season.findMany({ orderBy: { id: 'asc' } })).map((s) => s.id)).toEqual(['2026-10', '2026-11']);

  // Mùa 10 chốt: không kéo lần khai ở mùa 11 về mùa 10 nữa, nhưng lần khai mùa 11 vẫn sửa được.
  await updateOwnReport(ctx, member.id, r.id, { playedOn: '2026-11-01' });
  await testDb.season.update({ where: { id: '2026-10' }, data: { closedAt: ctx.now() } });
  await expect(updateOwnReport(ctx, member.id, r.id, { playedOn: '2026-10-31' })).rejects.toMatchObject({ code: 'SEASON_CLOSED' });
  await expect(updateOwnReport(ctx, member.id, r.id, { value: 5 })).resolves.toMatchObject({ value: 5, playedOn: dateOnlyToDb('2026-11-01') });
});

// ---------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------

test('listMyReports: newest first, own reports only, limited', async () => {
  const other = await createMember(testDb, { displayName: 'Bình' });
  const swordsman = await roleByKey(testDb, 'swordsman');
  const s = await createSession(testDb, { startsAt: new Date('2026-10-09T14:00:00Z') });
  const m = await mod();

  const r1 = await submit({ playedOn: '2026-10-09', sessionId: s.id, note: 'Trận cuối' });
  setNow('2026-10-10T05:00:01Z');
  const r2 = await submit({ roleKey: 'swordsman', value: 5 });
  const r3 = await submit({ value: 1 }); // cùng createdAt với r2 → id lớn hơn đứng trước
  await submit({ memberId: other.id });
  await reviewReport(ctx, asReviewer(m), r1.id, { approve: false, reason: 'Thiếu ảnh' });

  const list = await listMyReports(ctx, member.id);
  const expected: ReportDto[] = [
    {
      id: r3.id,
      member: { id: member.id, displayName: 'An' },
      role: roleDtoOf(duck),
      value: 1,
      extraValue: 0,
      penaltyValue: 0,
      bonusPoints: 0,
      source: 'self',
      points: 1,
      playedOn: '2026-10-10',
      sessionId: null,
      note: null,
      status: 'pending',
      rejectReason: null,
      createdAt: '2026-10-10T05:00:01.000Z',
      highlightUrl: null,
      accusation: null,
      accusationDuplicate: false,
      accusationWaitingFor: null,
      penaltyOf: null,
    },
    {
      id: r2.id,
      member: { id: member.id, displayName: 'An' },
      role: roleDtoOf(swordsman),
      value: 5,
      extraValue: 0,
      penaltyValue: 0,
      bonusPoints: 0,
      source: 'self',
      points: 5,
      playedOn: '2026-10-10',
      sessionId: null,
      note: null,
      status: 'pending',
      rejectReason: null,
      createdAt: '2026-10-10T05:00:01.000Z',
      highlightUrl: null,
      accusation: null,
      accusationDuplicate: false,
      accusationWaitingFor: null,
      penaltyOf: null,
    },
    {
      id: r1.id,
      member: { id: member.id, displayName: 'An' },
      role: roleDtoOf(duck),
      value: 3,
      extraValue: 0,
      penaltyValue: 0,
      bonusPoints: 0,
      source: 'self',
      points: 3,
      playedOn: '2026-10-09',
      sessionId: s.id,
      note: 'Trận cuối',
      status: 'rejected',
      rejectReason: 'Thiếu ảnh',
      createdAt: '2026-10-10T05:00:00.000Z',
      highlightUrl: null,
      accusation: null,
      accusationDuplicate: false,
      accusationWaitingFor: null,
      penaltyOf: null,
    },
  ];
  expect(list).toEqual(expected);
  expect(expected[1]?.role).toEqual({
    id: swordsman.id,
    nameVi: 'Kiếm sĩ',
    icon: '⚔️',
    metricLabel: 'Số mạng chém',
    maxPerGame: 15,
    points: 1,
    extraMetricLabel: null,
    extraMaxPerGame: null,
    extraPoints: null,
    penaltyMetricLabel: null,
    penaltyMaxPerGame: null,
    penaltyPoints: null,
  });
  expect(await listMyReports(ctx, member.id, 2)).toEqual(expected.slice(0, 2));
  expect(await listMyReports(ctx, other.id)).toHaveLength(1);
  expect(await listMyReports(ctx, 9999)).toEqual([]);

  await expect(listMyReports(ctx, member.id, 0)).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(listMyReports(ctx, member.id, 1.5)).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(listMyReports(ctx, member.id, -1)).rejects.toMatchObject({ code: 'VALIDATION' });
});

test('listMyReports defaults to 50 and never returns more than 100', async () => {
  // Nạp thẳng 120 dòng (bỏ qua giới hạn 30/ngày) với createdAt tăng dần.
  await testDb.statReport.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({
      memberId: member.id,
      roleId: duck.id,
      playedOn: dateOnlyToDb('2026-10-10'),
      value: i % 16,
      createdAt: new Date(Date.UTC(2026, 9, 10, 0, 0, i)),
    })),
  });
  const byDefault = await listMyReports(ctx, member.id);
  expect(byDefault).toHaveLength(50);
  expect(byDefault[0]?.createdAt).toBe('2026-10-10T00:01:59.000Z');
  expect(byDefault[49]?.createdAt).toBe('2026-10-10T00:01:10.000Z');
  expect(await listMyReports(ctx, member.id, 100)).toHaveLength(100);
  expect(await listMyReports(ctx, member.id, 500)).toHaveLength(100);
});

test('listPendingReports: oldest first across members, pending only', async () => {
  const other = await createMember(testDb, { displayName: 'Bình' });
  const m = await mod();

  const r1 = await submit();
  setNow('2026-10-10T05:00:01Z');
  const r2 = await submit({ memberId: other.id, roleKey: 'cuckoo', value: 9, note: 'Ba trứng' });
  const r3 = await submit();
  expect((await listPendingReports(ctx)).map((r) => r.id)).toEqual([r1.id, r2.id, r3.id]);

  await reviewReport(ctx, asReviewer(m), r1.id, { approve: true });
  await reviewReport(ctx, asReviewer(m), r3.id, { approve: false, reason: 'Trùng' });
  const pending = await listPendingReports(ctx);
  const cuckoo = await roleByKey(testDb, 'cuckoo');
  expect(pending).toEqual([
    {
      id: r2.id,
      member: { id: other.id, displayName: 'Bình' },
      role: { ...roleDtoOf(cuckoo), nameVi: 'Cò gáy', icon: '🥚', metricLabel: 'Số trứng không bị đập', maxPerGame: 30 },
      value: 9,
      extraValue: 0,
      penaltyValue: 0,
      bonusPoints: 0,
      source: 'self',
      points: 9,
      playedOn: '2026-10-10',
      sessionId: null,
      note: 'Ba trứng',
      status: 'pending',
      rejectReason: null,
      createdAt: '2026-10-10T05:00:01.000Z',
      highlightUrl: null,
      accusation: null,
      accusationDuplicate: false,
      accusationWaitingFor: null,
      penaltyOf: null,
    },
  ]);

  await reviewReport(ctx, asReviewer(m), r2.id, { approve: true });
  expect(await listPendingReports(ctx)).toEqual([]);
});
