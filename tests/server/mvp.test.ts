import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { markMemberLeft } from '../../src/server/modules/members/service.js';
import {
  createCategory,
  defaultCategoryIds,
  endOptions,
  listCategories,
  updateCategory,
} from '../../src/server/modules/mvp/categories.js';
import {
  castVote,
  closeDueRounds,
  closeVoteRound,
  getDailyHall,
  listHallDates,
  openVoteRound,
  publishPendingVoteMessages,
  retryRoundResults,
  syncVotes,
  tallyWinners,
} from '../../src/server/modules/mvp/votes.js';
import { autoEndSessions, endSession } from '../../src/server/modules/sessions/end.js';
import { updateSettings } from '../../src/server/modules/settings/service.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession as insertSession } from '../helpers/factories.js';

/** Giờ tham gia tăng dần theo thứ tự gọi `join` trong một test. */
let joinCounter = 0;

beforeEach(async () => {
  await resetDb();
  joinCounter = 0;
});
afterEach(() => vi.restoreAllMocks());

/** Giờ bắt đầu mặc định của buổi: 21:00 ngày 22/10/2026 giờ VN (now mặc định = 19:00 VN). */
const startsAt = new Date('2026-10-22T14:00:00Z');
/** Vote mở 12 giờ kể từ now mặc định (12:00Z) → đóng lúc 00:00Z ngày 23/10. */
const CLOSES_AT = '2026-10-23T00:00:00Z';

const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {});

async function setup() {
  const t = makeTestCtx();
  const admin = await createMember(testDb, { accessLevel: 'admin', displayName: 'Admin' });
  return { ...t, admin };
}

/** Điểm danh `going` thẳng trong DB (không qua Discord); giờ tham gia theo thứ tự gọi. */
async function join(sessionId: number, memberId: number): Promise<void> {
  joinCounter += 1;
  await testDb.attendance.create({
    data: { sessionId, memberId, status: 'going', updatedAt: new Date(Date.UTC(2026, 9, 22, 11, 0, joinCounter)) },
  });
}

const category = (name: string) => testDb.awardCategory.findFirstOrThrow({ where: { name } });
const modeByKey = (key: string) => testDb.gameMode.findUniqueOrThrow({ where: { key } });
const sessionRow = (id: number) => testDb.gameSession.findUniqueOrThrow({ where: { id } });
const roundOf = (sessionId: number) => testDb.voteRound.findUniqueOrThrow({ where: { sessionId } });
const roundRow = (id: number) => testDb.voteRound.findUniqueOrThrow({ where: { id } });
const messagesOf = (roundId: number) =>
  testDb.voteMessage.findMany({
    where: { roundId },
    select: { roundId: true, categoryId: true, discordMessageId: true },
    orderBy: { categoryId: 'asc' },
  });
/** Tin vote kèm cờ "chờ sửa thành kết quả", theo hạng mục. */
const pendingOf = (roundId: number) =>
  testDb.voteMessage.findMany({
    where: { roundId },
    select: { categoryId: true, discordMessageId: true, resultPending: true },
    orderBy: { categoryId: 'asc' },
  });
const awardsOf = (roundId: number) =>
  testDb.award.findMany({ where: { roundId }, orderBy: [{ categoryId: 'asc' }, { memberId: 'asc' }] });

/**
 * Bản sao ctx mà lời gọi `db.$transaction` ĐẦU TIÊN thất bại (DB trục trặc đúng một
 * lần); mọi lời gọi khác đi thẳng tới DB thật. (Không spy lên PrismaClient được: nó là
 * một Proxy, spy không gọi được bản gốc và restore làm hỏng `$transaction`.)
 */
function withOneFailingTransaction(ctx: Ctx): Ctx {
  let failed = false;
  const db = new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === '$transaction' && !failed) {
        return () => {
          failed = true;
          return Promise.reject(new Error('db hiccup'));
        };
      }
      const value = Reflect.get(testDb, prop) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(testDb) : value;
    },
  });
  return { ...ctx, db };
}

/**
 * Bản sao ctx mà lời gọi `db.<model>.<method>` ĐẦU TIÊN (ngoài giao dịch) thất bại —
 * DB trục trặc đúng một lần; mọi lời gọi khác, kể cả `$transaction`, đi thẳng tới DB thật.
 */
function withOneFailingQuery(ctx: Ctx, model: 'voteRound' | 'voteMessage', method: string): Ctx {
  let failed = false;
  const db = new Proxy({} as PrismaClient, {
    get(_target, prop) {
      const value = Reflect.get(testDb, prop) as unknown;
      if (prop === model && typeof value === 'object' && value !== null) {
        return new Proxy(value, {
          get(delegate, name) {
            if (name === method && !failed) {
              return () => {
                failed = true;
                return Promise.reject(new Error('db hiccup'));
              };
            }
            const fn = Reflect.get(delegate, name) as unknown;
            return typeof fn === 'function' ? (fn as (...args: unknown[]) => unknown).bind(delegate) : fn;
          },
        });
      }
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(testDb) : value;
    },
  });
  return { ...ctx, db };
}

/** Buổi classic (hoặc `modeKey`) có người tham gia tên `names`, theo thứ tự. */
async function sessionWith(names: string[], p: Parameters<typeof insertSession>[1] = {}) {
  const session = await insertSession(testDb, p);
  const members = [];
  for (const displayName of names) {
    const m = await createMember(testDb, { displayName });
    await join(session.id, m.id);
    members.push(m);
  }
  return { session, members };
}

// ---------------------------------------------------------------------------
// Hạng mục
// ---------------------------------------------------------------------------

