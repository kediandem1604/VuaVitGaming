import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { toGuildMemberInfo } from '../../../src/server/bot/guild-directory.js';
import {
  memberEventHandlers,
  onMemberJoin,
  onMemberLeave,
  onMemberUpdate,
  onReadySync,
  safeHandler,
} from '../../../src/server/bot/member-events.js';
import type { Ctx } from '../../../src/server/ctx.js';
import type { GuildMemberInfo } from '../../../src/server/ports.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import type { FakeNotifier } from '../../helpers/fakes.js';

let ctx: Ctx;
let notifier: FakeNotifier;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier } = makeTestCtx());
  // Handler ghi log bằng console; chặn lại để output test sạch và để assert được.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const info = (id: string, roles: string[] = []): GuildMemberInfo => ({
  discordId: id,
  displayName: `User ${id}`,
  avatarUrl: null,
  roleIds: roles,
  joinedAt: null,
});

const memberByDiscordId = (id: string) => testDb.member.findUniqueOrThrow({ where: { discordId: id } });

/** GuildMember giả tối thiểu (kiểu cấu trúc) — `roles` có thể chứa cả role @everyone (id = guild id). */
const fakeMember = (
  id: string,
  guildId: string,
  opts: { bot?: boolean; roles?: string[]; name?: string; joinedAt?: Date | null } = {},
) => ({
  id,
  displayName: opts.name ?? `User ${id}`,
  displayAvatarURL: () => `https://cdn.test/${id}.png`,
  joinedAt: opts.joinedAt === undefined ? new Date('2026-01-05T03:00:00Z') : opts.joinedAt,
  roles: { cache: new Map((opts.roles ?? []).map((r) => [r, {}])) },
  guild: { id: guildId },
  user: { bot: opts.bot ?? false },
});

// ---------------------------------------------------------------------------
// onMemberJoin
// ---------------------------------------------------------------------------

test('bot accounts ignored', async () => {
  await onMemberJoin(ctx, info('b'), true);
  expect(await testDb.member.count()).toBe(0);
  expect(notifier.dms).toHaveLength(0);
});

test('new member gets welcome DM with code', async () => {
  await onMemberJoin(ctx, info('1'), false);
  expect(notifier.dms).toHaveLength(1);
  expect(notifier.dms[0]).toMatchObject({ discordId: '1' });
  expect(notifier.dms[0]?.text).toContain('GGD-0001');
  expect(notifier.dms[0]?.text).toContain('http://localhost:3000');
  expect(await memberByDiscordId('1')).toMatchObject({ memberCode: 'GGD-0001', status: 'active' });
});

test('rejoining member gets a welcome-back DM with the same code', async () => {
  await onMemberJoin(ctx, info('1'), false);
  await onMemberLeave(ctx, '1');
  await onMemberJoin(ctx, info('1'), false);

  expect(notifier.dms).toHaveLength(2);
  expect(notifier.dms[1]?.text).toContain('Chào mừng trở lại');
  expect(notifier.dms[1]?.text).toContain('GGD-0001');
  expect(await testDb.member.count()).toBe(1);
  expect(await memberByDiscordId('1')).toMatchObject({ status: 'active', leftAt: null });
});

test('join event for an already active member refreshes the profile without a DM', async () => {
  await onMemberJoin(ctx, info('1'), false);
  await onMemberJoin(ctx, { ...info('1'), displayName: 'Tên mới' }, false);
  expect(notifier.dms).toHaveLength(1);
  expect((await memberByDiscordId('1')).displayName).toBe('Tên mới');
});

