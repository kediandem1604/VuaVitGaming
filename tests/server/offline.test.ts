import type { Member } from '@prisma/client';
import { beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { runOfflineJobs } from '../../src/server/modules/offline/jobs.js';
import {
  announceOfflineEvent,
  createOfflineEvent,
  deleteOfflineEvent,
  listOfflineEventsAdmin,
  listUpcomingOfflineEvents,
  updateOfflineEvent,
  voteOfflineEvent,
} from '../../src/server/modules/offline/service.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember } from '../helpers/factories.js';
import type { FakeNotifier } from '../helpers/fakes.js';

let ctx: Ctx;
let notifier: FakeNotifier;
let setNow: (iso: string) => void;
let mod: Member;
let a: Member;
let b: Member;
let c: Member;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier, setNow } = makeTestCtx());
  // Bây giờ: 19:00 Thứ Năm 22/10/2026 giờ VN.
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  a = await createMember(testDb, { displayName: 'An' });
  b = await createMember(testDb, { displayName: 'Bình' });
  c = await createMember(testDb, { displayName: 'Chi' });
});

const base = { title: 'Cafe Ngỗng', startsAt: '2026-10-24T18:30', place: 'Quận 1' };

/** Ghi thẳng một sự kiện (kể cả đã qua, đã đăng sẵn). */
async function rawEvent(o: { title?: string; startsAt: string; voteDeadline?: string | null; closed?: boolean; announced?: boolean }): Promise<number> {
  const row = await testDb.offlineEvent.create({
    data: {
      title: o.title ?? 'Sự kiện',
      startsAt: new Date(o.startsAt),
      place: 'Nhà',
      voteDeadline: o.voteDeadline ? new Date(o.voteDeadline) : null,
      closed: o.closed ?? false,
      announcedAt: o.announced === false ? null : ctx.now(),
      createdById: mod.id,
    },
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Tạo / sửa / xoá
// ---------------------------------------------------------------------------

test('creating stores VN times as UTC, trims, and announces in #thông-báo with escaped markdown', async () => {
  const dto = await createOfflineEvent(ctx, mod.id, {
    title: '  Cafe *Ngỗng*  ',
    startsAt: '2026-10-24T18:30',
    place: 'Quận_1',
    description: 'Mang ~bài~ theo',
    voteDeadline: '2026-10-24T12:00',
  });
  expect(dto).toEqual({
    id: expect.any(Number),
    title: 'Cafe *Ngỗng*',
    startsAt: '2026-10-24T11:30:00.000Z',
    place: 'Quận_1',
    description: 'Mang ~bài~ theo',
    voteDeadline: '2026-10-24T05:00:00.000Z',
    closed: false,
    past: false,
    goingCount: 0,
    notGoingCount: 0,
  });
  expect(notifier.announcements).toEqual([
    '🎉 Offline: **Cafe \\*Ngỗng\\*** — Thứ Bảy 24/10 18:30 tại Quận\\_1\nMang \\~bài\\~ theo\nVote đi được hay không trên web: http://localhost:3000',
  ]);
  const row = await testDb.offlineEvent.findUniqueOrThrow({ where: { id: dto.id } });
  expect(row.announcedAt).not.toBeNull();
  expect(row.createdById).toBe(mod.id);
});

test('without a description the announcement has no empty line; empty description and deadline become null', async () => {
  const dto = await createOfflineEvent(ctx, mod.id, { ...base, description: '   ', voteDeadline: '' });
  expect(dto.description).toBeNull();
  expect(dto.voteDeadline).toBeNull();
  expect(notifier.announcements).toEqual(['🎉 Offline: **Cafe Ngỗng** — Thứ Bảy 24/10 18:30 tại Quận 1\nVote đi được hay không trên web: http://localhost:3000']);
});

test('validation errors carry the spec texts', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ ...base, title: '   ' }, 'Tên 1–80 ký tự'],
    [{ ...base, title: 'x'.repeat(81) }, 'Tên 1–80 ký tự'],
    [{ ...base, place: '' }, 'Địa điểm 1–120 ký tự'],
    [{ ...base, place: 'x'.repeat(121) }, 'Địa điểm 1–120 ký tự'],
    [{ ...base, description: 'x'.repeat(501) }, 'Mô tả tối đa 500 ký tự'],
    [{ ...base, voteDeadline: '2026-10-24T18:31' }, 'Hạn vote phải trước giờ sự kiện'],
    [{ ...base, startsAt: '2026-02-30T10:00' }, 'Thời gian không hợp lệ'],
    [{ ...base, startsAt: '2026-10-24 18:30' }, 'Thời gian không hợp lệ'],
    [{ ...base, voteDeadline: '2026-10-24T25:00' }, 'Hạn vote không hợp lệ'],
  ];
  for (const [input, message] of cases) {
    await expect(createOfflineEvent(ctx, mod.id, input as never)).rejects.toMatchObject({ code: 'VALIDATION', message });
  }
  // Hạn vote đúng bằng giờ sự kiện thì được (≤).
  await expect(createOfflineEvent(ctx, mod.id, { ...base, voteDeadline: base.startsAt })).resolves.toMatchObject({ voteDeadline: '2026-10-24T11:30:00.000Z' });
  expect(await testDb.offlineEvent.count()).toBe(1);
});