test('end options preselect always and matching mode only', async () => {
  const { ctx } = await setup();
  const goose = await insertSession(testDb, { modeKey: 'goose_hunt' });
  const classic = await insertSession(testDb);

  const opts = await endOptions(ctx, goose.id);
  expect(opts.map((o) => [o.name, o.scope, o.preselected])).toEqual([
    ['Giết nhiều nhất', 'always', true],
    ['Pha xử lý ngu nhất', 'always', true],
    ['Pha dí người ngu nhất', 'always', true],
    ['Ngỗng chạy giỏi nhất', 'mode', true],
    ['Pha đẻ trứng lộ liễu nhất (Cò gáy)', 'optional', false],
    ['Pha chém lố nhất (Kiếm sĩ)', 'optional', false],
  ]);
  const seeded = await listCategories(ctx);
  expect(opts.map((o) => o.id)).toEqual(seeded.map((c) => c.id));

  // Buổi classic không có hạng mục của Săn ngỗng.
  const classicOpts = await endOptions(ctx, classic.id);
  expect(classicOpts.map((o) => o.name)).toEqual([
    'Giết nhiều nhất',
    'Pha xử lý ngu nhất',
    'Pha dí người ngu nhất',
    'Pha đẻ trứng lộ liễu nhất (Cò gáy)',
    'Pha chém lố nhất (Kiếm sĩ)',
  ]);
  expect(classicOpts.map((o) => o.preselected)).toEqual([true, true, true, false, false]);

  // Hạng mục đã ẩn không được đưa ra.
  await updateCategory(ctx, (await category('Pha dí người ngu nhất')).id, { active: false });
  expect((await endOptions(ctx, goose.id)).map((o) => o.name)).not.toContain('Pha dí người ngu nhất');
  expect(await endOptions(ctx, goose.id)).toHaveLength(5);

  await expect(endOptions(ctx, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('default category ids are the preselected ones, in sort order', async () => {
  const { ctx } = await setup();
  const gooseMode = await modeByKey('goose_hunt');
  const classicMode = await modeByKey('classic');
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');
  const chase = await category('Pha dí người ngu nhất');
  const runner = await category('Ngỗng chạy giỏi nhất');

  expect(await defaultCategoryIds(ctx, gooseMode.id)).toEqual([kills.id, dumb.id, chase.id, runner.id]);
  expect(await defaultCategoryIds(ctx, classicMode.id)).toEqual([kills.id, dumb.id, chase.id]);

  // Thứ tự theo sortOrder, không theo id; hạng mục ẩn bị loại.
  await updateCategory(ctx, kills.id, { sortOrder: 10 });
  expect(await defaultCategoryIds(ctx, classicMode.id)).toEqual([dumb.id, chase.id, kills.id]);
  await updateCategory(ctx, kills.id, { active: false });
  expect(await defaultCategoryIds(ctx, classicMode.id)).toEqual([dumb.id, chase.id]);
});

test('categories: create, update, list and validation', async () => {
  const { ctx } = await setup();
  const gooseMode = await modeByKey('goose_hunt');

  const created = await createCategory(ctx, {
    scope: 'optional',
    name: '  Pha trốn hay nhất  ',
    description: '  Dành cho vịt  ',
  });
  expect(created).toMatchObject({
    scope: 'optional',
    modeId: null,
    name: 'Pha trốn hay nhất',
    description: 'Dành cho vịt',
    active: true,
    sortOrder: 7, // mặc định: sau hạng mục cuối cùng
  });
  const modeCat = await createCategory(ctx, { scope: 'mode', modeId: gooseMode.id, name: 'Vịt săn giỏi nhất', sortOrder: 2 });
  expect(modeCat).toMatchObject({ scope: 'mode', modeId: gooseMode.id, description: null, sortOrder: 2 });

  // Danh sách theo sortOrder rồi id (cùng sortOrder 2: hạng mục mẫu đứng trước).
  expect((await listCategories(ctx)).map((c) => c.name)).toEqual([
    'Giết nhiều nhất',
    'Pha xử lý ngu nhất',
    'Vịt săn giỏi nhất',
    'Pha dí người ngu nhất',
    'Ngỗng chạy giỏi nhất',
    'Pha đẻ trứng lộ liễu nhất (Cò gáy)',
    'Pha chém lố nhất (Kiếm sĩ)',
    'Pha trốn hay nhất',
  ]);

  const rejects = (p: Promise<unknown>, message?: string) =>
    expect(p).rejects.toMatchObject(message === undefined ? { code: 'VALIDATION' } : { code: 'VALIDATION', message });

  await rejects(createCategory(ctx, { scope: 'mode', name: 'X' }), 'Hạng mục theo chế độ phải chọn chế độ chơi');
  await rejects(createCategory(ctx, { scope: 'mode', modeId: null, name: 'X' }), 'Hạng mục theo chế độ phải chọn chế độ chơi');
  await rejects(createCategory(ctx, { scope: 'always', modeId: gooseMode.id, name: 'X' }), 'Chỉ hạng mục theo chế độ mới có chế độ chơi');
  await rejects(createCategory(ctx, { scope: 'optional', modeId: gooseMode.id, name: 'X' }), 'Chỉ hạng mục theo chế độ mới có chế độ chơi');
  await rejects(createCategory(ctx, { scope: 'mode', modeId: 9999, name: 'X' }), 'Chế độ chơi không hợp lệ');
  await rejects(createCategory(ctx, { scope: 'always', name: '   ' }));
  await rejects(createCategory(ctx, { scope: 'always', name: 'x'.repeat(81) }));
  await rejects(createCategory(ctx, { scope: 'always', name: 'X', description: 'x'.repeat(201) }));
  await rejects(createCategory(ctx, { scope: 'always', name: 'X', sortOrder: 1.5 }));
  expect(await testDb.awardCategory.count()).toBe(8);

  // Các biên hợp lệ: tên 80 ký tự, mô tả 200 ký tự; mô tả rỗng → null.
  const edge = await createCategory(ctx, { scope: 'always', name: 'x'.repeat(80), description: 'y'.repeat(200) });
  expect(edge).toMatchObject({ name: 'x'.repeat(80), description: 'y'.repeat(200), sortOrder: 8 });
  expect((await createCategory(ctx, { scope: 'always', name: 'Trống', description: '   ' })).description).toBeNull();

  // Sửa: chỉ các trường được truyền; mô tả rỗng → null; ẩn thì không còn trong danh sách mặc định.
  const updated = await updateCategory(ctx, created.id, {
    name: ' Pha trốn đỉnh nhất ',
    description: '',
    active: false,
    sortOrder: 0,
  });
  expect(updated).toMatchObject({
    id: created.id,
    scope: 'optional',
    name: 'Pha trốn đỉnh nhất',
    description: null,
    active: false,
    sortOrder: 0,
  });
  expect((await listCategories(ctx)).map((c) => c.id)).not.toContain(created.id);
  expect((await listCategories(ctx, { includeInactive: true }))[0]?.id).toBe(created.id);

  // Quy tắc phạm vi ⇔ chế độ được kiểm tra trên dòng sau khi gộp bản vá.
  await rejects(updateCategory(ctx, created.id, { scope: 'mode' }), 'Hạng mục theo chế độ phải chọn chế độ chơi');
  await rejects(updateCategory(ctx, modeCat.id, { scope: 'always' }), 'Chỉ hạng mục theo chế độ mới có chế độ chơi');
  await rejects(updateCategory(ctx, modeCat.id, { modeId: 9999 }), 'Chế độ chơi không hợp lệ');
  await rejects(updateCategory(ctx, modeCat.id, { name: '' }));
  expect(await updateCategory(ctx, modeCat.id, { scope: 'always', modeId: null })).toMatchObject({
    scope: 'always',
    modeId: null,
  });
  expect(await updateCategory(ctx, created.id, { scope: 'mode', modeId: gooseMode.id })).toMatchObject({
    scope: 'mode',
    modeId: gooseMode.id,
  });
  await expect(updateCategory(ctx, 999, { name: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

// ---------------------------------------------------------------------------
// Kết thúc buổi, mở vote
// ---------------------------------------------------------------------------

test('ending a session with no attendees opens no round', async () => {
  const { ctx, notifier } = await setup();
  const s = await insertSession(testDb);
  await endSession(ctx, s.id);
  expect((await testDb.gameSession.findUnique({ where: { id: s.id } }))!.status).toBe('ended');
  expect(await testDb.voteRound.count()).toBe(0);
  expect(notifier.votes).toHaveLength(0);

  // Buổi được ghi giờ kết thúc và tin Discord được sửa sang "Đã kết thúc".
  expect(await sessionRow(s.id)).toMatchObject({ endedAt: ctx.now(), discordDirty: false, discordMessageId: 'msg-1' });
  expect(notifier.published).toHaveLength(1);
  expect(notifier.published[0]).toMatchObject({ id: s.id, status: 'ended' });
  expect(notifier.announcements).toEqual([]);

  // Người tham gia duy nhất đã rời server → không có ứng viên → cũng không mở vote.
  const s2 = await insertSession(testDb);
  const gone = await createMember(testDb, { status: 'left' });
  await join(s2.id, gone.id);
  await endSession(ctx, s2.id);
  expect((await sessionRow(s2.id)).status).toBe('ended');
  expect(await testDb.voteRound.count()).toBe(0);
  expect(notifier.votes).toHaveLength(0);

  // openVoteRound trực tiếp: không hạng mục hoặc không người → null, không gọi Discord.
  const kills = await category('Giết nhiều nhất');
  const { session: s3 } = await sessionWith(['An']);
  expect(await openVoteRound(ctx, s3.id, [])).toBeNull();
  expect(await openVoteRound(ctx, s.id, [kills.id])).toBeNull();
  expect(await testDb.voteRound.count()).toBe(0);
  expect(await testDb.voteMessage.count()).toBe(0);
  expect(notifier.votes).toHaveLength(0);
});

test('ending is refused when the session is not scheduled or does not exist', async () => {
  const { ctx, notifier } = await setup();
  const { session: s } = await sessionWith(['An']);
  await endSession(ctx, s.id);
  const after = await sessionRow(s.id);

  await expect(endSession(ctx, s.id)).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
  expect(await sessionRow(s.id)).toEqual(after);
  expect(await testDb.voteRound.count()).toBe(1);

  const cancelled = await insertSession(testDb, { status: 'cancelled' });
  await expect(endSession(ctx, cancelled.id)).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
  expect((await sessionRow(cancelled.id)).status).toBe('cancelled');

  await expect(endSession(ctx, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(endSession(ctx, 999, [])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(notifier.votes).toHaveLength(3);
});

test('ending a session and opening its vote round is one transaction', async () => {
  const { ctx, notifier } = await setup();
  const { session: s } = await sessionWith(['An']);

  // DB trục trặc giữa chừng: không có buổi "đã kết thúc mà không có vote" — mọi thứ hoàn tác.
  await expect(endSession(withOneFailingTransaction(ctx), s.id)).rejects.toThrow('db hiccup');
  expect(await sessionRow(s.id)).toMatchObject({ status: 'scheduled', endedAt: null, discordDirty: false });
  expect(await testDb.voteRound.count()).toBe(0);
  expect(await testDb.voteMessage.count()).toBe(0);
  expect(notifier.published).toHaveLength(0);
  expect(notifier.votes).toHaveLength(0);

  // Lần sau kết thúc trọn vẹn: buổi `ended`, tin buổi sửa, vote mở và đăng.
  await endSession(ctx, s.id);
  expect(await sessionRow(s.id)).toMatchObject({ status: 'ended', endedAt: ctx.now(), discordDirty: false });
  expect(await roundOf(s.id)).toMatchObject({ status: 'open', closesAt: new Date(CLOSES_AT) });
  expect(notifier.published[0]).toMatchObject({ id: s.id, status: 'ended' });
  expect(notifier.votes).toHaveLength(3);
});

test('ending with an inapplicable category is refused and the session stays scheduled', async () => {
  const { ctx, notifier } = await setup();
  const { session: s } = await sessionWith(['An']);
  const kills = await category('Giết nhiều nhất');
  const runner = await category('Ngỗng chạy giỏi nhất'); // chỉ cho Săn ngỗng
  const chase = await category('Pha dí người ngu nhất');
  await updateCategory(ctx, chase.id, { active: false });

  const rejects = (ids: number[]) =>
    expect(endSession(ctx, s.id, ids)).rejects.toMatchObject({ code: 'VALIDATION', message: 'Hạng mục không hợp lệ' });
  await rejects([kills.id, runner.id]);
  await rejects([9999]);
  await rejects([chase.id]);
  await rejects([Number.NaN]);

  expect(await sessionRow(s.id)).toMatchObject({ status: 'scheduled', endedAt: null, discordMessageId: null });
  expect(await testDb.voteRound.count()).toBe(0);
  expect(notifier.published).toHaveLength(0);
  expect(notifier.votes).toHaveLength(0);

  // Danh sách rỗng tường minh: kết thúc buổi nhưng không mở vote.
  await endSession(ctx, s.id, []);
  expect((await sessionRow(s.id)).status).toBe('ended');
  expect(await testDb.voteRound.count()).toBe(0);
  expect(notifier.votes).toHaveLength(0);
});

test('one vote message per chosen category', async () => {
  const { ctx, notifier } = await setup();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  const egg = await category('Pha đẻ trứng lộ liễu nhất (Cò gáy)');
  await testDb.awardCategory.update({ where: { id: egg.id }, data: { description: 'Cò gáy đẻ trứng bị bắt quả tang' } });

  // Trùng id và thứ tự tuỳ ý: mỗi hạng mục một tin, theo sortOrder.
  await endSession(ctx, s.id, [egg.id, kills.id, kills.id]);

  const round = await roundOf(s.id);
  expect(round).toMatchObject({
    status: 'open',
    opensAt: new Date('2026-10-22T12:00:00Z'),
    closesAt: new Date(CLOSES_AT),
  });
  expect(await sessionRow(s.id)).toMatchObject({ status: 'ended', endedAt: ctx.now(), discordDirty: false });

  expect(notifier.votes).toHaveLength(2);
  expect(notifier.votes[0]).toEqual({
    roundId: round.id,
    categoryId: kills.id,
    categoryName: 'Giết nhiều nhất',
    description: null,
    sessionLabel: 'Cổ điển (Classic) 21:00 22/10',
    closesAt: new Date(CLOSES_AT),
    nominees: [
      { memberId: a.id, displayName: 'An' },
      { memberId: b.id, displayName: 'Bình' },
    ],
  });
  expect(notifier.votes[1]).toMatchObject({
    categoryId: egg.id,
    categoryName: 'Pha đẻ trứng lộ liễu nhất (Cò gáy)',
    description: 'Cò gáy đẻ trứng bị bắt quả tang',
  });
  // Tin buổi được sửa trước (msg-1), rồi mới tới các tin vote.
  expect(notifier.published[0]).toMatchObject({ id: s.id, status: 'ended' });
  expect(await messagesOf(round.id)).toEqual([
    { roundId: round.id, categoryId: kills.id, discordMessageId: 'msg-2' },
    { roundId: round.id, categoryId: egg.id, discordMessageId: 'msg-3' },
  ]);

  // Mở lại cho cùng buổi: trả về đợt đã có, không tạo thêm gì.
  expect(await openVoteRound(ctx, s.id, [kills.id])).toBe(round.id);
  expect(await testDb.voteRound.count()).toBe(1);
  expect(await testDb.voteMessage.count()).toBe(2);
  expect(notifier.votes).toHaveLength(2);
});

test('ending without a choice uses the always and matching mode categories', async () => {
  const { ctx, notifier } = await setup();
  const { session: goose } = await sessionWith(['An'], { modeKey: 'goose_hunt' });
  await endSession(ctx, goose.id);
  expect(notifier.votes.map((v) => v.categoryName)).toEqual([
    'Giết nhiều nhất',
    'Pha xử lý ngu nhất',
    'Pha dí người ngu nhất',
    'Ngỗng chạy giỏi nhất',
  ]);
  expect(notifier.votes[0]?.sessionLabel).toBe('Săn ngỗng (Goose Hunt) 21:00 22/10');

  // Thời lượng vote lấy từ cài đặt.
  await updateSettings(ctx, { voteDurationHours: 2 });
  const { session: classic } = await sessionWith(['Bình']);
  await endSession(ctx, classic.id);
  expect((await roundOf(classic.id)).closesAt).toEqual(new Date('2026-10-22T14:00:00Z'));
  expect(notifier.votes.slice(4).map((v) => v.categoryName)).toEqual([
    'Giết nhiều nhất',
    'Pha xử lý ngu nhất',
    'Pha dí người ngu nhất',
  ]);
});

test('vote messages published later when Discord was down', async () => {
  const { ctx, notifier } = await setup();
  const errors = silenceConsoleError();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');

  notifier.down = true;
  await endSession(ctx, s.id, [kills.id, dumb.id]);

  // Dữ liệu vẫn lưu: buổi kết thúc (tin chờ đăng bù), đợt vote mở, tin vote chưa có id.
  expect(await sessionRow(s.id)).toMatchObject({ status: 'ended', discordDirty: true, discordMessageId: null });
  const round = await roundOf(s.id);
  expect(round.status).toBe('open');
  expect(await messagesOf(round.id)).toEqual([
    { roundId: round.id, categoryId: kills.id, discordMessageId: null },
    { roundId: round.id, categoryId: dumb.id, discordMessageId: null },
  ]);
  expect(notifier.votes).toHaveLength(0);
  expect(errors).toHaveBeenCalledTimes(3); // 1 tin buổi + 2 tin vote
  expect(errors.mock.calls[1]?.[0]).toContain(String(round.id));

  // Vote vẫn bấm được dù tin Discord chưa đăng (vd qua web sau này).
  await castVote(ctx, { roundId: round.id, categoryId: kills.id, voterId: b.id, nomineeId: a.id });

  notifier.down = false;
  await publishPendingVoteMessages(ctx);
  expect(notifier.votes.map((v) => v.categoryName)).toEqual(['Giết nhiều nhất', 'Pha xử lý ngu nhất']);
  expect(notifier.votes[0]).toMatchObject({
    roundId: round.id,
    sessionLabel: 'Cổ điển (Classic) 21:00 22/10',
    closesAt: new Date(CLOSES_AT),
    nominees: [
      { memberId: a.id, displayName: 'An' },
      { memberId: b.id, displayName: 'Bình' },
    ],
  });
  expect(await messagesOf(round.id)).toEqual([
    { roundId: round.id, categoryId: kills.id, discordMessageId: 'msg-1' },
    { roundId: round.id, categoryId: dumb.id, discordMessageId: 'msg-2' },
  ]);

  // Chạy lại: không còn gì để đăng.
  await publishPendingVoteMessages(ctx);
  expect(notifier.votes).toHaveLength(2);
  expect(errors).toHaveBeenCalledTimes(3);
});

test('a failing vote message does not block the others and is retried next time', async () => {
  const { ctx, notifier } = await setup();
  const errors = silenceConsoleError();
  const { session: s } = await sessionWith(['An']);
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');
  notifier.down = true;
  await endSession(ctx, s.id, [kills.id, dumb.id]);
  notifier.down = false;
  errors.mockClear();
  const round = await roundOf(s.id);

  vi.spyOn(notifier, 'publishVote').mockRejectedValueOnce(new Error('Discord lỗi'));
  await expect(publishPendingVoteMessages(ctx)).resolves.toBeUndefined();
  expect(await messagesOf(round.id)).toEqual([
    { roundId: round.id, categoryId: kills.id, discordMessageId: null },
    { roundId: round.id, categoryId: dumb.id, discordMessageId: 'msg-1' },
  ]);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(errors.mock.calls[0]?.[0]).toContain(String(kills.id));

  await publishPendingVoteMessages(ctx);
  expect(await messagesOf(round.id)).toEqual([
    { roundId: round.id, categoryId: kills.id, discordMessageId: 'msg-2' },
    { roundId: round.id, categoryId: dumb.id, discordMessageId: 'msg-1' },
  ]);
  expect(notifier.votes.map((v) => v.categoryName)).toEqual(['Pha xử lý ngu nhất', 'Giết nhiều nhất']);
});

test('vote messages are not published after closesAt or once the round is closed', async () => {
  const { ctx, notifier, setNow } = await setup();
  silenceConsoleError();
  const kills = await category('Giết nhiều nhất');

  const { session: s1 } = await sessionWith(['An']);
  const { session: s2 } = await sessionWith(['Bình']);
  notifier.down = true;
  await endSession(ctx, s1.id, [kills.id]);
  await endSession(ctx, s2.id, [kills.id]);
  notifier.down = false;

  // s2 đóng sớm (vẫn còn trước giờ đóng): không đăng nữa.
  const r2 = await roundOf(s2.id);
  await closeVoteRound(ctx, r2.id);
  await publishPendingVoteMessages(ctx);
  expect(notifier.votes.map((v) => v.roundId)).toEqual([(await roundOf(s1.id)).id]);

  // Qua giờ đóng mà tin chưa đăng được: thôi, không đăng tin vote đã hết hạn.
  const { session: s3 } = await sessionWith(['Chi']);
  notifier.down = true;
  await endSession(ctx, s3.id, [kills.id]);
  notifier.down = false;
  setNow(CLOSES_AT);
  await publishPendingVoteMessages(ctx);
  expect(notifier.votes).toHaveLength(1);
  expect((await messagesOf((await roundOf(s3.id)).id))[0]?.discordMessageId).toBeNull();
});

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

test('vote rules', async () => {
  const { ctx } = await setup();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const outsider = await createMember(testDb, { displayName: 'Người ngoài' });
  const kills = await category('Giết nhiều nhất');
  const egg = await category('Pha đẻ trứng lộ liễu nhất (Cò gáy)');
  await endSession(ctx, s.id);
  const roundId = (await roundOf(s.id)).id;
  const categoryId = kills.id;

  await expect(castVote(ctx, { roundId, categoryId, voterId: a.id, nomineeId: a.id })).rejects.toMatchObject({ code: 'SELF_VOTE' });
  await expect(castVote(ctx, { roundId, categoryId, voterId: a.id, nomineeId: outsider.id })).rejects.toMatchObject({ code: 'NOT_NOMINEE' });
  await castVote(ctx, { roundId, categoryId, voterId: outsider.id, nomineeId: a.id });   // cả server được vote
  await castVote(ctx, { roundId, categoryId, voterId: outsider.id, nomineeId: b.id });   // đổi phiếu
  expect(await testDb.vote.count()).toBe(1);
  expect(await testDb.vote.findMany()).toEqual([
    { roundId, categoryId, voterId: outsider.id, nomineeId: b.id, updatedAt: ctx.now() },
  ]);

  // Đợt không có; hạng mục không thuộc đợt; người vote không có hồ sơ hoặc đã rời server.
  await expect(castVote(ctx, { roundId: 999, categoryId, voterId: a.id, nomineeId: b.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(castVote(ctx, { roundId, categoryId: egg.id, voterId: a.id, nomineeId: b.id })).rejects.toMatchObject({ code: 'CATEGORY_NOT_IN_ROUND' });
  await expect(castVote(ctx, { roundId, categoryId, voterId: 999, nomineeId: b.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const left = await createMember(testDb, { status: 'left' });
  await expect(castVote(ctx, { roundId, categoryId, voterId: left.id, nomineeId: b.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  // Người đã rời buổi (điểm danh `cancelled`) không còn là ứng viên.
  const quitter = await createMember(testDb, { displayName: 'Bỏ về' });
  await testDb.attendance.create({ data: { sessionId: s.id, memberId: quitter.id, status: 'cancelled' } });
  await expect(castVote(ctx, { roundId, categoryId, voterId: a.id, nomineeId: quitter.id })).rejects.toMatchObject({ code: 'NOT_NOMINEE' });
  // Tự vote bị chặn trước cả khi xét ứng viên; người tham gia vote nhau bình thường.
  await expect(castVote(ctx, { roundId, categoryId, voterId: outsider.id, nomineeId: outsider.id })).rejects.toMatchObject({ code: 'SELF_VOTE' });
  await castVote(ctx, { roundId, categoryId, voterId: a.id, nomineeId: b.id });
  await castVote(ctx, { roundId, categoryId, voterId: b.id, nomineeId: a.id });
  expect(await testDb.vote.count()).toBe(3);

  await expect(castVote(ctx, { roundId: 1.5, categoryId, voterId: a.id, nomineeId: b.id })).rejects.toMatchObject({ code: 'VALIDATION' });
});

test('a member who left the server cannot vote and is no longer a nominee', async () => {
  const { ctx, notifier } = await setup();
  silenceConsoleError();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  notifier.down = true;
  await endSession(ctx, s.id, [kills.id]);
  const roundId = (await roundOf(s.id)).id;
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: a.id, nomineeId: b.id });

  // Bình rời server sau khi buổi kết thúc: dòng điểm danh vẫn `going` (lịch sử), nhưng không được vote, không được đề cử.
  await markMemberLeft(ctx, b.discordId);
  expect((await testDb.attendance.findUniqueOrThrow({ where: { sessionId_memberId: { sessionId: s.id, memberId: b.id } } })).status).toBe('going');
  await expect(castVote(ctx, { roundId, categoryId: kills.id, voterId: b.id, nomineeId: a.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(castVote(ctx, { roundId, categoryId: kills.id, voterId: a.id, nomineeId: b.id })).rejects.toMatchObject({ code: 'NOT_NOMINEE' });

  notifier.down = false;
  await publishPendingVoteMessages(ctx);
  expect(notifier.votes[0]?.nominees).toEqual([{ memberId: a.id, displayName: 'An' }]);
});

test('voting after closesAt fails', async () => {
  const { ctx, setNow } = await setup();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  await endSession(ctx, s.id);
  const roundId = (await roundOf(s.id)).id;
  const vote = { roundId, categoryId: kills.id, voterId: a.id, nomineeId: b.id };

  setNow('2026-10-22T23:59:59.999Z');
  await castVote(ctx, vote);
  setNow(CLOSES_AT);
  await expect(castVote(ctx, vote)).rejects.toMatchObject({ code: 'ROUND_CLOSED', message: 'Vote đã đóng' });

  // Đóng sớm: dù chưa tới giờ cũng không vote được nữa.
  setNow('2026-10-22T13:00:00Z');
  await closeVoteRound(ctx, roundId);
  await expect(castVote(ctx, vote)).rejects.toMatchObject({ code: 'ROUND_CLOSED' });
  expect(await testDb.vote.count()).toBe(1);
});

test('tally', () => {
  expect(tallyWinners([1, 1, 2])).toEqual([{ memberId: 1, voteCount: 2 }]);
  expect(tallyWinners([1, 2])).toEqual([{ memberId: 1, voteCount: 1 }, { memberId: 2, voteCount: 1 }]);
  expect(tallyWinners([])).toEqual([]);
  // Hoà: mọi người cùng số phiếu cao nhất, theo memberId tăng dần (R6).
  expect(tallyWinners([7, 3, 3, 7, 5])).toEqual([{ memberId: 3, voteCount: 2 }, { memberId: 7, voteCount: 2 }]);
});

// ---------------------------------------------------------------------------
// Đóng vote
// ---------------------------------------------------------------------------

test('close is idempotent and announces once', async () => {
  const { ctx, notifier } = await setup();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const a = members[0]!;
  const outsider = await createMember(testDb);
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');
  await endSession(ctx, s.id, [kills.id, dumb.id]);
  const roundId = (await roundOf(s.id)).id;
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: outsider.id, nomineeId: a.id });

  await closeVoteRound(ctx, roundId); await closeVoteRound(ctx, roundId);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.announcements[0]).toContain('Không ai được vote');
  expect(await testDb.award.count()).toBe(1);

  expect(notifier.announcements[0]).toBe(
    '🏆 Kết quả tri ân buổi Cổ điển (Classic) 21:00 22/10\n' +
      '• Giết nhiều nhất: An (1 phiếu)\n' +
      '• Pha xử lý ngu nhất: Không ai được vote',
  );
  expect(await awardsOf(roundId)).toEqual([{ roundId, categoryId: kills.id, memberId: a.id, voteCount: 1 }]);
  expect(await roundRow(roundId)).toMatchObject({ status: 'closed', announcePending: false });
  expect(notifier.closedVotes).toEqual([
    { messageId: 'msg-2', resultText: '🏆 An (1 phiếu)' },
    { messageId: 'msg-3', resultText: 'Không ai được vote' },
  ]);
  // Discord đã nhận hết: không còn gì chờ đăng bù.
  expect((await pendingOf(roundId)).map((m) => m.resultPending)).toEqual([false, false]);
  await retryRoundResults(ctx);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.closedVotes).toHaveLength(2);
  // Đợt không tồn tại: không làm gì, không ném lỗi.
  await expect(closeVoteRound(ctx, 999)).resolves.toBeUndefined();
  expect(notifier.announcements).toHaveLength(1);
});

test('concurrent closers announce once and never duplicate awards', async () => {
  const { ctx, notifier } = await setup();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  await endSession(ctx, s.id, [kills.id]);
  const roundId = (await roundOf(s.id)).id;
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: a.id, nomineeId: b.id });

  await Promise.all([closeVoteRound(ctx, roundId), closeVoteRound(ctx, roundId)]);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.closedVotes).toHaveLength(1);
  expect(await awardsOf(roundId)).toEqual([{ roundId, categoryId: kills.id, memberId: b.id, voteCount: 1 }]);
  expect((await roundRow(roundId)).status).toBe('closed');
});

test('ties crown everyone with the top count, listed by member id', async () => {
  const { ctx, notifier } = await setup();
  const { session: s, members } = await sessionWith(['An', 'Bình', 'Chi']);
  const [a, b, c] = members as [typeof members[0], typeof members[0], typeof members[0]];
  const voters = await Promise.all([1, 2, 3, 4].map((i) => createMember(testDb, { discordId: `v${i}` })));
  const [x, y, z, w] = voters as [typeof voters[0], typeof voters[0], typeof voters[0], typeof voters[0]];
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');
  const chase = await category('Pha dí người ngu nhất');
  await endSession(ctx, s.id);
  const roundId = (await roundOf(s.id)).id;

  // Giết nhiều nhất: An 2 – Bình 2 – Chi 1 → An, Bình. Pha xử lý ngu nhất: Chi 1 → Chi.
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: x.id, nomineeId: b.id });
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: y.id, nomineeId: a.id });
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: z.id, nomineeId: b.id });
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: w.id, nomineeId: a.id });
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: a.id, nomineeId: c.id });
  await castVote(ctx, { roundId, categoryId: dumb.id, voterId: x.id, nomineeId: c.id });
  await closeVoteRound(ctx, roundId);

  expect(notifier.announcements).toEqual([
    '🏆 Kết quả tri ân buổi Cổ điển (Classic) 21:00 22/10\n' +
      '• Giết nhiều nhất: An, Bình (2 phiếu)\n' +
      '• Pha xử lý ngu nhất: Chi (1 phiếu)\n' +
      '• Pha dí người ngu nhất: Không ai được vote',
  ]);
  expect(await awardsOf(roundId)).toEqual([
    { roundId, categoryId: kills.id, memberId: a.id, voteCount: 2 },
    { roundId, categoryId: kills.id, memberId: b.id, voteCount: 2 },
    { roundId, categoryId: dumb.id, memberId: c.id, voteCount: 1 },
  ]);
  expect(notifier.closedVotes.map((c) => c.resultText)).toEqual([
    '🏆 An, Bình (2 phiếu)',
    '🏆 Chi (1 phiếu)',
    'Không ai được vote',
  ]);
  expect(notifier.closedVotes.map((c) => c.messageId)).toEqual(['msg-2', 'msg-3', 'msg-4']);
});

test('close while Discord is down keeps the result and retries it until Discord confirms', async () => {
  const { ctx, notifier } = await setup();
  const errors = silenceConsoleError();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');
  await endSession(ctx, s.id, [kills.id, dumb.id]);
  const roundId = (await roundOf(s.id)).id;
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: a.id, nomineeId: b.id });

  notifier.down = true;
  await expect(closeVoteRound(ctx, roundId)).resolves.toBeUndefined();
  // Kết quả đã chốt trong DB; Discord chưa biết → cờ chờ bật, chưa có thông báo nào.
  expect(await roundRow(roundId)).toMatchObject({ status: 'closed', announcePending: true });
  expect(await awardsOf(roundId)).toEqual([{ roundId, categoryId: kills.id, memberId: b.id, voteCount: 1 }]);
  expect(await pendingOf(roundId)).toEqual([
    { categoryId: kills.id, discordMessageId: 'msg-2', resultPending: true },
    { categoryId: dumb.id, discordMessageId: 'msg-3', resultPending: true },
  ]);
  expect(notifier.announcements).toEqual([]);
  expect(notifier.closedVotes).toEqual([]);
  expect(errors).toHaveBeenCalledTimes(3); // 1 thông báo + 2 tin vote
  expect(errors.mock.calls[0]?.[0]).toContain(String(roundId));

  // Discord vẫn sập: lượt đăng bù chỉ ghi log, giữ cờ.
  await expect(retryRoundResults(ctx)).resolves.toBeUndefined();
  expect(errors).toHaveBeenCalledTimes(6);
  expect((await roundRow(roundId)).announcePending).toBe(true);

  // Discord trở lại: đúng một thông báo (nội dung dựng lại từ DB, y như lúc đóng), mỗi tin sửa một lần, cờ tắt.
  notifier.down = false;
  await retryRoundResults(ctx);
  expect(notifier.announcements).toEqual([
    '🏆 Kết quả tri ân buổi Cổ điển (Classic) 21:00 22/10\n' +
      '• Giết nhiều nhất: Bình (1 phiếu)\n' +
      '• Pha xử lý ngu nhất: Không ai được vote',
  ]);
  expect(notifier.closedVotes).toEqual([
    { messageId: 'msg-2', resultText: '🏆 Bình (1 phiếu)' },
    { messageId: 'msg-3', resultText: 'Không ai được vote' },
  ]);
  expect(await roundRow(roundId)).toMatchObject({ status: 'closed', announcePending: false });
  expect((await pendingOf(roundId)).map((m) => m.resultPending)).toEqual([false, false]);

  // Chạy lại (riêng lẻ và qua việc vote-sync): không còn gì để đăng.
  await retryRoundResults(ctx);
  await syncVotes(ctx);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.closedVotes).toHaveLength(2);
  expect(errors).toHaveBeenCalledTimes(6);
});

test('a failed result edit is retried alone; the announcement is never repeated', async () => {
  const { ctx, notifier } = await setup();
  const errors = silenceConsoleError();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');
  await endSession(ctx, s.id, [kills.id, dumb.id]);
  const roundId = (await roundOf(s.id)).id;
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: a.id, nomineeId: b.id });

  // Thông báo đi, tin đầu sửa lỗi, tin sau sửa được.
  vi.spyOn(notifier, 'closeVote').mockRejectedValueOnce(new Error('Discord lỗi'));
  await closeVoteRound(ctx, roundId);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.closedVotes).toEqual([{ messageId: 'msg-3', resultText: 'Không ai được vote' }]);
  expect(await roundRow(roundId)).toMatchObject({ announcePending: false });
  expect(await pendingOf(roundId)).toEqual([
    { categoryId: kills.id, discordMessageId: 'msg-2', resultPending: true },
    { categoryId: dumb.id, discordMessageId: 'msg-3', resultPending: false },
  ]);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(errors.mock.calls[0]?.[0]).toContain('msg-2');

  // Lượt sau chỉ sửa lại tin còn chờ.
  await retryRoundResults(ctx);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.closedVotes).toEqual([
    { messageId: 'msg-3', resultText: 'Không ai được vote' },
    { messageId: 'msg-2', resultText: '🏆 Bình (1 phiếu)' },
  ]);
  expect((await pendingOf(roundId)).map((m) => m.resultPending)).toEqual([false, false]);
});

