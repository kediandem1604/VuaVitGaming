import { beforeEach, expect, test } from 'vitest';
import type { SessionView, VotePrompt } from '../../src/server/ports.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, createSession, roleByKey } from '../helpers/factories.js';

beforeEach(resetDb);

const view: SessionView = {
  id: 1,
  startsAt: new Date('2026-10-22T14:00:00Z'),
  modeName: 'Cổ điển',
  capacity: 16,
  roomCode: null,
  note: null,
  status: 'scheduled',
  attendees: [],
};

const prompt: VotePrompt = {
  roundId: 1,
  categoryId: 1,
  categoryName: 'MVP',
  description: null,
  sessionLabel: '21:00 22/10',
  closesAt: new Date('2026-10-23T01:00:00Z'),
  nominees: [{ memberId: 1, displayName: 'An' }],
};

test('makeTestCtx defaults and setNow', () => {
  const { ctx, setNow } = makeTestCtx();
  expect(ctx.now().toISOString()).toBe('2026-10-22T12:00:00.000Z');
  expect(ctx.db).toBe(testDb);
  expect(ctx.config.publicUrl).toBe('http://localhost:3000');
  expect(ctx.config.discord.adminRoleIds).toEqual(['r-admin']);
  expect(ctx.config.discord.modRoleIds).toEqual(['r-mod']);
  expect(ctx.config.devLogin).toBe(false);

  setNow('2026-11-04T00:00:00Z');
  expect(ctx.now().toISOString()).toBe('2026-11-04T00:00:00.000Z');
  expect(() => setNow('hôm qua')).toThrow();
});

test('ctx.now() hands out a fresh Date each call', () => {
  const { ctx } = makeTestCtx();
  const d = ctx.now();
  d.setUTCFullYear(1999);
  // Service nào lỡ sửa Date nhận được cũng không làm lệch đồng hồ test.
  expect(ctx.now().toISOString()).toBe('2026-10-22T12:00:00.000Z');
  expect(ctx.now()).not.toBe(d);
});

test('FakeNotifier shares one message counter and records every call', async () => {
  const { notifier } = makeTestCtx();
  expect(await notifier.publishSession(view)).toBe('msg-1');
  expect(await notifier.publishVote(prompt)).toBe('msg-2');
  expect(await notifier.publishSession(view)).toBe('msg-3');
  await notifier.updateSession('msg-1', view);
  await notifier.closeVote('msg-2', 'An thắng');
  await notifier.announce('Xin chào');
  await notifier.sendDm('d-1', 'Nhắc giờ');

  expect(notifier.published).toEqual([view, view]);
  expect(notifier.votes).toEqual([prompt]);
  expect(notifier.updated).toEqual([{ messageId: 'msg-1', view }]);
  expect(notifier.closedVotes).toEqual([{ messageId: 'msg-2', resultText: 'An thắng' }]);
  expect(notifier.announcements).toEqual(['Xin chào']);
  expect(notifier.dms).toEqual([{ discordId: 'd-1', text: 'Nhắc giờ' }]);

  // Mỗi FakeNotifier có bộ đếm riêng.
  expect(await makeTestCtx().notifier.publishVote(prompt)).toBe('msg-1');
});

test('FakeNotifier down and failDmFor', async () => {
  const { notifier } = makeTestCtx();
  notifier.failDmFor.add('d-bad');
  await expect(notifier.sendDm('d-bad', 'x')).rejects.toThrow();
  await notifier.sendDm('d-ok', 'x');
  expect(notifier.dms).toEqual([{ discordId: 'd-ok', text: 'x' }]);

  notifier.down = true;
  await expect(notifier.sendDm('d-ok', 'x')).rejects.toThrow();
  await expect(notifier.publishSession(view)).rejects.toThrow();
  await expect(notifier.updateSession('msg-1', view)).rejects.toThrow();
  await expect(notifier.publishVote(prompt)).rejects.toThrow();
  await expect(notifier.closeVote('msg-1', 'x')).rejects.toThrow();
  await expect(notifier.announce('x')).rejects.toThrow();
  expect(notifier.dms).toHaveLength(1);
  expect(notifier.published).toHaveLength(0);
});

test('FakeNotifier rejects a vote menu without nominees, like Discord does', async () => {
  const { notifier } = makeTestCtx();
  await expect(notifier.publishVote({ ...prompt, nominees: [] })).rejects.toThrow('Discord không nhận menu rỗng');
  expect(notifier.votes).toEqual([]);
  // Bộ đếm không bị tiêu: tin tiếp theo vẫn là msg-1.
  expect(await notifier.publishVote(prompt)).toBe('msg-1');
});