test('a Discord failure only logs; the event is kept and the scheduler posts it later', async () => {
  notifier.down = true;
  const dto = await createOfflineEvent(ctx, mod.id, base);
  expect((await testDb.offlineEvent.findUniqueOrThrow({ where: { id: dto.id } })).announcedAt).toBeNull();
  notifier.down = false;
  await runOfflineJobs(ctx);
  expect(notifier.announcements).toHaveLength(1);
  // Đã đăng: chạy lại không đăng trùng.
  await runOfflineJobs(ctx);
  await announceOfflineEvent(ctx, dto.id);
  expect(notifier.announcements).toHaveLength(1);
});

test('the scheduler only backfills events that have not happened yet', async () => {
  await rawEvent({ title: 'Đã qua', startsAt: '2026-10-22T11:00:00Z', announced: false });
  await rawEvent({ title: 'Sắp tới', startsAt: '2026-10-25T11:00:00Z', announced: false });
  await rawEvent({ title: 'Đã đăng', startsAt: '2026-10-26T11:00:00Z' });
  await runOfflineJobs(ctx);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.announcements[0]).toContain('**Sắp tới**');
});

test('updating changes only the sent fields, checks the deadline against the stored start, and toggles closed', async () => {
  const { id } = await createOfflineEvent(ctx, mod.id, { ...base, voteDeadline: '2026-10-24T12:00' });
  const moved = await updateOfflineEvent(ctx, id, { place: 'Quận 3', description: 'Mới' });
  expect(moved).toMatchObject({ title: 'Cafe Ngỗng', place: 'Quận 3', description: 'Mới', voteDeadline: '2026-10-24T05:00:00.000Z' });
  // Dời giờ sự kiện lên trước hạn vote đang lưu → lỗi.
  await expect(updateOfflineEvent(ctx, id, { startsAt: '2026-10-24T11:00' })).rejects.toMatchObject({ message: 'Hạn vote phải trước giờ sự kiện' });
  // Gửi cả hai cùng lúc thì được.
  expect(await updateOfflineEvent(ctx, id, { startsAt: '2026-10-24T11:00', voteDeadline: null })).toMatchObject({ startsAt: '2026-10-24T04:00:00.000Z', voteDeadline: null });
  expect(await updateOfflineEvent(ctx, id, { closed: true })).toMatchObject({ closed: true });
  expect(await updateOfflineEvent(ctx, id, { closed: false })).toMatchObject({ closed: false });
  await expect(updateOfflineEvent(ctx, id, { title: '' })).rejects.toMatchObject({ message: 'Tên 1–80 ký tự' });
  await expect(updateOfflineEvent(ctx, 9999, { closed: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  // Sửa không đăng thêm tin.
  expect(notifier.announcements).toHaveLength(1);
});

test('deleting removes the event and its votes', async () => {
  const { id } = await createOfflineEvent(ctx, mod.id, base);
  await voteOfflineEvent(ctx, a.id, id, true);
  await deleteOfflineEvent(ctx, id);
  expect(await testDb.offlineEvent.count()).toBe(0);
  expect(await testDb.offlineVote.count()).toBe(0);
  await expect(deleteOfflineEvent(ctx, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('the admin list puts upcoming events first (soonest first), then past ones (newest first), with vote counts', async () => {
  const past1 = await rawEvent({ title: 'Cũ 1', startsAt: '2026-10-10T11:00:00Z' });
  const past2 = await rawEvent({ title: 'Cũ 2', startsAt: '2026-10-15T11:00:00Z' });
  const later = await rawEvent({ title: 'Sau', startsAt: '2026-11-05T11:00:00Z' });
  // Sáng nay (đã bắt đầu nhưng vẫn là hôm nay) vẫn tính là sắp tới.
  const today = await rawEvent({ title: 'Hôm nay', startsAt: '2026-10-22T02:00:00Z' });
  await testDb.offlineVote.createMany({
    data: [
      { eventId: later, memberId: a.id, going: true },
      { eventId: later, memberId: b.id, going: true },
      { eventId: later, memberId: c.id, going: false },
    ],
  });
  const list = await listOfflineEventsAdmin(ctx);
  expect(list.map((e) => [e.id, e.past])).toEqual([
    [today, false],
    [later, false],
    [past2, true],
    [past1, true],
  ]);
  expect(list[1]).toMatchObject({ goingCount: 2, notGoingCount: 1 });
});

// ---------------------------------------------------------------------------
// Thành viên: danh sách sắp tới, vote
// ---------------------------------------------------------------------------

test('upcoming lists events from the start of today VN, soonest first, with both groups and my vote', async () => {
  await rawEvent({ title: 'Hôm qua', startsAt: '2026-10-21T16:59:00Z' }); // 23:59 ngày 21 VN
  const later = await rawEvent({ title: 'Tuần sau', startsAt: '2026-10-29T11:00:00Z' });
  const today = await rawEvent({ title: 'Sáng nay', startsAt: '2026-10-21T17:00:00Z' }); // 00:00 ngày 22 VN
  await voteOfflineEvent(ctx, b.id, later, true);
  await voteOfflineEvent(ctx, a.id, later, true);
  await voteOfflineEvent(ctx, c.id, later, false);

  const list = await listUpcomingOfflineEvents(ctx, a.id);
  expect(list.map((e) => e.id)).toEqual([today, later]);
  const event = list[1];
  expect(event?.going.map((p) => p.displayName)).toEqual(['Bình', 'An']);
  expect(event?.notGoing).toEqual([{ memberId: c.id, displayName: 'Chi', avatarUrl: null }]);
  expect(event?.myVote).toBe(true);
  expect(event?.open).toBe(true);
  expect(list[0]?.myVote).toBeNull();
  // Sự kiện sáng nay đã bắt đầu và không có hạn vote: hết vote.
  expect(list[0]?.open).toBe(false);
});

test('voting and changing the vote; the vote endpoint returns the fresh card', async () => {
  const id = await rawEvent({ startsAt: '2026-10-24T11:00:00Z' });
  let dto = await voteOfflineEvent(ctx, a.id, id, true);
  expect(dto).toMatchObject({ myVote: true, going: [{ memberId: a.id }], notGoing: [] });
  dto = await voteOfflineEvent(ctx, a.id, id, false);
  expect(dto).toMatchObject({ myVote: false, going: [], notGoing: [{ memberId: a.id }] });
  expect(await testDb.offlineVote.count()).toBe(1);
  await expect(voteOfflineEvent(ctx, a.id, 9999, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('a passed deadline or a closed event refuses votes with "Đã hết hạn vote"', async () => {
  const deadline = await rawEvent({ startsAt: '2026-10-24T11:00:00Z', voteDeadline: '2026-10-22T12:00:00Z' });
  const closed = await rawEvent({ startsAt: '2026-10-24T11:00:00Z', closed: true });
  const started = await rawEvent({ startsAt: '2026-10-22T11:59:00Z' });
  for (const id of [deadline, closed, started]) {
    await expect(voteOfflineEvent(ctx, a.id, id, true)).rejects.toMatchObject({ code: 'OFFLINE_VOTE_CLOSED', message: 'Đã hết hạn vote', status: 409 });
  }
  // Một phút trước hạn thì vẫn vote được.
  setNow('2026-10-22T11:59:00Z');
  await expect(voteOfflineEvent(ctx, a.id, deadline, true)).resolves.toMatchObject({ open: true, myVote: true });
  const upcoming = await listUpcomingOfflineEvents(ctx, a.id);
  expect(upcoming.find((e) => e.id === closed)?.open).toBe(false);
});