test('a vote message deleted by hand counts as delivered when closing (R27)', async () => {
  const { ctx, notifier } = await setup();
  const errors = silenceConsoleError();
  const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');
  await endSession(ctx, s.id, [kills.id, dumb.id]);
  const roundId = (await roundOf(s.id)).id;
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: a.id, nomineeId: b.id });

  // Ai đó xoá tay tin vote của hạng mục đầu (msg-2) trước khi đóng.
  notifier.goneMessageIds.add('msg-2');
  await expect(closeVoteRound(ctx, roundId)).resolves.toBeUndefined();

  // Thông báo vẫn đi (kết quả không mất), tin còn lại vẫn sửa; tin đã xoá coi như xong — không
  // treo `resultPending` để đăng bù mãi một tin không còn tồn tại.
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.announcements[0]).toContain('Giết nhiều nhất: Bình (1 phiếu)');
  expect(notifier.closedVotes).toEqual([{ messageId: 'msg-3', resultText: 'Không ai được vote' }]);
  expect(await roundRow(roundId)).toMatchObject({ status: 'closed', announcePending: false });
  expect((await pendingOf(roundId)).map((m) => m.resultPending)).toEqual([false, false]);
  expect(warns).toHaveBeenCalledTimes(1);
  expect(String(warns.mock.calls[0]?.[0])).toContain('msg-2');
  expect(errors).not.toHaveBeenCalled();

  // Không còn gì để đăng bù.
  await retryRoundResults(ctx);
  await syncVotes(ctx);
  expect(notifier.closedVotes).toHaveLength(1);
  expect(notifier.announcements).toHaveLength(1);
  expect(warns).toHaveBeenCalledTimes(1);
});