test('FakeMailer records sends and fails for listed addresses', async () => {
  const { mailer } = makeTestCtx();
  mailer.failFor.add('bad@example.com');
  await mailer.send('ok@example.com', 'Chủ đề', 'Nội dung');
  await expect(mailer.send('bad@example.com', 'Chủ đề', 'Nội dung')).rejects.toThrow();
  expect(mailer.sent).toEqual([{ to: 'ok@example.com', subject: 'Chủ đề', text: 'Nội dung' }]);
});

test('FakeDirectory looks up members and can go down', async () => {
  const { directory } = makeTestCtx();
  const info = { discordId: 'd-1', displayName: 'An', avatarUrl: null, roleIds: ['r-mod'] };
  directory.members.set('d-1', info);
  expect(await directory.getMember('d-1')).toEqual(info);
  expect(await directory.getMember('d-2')).toBeNull();
  directory.down = true;
  await expect(directory.getMember('d-1')).rejects.toThrow();
});

test('createMember allocates codes from the sequence with sane defaults', async () => {
  const a = await createMember(testDb);
  const b = await createMember(testDb, { displayName: 'Bình', accessLevel: 'mod', email: 'binh@example.com' });

  expect(a.memberCode).toBe('GGD-0001');
  expect(b.memberCode).toBe('GGD-0002');
  expect(a.discordId).not.toBe(b.discordId);
  expect(a).toMatchObject({
    status: 'active',
    accessLevel: 'member',
    notifyEmail: true,
    notifyDm: true,
    email: null,
  });
  expect(b).toMatchObject({ displayName: 'Bình', accessLevel: 'mod', email: 'binh@example.com' });

  const c = await createMember(testDb, { memberCode: 'GGD-0042' });
  expect(c.memberCode).toBe('GGD-0042');
});

test('createMember defaults derive from the member code number', async () => {
  const a = await createMember(testDb);
  const b = await createMember(testDb);
  expect(a).toMatchObject({ memberCode: 'GGD-0001', discordId: 'd-1', displayName: 'Member 1' });
  expect(b).toMatchObject({ memberCode: 'GGD-0002', discordId: 'd-2', displayName: 'Member 2' });

  // Mã tuỳ chỉnh dạng GGD-N: mặc định theo N để d-N ↔ GGD-N luôn khớp, không tiêu số sequence.
  const c = await createMember(testDb, { memberCode: 'GGD-0042' });
  expect(c).toMatchObject({ memberCode: 'GGD-0042', discordId: 'd-42', displayName: 'Member 42' });

  // Mã tuỳ chỉnh khác dạng: vẫn lấy số từ sequence.
  const d = await createMember(testDb, { memberCode: 'X-1' });
  expect(d).toMatchObject({ memberCode: 'X-1', discordId: 'd-3', displayName: 'Member 3' });

  // Ghi đè discordId/displayName vẫn được tôn trọng.
  const e = await createMember(testDb, { discordId: 'snowflake', displayName: 'An' });
  expect(e).toMatchObject({ memberCode: 'GGD-0004', discordId: 'snowflake', displayName: 'An' });
});

test('createMember defaults restart with resetDb', async () => {
  // Test trước đã tạo nhiều người; sau resetDb mọi thứ về 1 — kể cả discordId mặc định.
  expect(await createMember(testDb)).toMatchObject({ memberCode: 'GGD-0001', discordId: 'd-1' });
});

test('createSession defaults to classic at now + 2h', async () => {
  const host = await createMember(testDb);
  const s = await createSession(testDb);
  expect(s.startsAt.toISOString()).toBe('2026-10-22T14:00:00.000Z');
  expect(s).toMatchObject({ status: 'scheduled', capacity: 16, createdById: host.id, discordDirty: false });
  expect((await testDb.gameMode.findUniqueOrThrow({ where: { id: s.modeId } })).key).toBe('classic');

  const s2 = await createSession(testDb, { modeKey: 'goose_hunt', capacity: 8, roomCode: 'ABCD' });
  expect((await testDb.gameMode.findUniqueOrThrow({ where: { id: s2.modeId } })).key).toBe('goose_hunt');
  expect(s2).toMatchObject({ capacity: 8, roomCode: 'ABCD' });

  await expect(createSession(testDb, { modeKey: 'không_có' })).rejects.toThrow(/không_có/);
});

test('createSession without any member creates the host', async () => {
  const s = await createSession(testDb);
  expect(await testDb.member.count()).toBe(1);
  expect((await testDb.member.findUniqueOrThrow({ where: { id: s.createdById } })).memberCode).toBe('GGD-0001');
});

test('roleByKey', async () => {
  expect((await roleByKey(testDb, 'swordsman')).nameVi).toBe('Kiếm sĩ');
  await expect(roleByKey(testDb, 'không_có')).rejects.toThrow(/không_có/);
});