test('DM failure does not throw', async () => {
  notifier.failDmFor.add('1');
  await expect(onMemberJoin(ctx, info('1'), false)).resolves.toBeUndefined();
  // Hồ sơ vẫn được tạo; lỗi DM chỉ ghi log.
  expect(await memberByDiscordId('1')).toMatchObject({ memberCode: 'GGD-0001', status: 'active' });
  expect(console.error).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// onMemberLeave / onMemberUpdate
// ---------------------------------------------------------------------------

test('leave marks the member left; unknown ids are ignored', async () => {
  await onMemberJoin(ctx, info('1'), false);
  await onMemberLeave(ctx, '1');
  expect(await memberByDiscordId('1')).toMatchObject({ status: 'left' });
  await expect(onMemberLeave(ctx, 'không-có')).resolves.toBeUndefined();
});

test('update refreshes name, avatar and access level without a DM', async () => {
  await onMemberJoin(ctx, info('1'), false);
  await onMemberUpdate(ctx, {
    ...info('1', ['r-admin']),
    displayName: 'Tên mới',
    avatarUrl: 'https://cdn.test/a.png',
  });

  expect(await memberByDiscordId('1')).toMatchObject({
    memberCode: 'GGD-0001',
    displayName: 'Tên mới',
    avatarUrl: 'https://cdn.test/a.png',
    accessLevel: 'admin',
  });
  expect(notifier.dms).toHaveLength(1); // chỉ DM lúc vào server
});

test('update for a bot account is ignored', async () => {
  await onMemberUpdate(ctx, info('b'), true);
  expect(await testDb.member.count()).toBe(0);
});

// ---------------------------------------------------------------------------
// onReadySync
// ---------------------------------------------------------------------------

test('ready sync sends no DMs', async () => {
  await onReadySync(ctx, [info('1'), info('2')]);
  expect(notifier.dms).toHaveLength(0);
  expect(await testDb.member.count()).toBe(2);
});

test('ready sync creates missing members and marks absent ones left', async () => {
  await onMemberJoin(ctx, info('1'), false);
  await onMemberJoin(ctx, info('2'), false);
  notifier.dms.length = 0;

  await onReadySync(ctx, [info('1'), info('3')]);

  expect(await memberByDiscordId('1')).toMatchObject({ status: 'active' });
  expect(await memberByDiscordId('2')).toMatchObject({ status: 'left' });
  expect(await memberByDiscordId('3')).toMatchObject({ status: 'active', memberCode: 'GGD-0003' });
  expect(notifier.dms).toHaveLength(0);
});

test('ready sync with an empty list touches nobody and warns', async () => {
  await onMemberJoin(ctx, info('1'), false);
  await onMemberJoin(ctx, info('2'), false);

  await onReadySync(ctx, []);

  expect(await testDb.member.count({ where: { status: 'active' } })).toBe(2);
  expect(console.warn).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// memberEventHandlers: lọc server, bỏ bot, chuyển GuildMember → GuildMemberInfo
// ---------------------------------------------------------------------------

test('events from other guilds are ignored', async () => {
  const handlers = memberEventHandlers(() => ctx);

  await handlers.guildMemberAdd(fakeMember('1', 'other-guild'));
  await handlers.guildMemberUpdate(undefined, fakeMember('1', 'other-guild'));
  expect(await testDb.member.count()).toBe(0);
  expect(notifier.dms).toHaveLength(0);

  await handlers.guildMemberAdd(fakeMember('1', 'test-guild'));
  await handlers.guildMemberRemove(fakeMember('1', 'other-guild'));
  expect(await memberByDiscordId('1')).toMatchObject({ status: 'active' });

  await handlers.guildMemberRemove(fakeMember('1', 'test-guild'));
  expect(await memberByDiscordId('1')).toMatchObject({ status: 'left' });
});

test('handlers map GuildMember fields and skip bots', async () => {
  const handlers = memberEventHandlers(() => ctx);

  await handlers.guildMemberAdd(fakeMember('1', 'test-guild', { roles: ['test-guild', 'r-mod'], name: 'An' }));
  expect(await memberByDiscordId('1')).toMatchObject({
    displayName: 'An',
    avatarUrl: 'https://cdn.test/1.png',
    accessLevel: 'mod',
  });
  expect(notifier.dms[0]?.discordId).toBe('1');

  await handlers.guildMemberAdd(fakeMember('b', 'test-guild', { bot: true }));
  await handlers.guildMemberUpdate(undefined, fakeMember('b', 'test-guild', { bot: true }));
  expect(await testDb.member.count()).toBe(1);

  await handlers.guildMemberUpdate(undefined, fakeMember('1', 'test-guild', { roles: ['test-guild'], name: 'An mới' }));
  expect(await memberByDiscordId('1')).toMatchObject({ displayName: 'An mới', accessLevel: 'member' });
  expect(notifier.dms).toHaveLength(1);
});

test('toGuildMemberInfo maps fields and drops the @everyone role', () => {
  const joinedAt = new Date('2025-12-24T10:00:00Z');
  expect(toGuildMemberInfo(fakeMember('1', 'g', { roles: ['g', 'r-a', 'r-b'], name: 'An', joinedAt }))).toEqual({
    discordId: '1',
    displayName: 'An',
    avatarUrl: 'https://cdn.test/1.png',
    roleIds: ['r-a', 'r-b'],
    joinedAt,
  });
  // Discord không cho biết ngày vào (`joinedAt: null`) → chép nguyên null.
  expect(toGuildMemberInfo(fakeMember('2', 'g', { joinedAt: null })).joinedAt).toBeNull();
});

// ---------------------------------------------------------------------------
// safeHandler
// ---------------------------------------------------------------------------

test('safeHandler logs and never rethrows', async () => {
  const failing = safeHandler('thử', async (n: number) => {
    throw new Error(`hỏng ${n}`);
  });
  expect(() => failing(1)).not.toThrow();
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledTimes(1));
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('thử'), expect.any(Error));

  // Ném đồng bộ (handler không phải async) cũng bị bắt.
  const throwsSync = safeHandler('sync', (() => {
    throw new Error('ngay lập tức');
  }) as unknown as () => Promise<void>);
  expect(() => throwsSync()).not.toThrow();
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledTimes(2));

  // Handler chạy tốt thì chạy trọn vẹn.
  let ran = false;
  safeHandler('ok', async () => {
    ran = true;
  })();
  await vi.waitFor(() => expect(ran).toBe(true));
});