test('a committed close never throws, even when result delivery fails before reaching Discord (R27)', async () => {
  const { ctx, notifier } = await setup();
  const errors = silenceConsoleError();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');
  await endSession(ctx, s.id, [kills.id, dumb.id]);
  const roundId = (await roundOf(s.id)).id;
  const vote = { roundId, categoryId: kills.id, voterId: a.id, nomineeId: b.id };
  await castVote(ctx, vote);

  // DB trục trặc đúng lúc đọc đợt để đăng kết quả — sau khi giao dịch đóng đã lưu.
  await expect(closeVoteRound(withOneFailingQuery(ctx, 'voteRound', 'findUnique'), roundId)).resolves.toBeUndefined();
  expect(await roundRow(roundId)).toMatchObject({ status: 'closed', announcePending: true });
  expect(await awardsOf(roundId)).toEqual([{ roundId, categoryId: kills.id, memberId: b.id, voteCount: 1 }]);
  expect((await pendingOf(roundId)).map((m) => m.resultPending)).toEqual([true, true]);
  expect(notifier.announcements).toEqual([]);
  expect(notifier.closedVotes).toEqual([]);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(String(errors.mock.calls[0]?.[0])).toContain(String(roundId));
  // Đợt đã đóng thật: không nhận phiếu nữa.
  await expect(castVote(ctx, vote)).rejects.toMatchObject({ code: 'ROUND_CLOSED' });

  // Lượt đăng bù hoàn tất phần còn thiếu.
  await retryRoundResults(ctx);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.closedVotes).toEqual([
    { messageId: 'msg-2', resultText: '🏆 Bình (1 phiếu)' },
    { messageId: 'msg-3', resultText: 'Không ai được vote' },
  ]);
  expect(await roundRow(roundId)).toMatchObject({ announcePending: false });
  expect((await pendingOf(roundId)).map((m) => m.resultPending)).toEqual([false, false]);
  expect(errors).toHaveBeenCalledTimes(1);
});

test('a round whose menus never got posted announces its result and has nothing to edit', async () => {
  const { ctx, notifier } = await setup();
  const errors = silenceConsoleError();
  const { session: s, members } = await sessionWith(['Chi']);
  const voter = await createMember(testDb);
  const kills = await category('Giết nhiều nhất');
  notifier.down = true;
  await endSession(ctx, s.id, [kills.id]);
  notifier.down = false;
  errors.mockClear();
  const roundId = (await roundOf(s.id)).id;
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: voter.id, nomineeId: members[0]!.id });

  await closeVoteRound(ctx, roundId);
  expect(notifier.announcements).toEqual([
    '🏆 Kết quả tri ân buổi Cổ điển (Classic) 21:00 22/10\n• Giết nhiều nhất: Chi (1 phiếu)',
  ]);
  expect(notifier.closedVotes).toEqual([]);
  expect(errors).not.toHaveBeenCalled();
  // Tin không có id thì không có gì để sửa bù; đợt đã đóng không đăng menu mới.
  await syncVotes(ctx);
  expect(notifier.votes).toEqual([]);
  expect(notifier.closedVotes).toEqual([]);
  expect(notifier.announcements).toHaveLength(1);
});

test('a menu posted while the round closes early gets its result instead of staying live', async () => {
  const { ctx, notifier } = await setup();
  silenceConsoleError();
  const { session: s, members } = await sessionWith(['An', 'Bình']);
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');
  notifier.down = true;
  await endSession(ctx, s.id, [kills.id, dumb.id]);
  notifier.down = false;
  const roundId = (await roundOf(s.id)).id;
  await castVote(ctx, { roundId, categoryId: kills.id, voterId: a.id, nomineeId: b.id });

  // Đúng lúc tin đầu đang gửi lên Discord, admin đóng sớm: đợt đóng trong DB trước khi Discord trả id.
  let closing!: Promise<void>;
  vi.spyOn(notifier, 'publishVote').mockImplementationOnce(async (prompt) => {
    closing = closeVoteRound(ctx, roundId);
    await vi.waitFor(async () => expect((await roundRow(roundId)).status).toBe('closed'));
    notifier.votes.push(prompt);
    return 'msg-race';
  });
  await publishPendingVoteMessages(ctx);
  await closing;

  // Tin đầu có id và được sửa thành kết quả; tin thứ hai không được đăng nữa vì đợt đã đóng.
  expect(notifier.votes.map((v) => v.categoryId)).toEqual([kills.id]);
  expect(await pendingOf(roundId)).toEqual([
    { categoryId: kills.id, discordMessageId: 'msg-race', resultPending: false },
    { categoryId: dumb.id, discordMessageId: null, resultPending: true },
  ]);
  expect(notifier.announcements).toHaveLength(1);
  expect(notifier.closedVotes).toEqual([{ messageId: 'msg-race', resultText: '🏆 Bình (1 phiếu)' }]);

  // Lượt đăng bù sau đó: không đăng menu cho đợt đã đóng, không sửa gì thêm.
  await syncVotes(ctx);
  expect(notifier.votes).toHaveLength(1);
  expect(notifier.closedVotes).toHaveLength(1);
  expect(notifier.announcements).toHaveLength(1);
});

test('closeDueRounds closes only rounds past closesAt and continues past a failing round', async () => {
  const { ctx, notifier, setNow } = await setup();
  const errors = silenceConsoleError();
  const kills = await category('Giết nhiều nhất');
  const { session: s1 } = await sessionWith(['An']);
  const { session: s2 } = await sessionWith(['Bình']);
  const { session: s3 } = await sessionWith(['Chi']);
  await endSession(ctx, s1.id, [kills.id]);
  await endSession(ctx, s2.id, [kills.id]);
  setNow('2026-10-22T12:30:00Z');
  await endSession(ctx, s3.id, [kills.id]); // đóng lúc 00:30Z
  const [r1, r2, r3] = await Promise.all([roundOf(s1.id), roundOf(s2.id), roundOf(s3.id)]);
  const statuses = async () => (await Promise.all([r1, r2, r3].map((r) => roundRow(r.id)))).map((r) => r.status);

  setNow('2026-10-22T23:59:59Z');
  await closeDueRounds(ctx);
  expect(await statuses()).toEqual(['open', 'open', 'open']);

  // Đúng giờ đóng: r1 lỗi DB (được ghi log), r2 vẫn đóng, r3 chưa tới giờ.
  setNow(CLOSES_AT);
  await expect(closeDueRounds(withOneFailingTransaction(ctx))).resolves.toBeUndefined();
  expect(await statuses()).toEqual(['open', 'closed', 'open']);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(errors.mock.calls[0]?.[0]).toContain(String(r1.id));

  await closeDueRounds(ctx);
  expect(await statuses()).toEqual(['closed', 'closed', 'open']);
  setNow('2026-10-23T00:30:00Z');
  await closeDueRounds(ctx);
  expect(await statuses()).toEqual(['closed', 'closed', 'closed']);
  expect(notifier.announcements).toHaveLength(3);
  // Không còn gì để đóng.
  await closeDueRounds(ctx);
  expect(notifier.announcements).toHaveLength(3);
});

// ---------------------------------------------------------------------------
// Tự kết thúc
// ---------------------------------------------------------------------------

test('auto end after configured hours', async () => {
  const { ctx, notifier } = await setup();
  const errors = silenceConsoleError();
  const a = await createMember(testDb, { displayName: 'An' });
  // 08:00Z = now − 4 giờ → đến hạn; 08:01Z = now − 3 giờ 59 phút → chưa.
  const due = await insertSession(testDb, { startsAt: new Date('2026-10-22T08:00:00Z') });
  await join(due.id, a.id);
  const notYet = await insertSession(testDb, { startsAt: new Date('2026-10-22T08:01:00Z') });
  const cancelled = await insertSession(testDb, { startsAt: new Date('2026-10-22T01:00:00Z'), status: 'cancelled' });
  const ended = await insertSession(testDb, {
    startsAt: new Date('2026-10-22T01:00:00Z'),
    status: 'ended',
    endedAt: new Date('2026-10-22T05:00:00Z'),
  });

  await autoEndSessions(ctx);
  expect(await sessionRow(due.id)).toMatchObject({ status: 'ended', endedAt: ctx.now(), discordDirty: false });
  expect((await sessionRow(notYet.id)).status).toBe('scheduled');
  expect((await sessionRow(cancelled.id)).status).toBe('cancelled');
  expect(await sessionRow(ended.id)).toMatchObject({ status: 'ended', endedAt: new Date('2026-10-22T05:00:00Z') });
  // Buổi tự kết thúc chỉ dùng hạng mục tick sẵn.
  expect(await roundOf(due.id)).toMatchObject({ status: 'open', closesAt: new Date(CLOSES_AT) });
  expect(await testDb.voteRound.count()).toBe(1);
  expect(notifier.votes.map((v) => v.categoryName)).toEqual([
    'Giết nhiều nhất',
    'Pha xử lý ngu nhất',
    'Pha dí người ngu nhất',
  ]);
  expect(notifier.votes[0]?.nominees).toEqual([{ memberId: a.id, displayName: 'An' }]);

  // Cài đặt 2 giờ: buổi 08:01Z nay đã quá hạn.
  await updateSettings(ctx, { autoEndHours: 2 });
  await autoEndSessions(ctx);
  expect((await sessionRow(notYet.id)).status).toBe('ended');
  expect(await testDb.voteRound.count()).toBe(1); // không ai tham gia → không mở vote
  expect(errors).not.toHaveBeenCalled();

  // Một buổi lỗi không chặn buổi khác, và không để lại buổi "đã kết thúc mà không có vote":
  // lỗi DB khi kết thúc buổi đầu → buổi đó vẫn `scheduled` (được ghi log), buổi sau vẫn xong;
  // lượt sau kết thúc nốt buổi đầu kèm vote.
  const s5 = await insertSession(testDb, { startsAt: new Date('2026-10-22T09:00:00Z') });
  await join(s5.id, a.id);
  const s6 = await insertSession(testDb, { startsAt: new Date('2026-10-22T09:30:00Z') });
  await join(s6.id, a.id);
  await expect(autoEndSessions(withOneFailingTransaction(ctx))).resolves.toBeUndefined();
  expect(errors).toHaveBeenCalledTimes(1);
  expect(errors.mock.calls[0]?.[0]).toContain(String(s5.id));
  expect(await sessionRow(s5.id)).toMatchObject({ status: 'scheduled', endedAt: null });
  expect(await testDb.voteRound.findUnique({ where: { sessionId: s5.id } })).toBeNull();
  expect((await sessionRow(s6.id)).status).toBe('ended');
  expect(await roundOf(s6.id)).toMatchObject({ status: 'open' });

  await autoEndSessions(ctx);
  expect(await sessionRow(s5.id)).toMatchObject({ status: 'ended', endedAt: ctx.now() });
  expect(await roundOf(s5.id)).toMatchObject({ status: 'open' });
  expect(errors).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Sảnh tri ân
// ---------------------------------------------------------------------------

test('daily hall groups by VN date of session', async () => {
  const { ctx, setNow } = await setup();
  const an = await createMember(testDb, { displayName: 'An', avatarUrl: 'https://cdn.example/an.png' });
  const binh = await createMember(testDb, { displayName: 'Bình' });
  const chi = await createMember(testDb, { displayName: 'Chi' });
  const kills = await category('Giết nhiều nhất');
  const dumb = await category('Pha xử lý ngu nhất');

  // 00:30 ngày 23/10 giờ VN — vẫn là 22/10 theo UTC.
  const late = await insertSession(testDb, { startsAt: new Date('2026-10-22T17:30:00Z') });
  await join(late.id, an.id);
  await join(late.id, binh.id);
  // 21:00 ngày 22/10 giờ VN.
  const evening = await insertSession(testDb, { startsAt });
  await join(evening.id, chi.id);
  // 23:00 ngày 22/10 giờ VN: vote còn mở → chưa lên sảnh.
  const stillOpen = await insertSession(testDb, { startsAt: new Date('2026-10-22T16:00:00Z') });
  await join(stillOpen.id, chi.id);
  // Không ai tham gia → không có đợt vote → không lên sảnh.
  const empty = await insertSession(testDb, { startsAt: new Date('2026-10-22T15:00:00Z') });

  await endSession(ctx, evening.id, [kills.id]);
  await endSession(ctx, stillOpen.id);
  await endSession(ctx, empty.id);
  setNow('2026-10-22T18:00:00Z');
  await endSession(ctx, late.id, [kills.id, dumb.id]);
  const lateRound = await roundOf(late.id);
  const eveningRound = await roundOf(evening.id);
  await castVote(ctx, { roundId: lateRound.id, categoryId: kills.id, voterId: chi.id, nomineeId: an.id });
  await castVote(ctx, { roundId: lateRound.id, categoryId: kills.id, voterId: binh.id, nomineeId: an.id });
  await castVote(ctx, { roundId: eveningRound.id, categoryId: kills.id, voterId: an.id, nomineeId: chi.id });
  await closeVoteRound(ctx, lateRound.id);
  await closeVoteRound(ctx, eveningRound.id);

  expect(await getDailyHall(ctx, '2026-10-23')).toEqual({
    date: '2026-10-23',
    sessions: [
      {
        sessionId: late.id,
        label: 'Cổ điển (Classic) 00:30',
        awards: [
          {
            categoryName: 'Giết nhiều nhất',
            winners: [{ memberId: an.id, displayName: 'An', avatarUrl: 'https://cdn.example/an.png', voteCount: 2 }],
          },
          { categoryName: 'Pha xử lý ngu nhất', winners: [] },
        ],
      },
    ],
  });
  expect(await getDailyHall(ctx, '2026-10-22')).toEqual({
    date: '2026-10-22',
    sessions: [
      {
        sessionId: evening.id,
        label: 'Cổ điển (Classic) 21:00',
        awards: [
          {
            categoryName: 'Giết nhiều nhất',
            winners: [{ memberId: chi.id, displayName: 'Chi', avatarUrl: null, voteCount: 1 }],
          },
        ],
      },
    ],
  });
  expect(await getDailyHall(ctx, '2026-10-21')).toEqual({ date: '2026-10-21', sessions: [] });
  await expect(getDailyHall(ctx, '23/10/2026')).rejects.toMatchObject({ code: 'VALIDATION', message: 'Ngày không hợp lệ' });
  await expect(getDailyHall(ctx, '2026-02-30')).rejects.toMatchObject({ code: 'VALIDATION' });

  expect(await listHallDates(ctx, 10)).toEqual(['2026-10-23', '2026-10-22']);
  expect(await listHallDates(ctx, 1)).toEqual(['2026-10-23']);
  await expect(listHallDates(ctx, 0)).rejects.toMatchObject({ code: 'VALIDATION' });

  // Đóng nốt đợt còn mở: buổi 23:00 lên sảnh 22/10, xếp theo giờ bắt đầu.
  await closeVoteRound(ctx, (await roundOf(stillOpen.id)).id);
  expect((await getDailyHall(ctx, '2026-10-22')).sessions.map((s) => [s.sessionId, s.label])).toEqual([
    [evening.id, 'Cổ điển (Classic) 21:00'],
    [stillOpen.id, 'Cổ điển (Classic) 23:00'],
  ]);
  expect(await listHallDates(ctx, 10)).toEqual(['2026-10-23', '2026-10-22']);
});
