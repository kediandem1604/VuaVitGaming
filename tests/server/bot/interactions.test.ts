import type { PrismaClient } from '@prisma/client';
import { MessageFlags } from 'discord.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { GuildMemberSource } from '../../../src/server/bot/guild-directory.js';
import { handleInteraction } from '../../../src/server/bot/interactions.js';
import type { ComponentInteractionLike, InteractionLike } from '../../../src/server/bot/interactions.js';
import type { Ctx } from '../../../src/server/ctx.js';
import { cancelSession, createSession, getSessionView } from '../../../src/server/modules/sessions/service.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember } from '../../helpers/factories.js';
import type { FakeNotifier } from '../../helpers/fakes.js';

let ctx: Ctx;
let notifier: FakeNotifier;
let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier } = makeTestCtx());
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

/** 21:00 ngày 22/10/2026 giờ VN. */
const startsAt = new Date('2026-10-22T14:00:00Z');

async function openSession(capacity = 16): Promise<number> {
  const admin = await createMember(testDb, { accessLevel: 'admin', displayName: 'Admin' });
  const classic = await testDb.gameMode.findUniqueOrThrow({ where: { key: 'classic' } });
  return (await createSession(ctx, admin.id, { startsAt, modeId: classic.id, capacity })).id;
}

const goingCount = (sessionId: number) => testDb.attendance.count({ where: { sessionId, status: 'going' } });

/** GuildMember giả (kiểu cấu trúc) của người bấm nút. */
const guildMember = (id: string, name = `User ${id}`): GuildMemberSource => ({
  id,
  displayName: name,
  displayAvatarURL: () => `https://cdn.test/${id}.png`,
  roles: { cache: new Map([['test-guild', {}]]) },
  guild: { id: 'test-guild' },
});

type Step = { step: 'defer' | 'edit' | 'reply'; content?: string; going: number };

/**
 * Tương tác giả. Mỗi lời gọi trả lời được ghi lại kèm số người `going` trong DB
 * tại thời điểm đó — để kiểm tra `deferReply` xảy ra TRƯỚC khi điểm danh được ghi.
 */
class FakeInteraction implements InteractionLike, ComponentInteractionLike {
  steps: Step[] = [];

  constructor(
    public customId: string,
    private readonly opts: {
      kind?: 'button' | 'select' | 'command';
      guildId?: string | null;
      member?: GuildMemberSource | null;
      sessionId?: number;
    } = {},
  ) {}

  get guildId(): string | null {
    return this.opts.guildId === undefined ? 'test-guild' : this.opts.guildId;
  }

  get member(): GuildMemberSource | null {
    return this.opts.member === undefined ? guildMember('u1', 'Người bấm') : this.opts.member;
  }

  isButton(): this is ComponentInteractionLike {
    return (this.opts.kind ?? 'button') === 'button';
  }

  isStringSelectMenu(): this is ComponentInteractionLike {
    return this.opts.kind === 'select';
  }

  inCachedGuild(): this is ComponentInteractionLike & { member: GuildMemberSource } {
    return this.member !== null;
  }

  async deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<void> {
    expect(options).toEqual({ flags: MessageFlags.Ephemeral });
    await this.record('defer');
  }

  async editReply(content: string): Promise<void> {
    await this.record('edit', content);
  }

  async reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<void> {
    expect(options.flags).toBe(MessageFlags.Ephemeral);
    await this.record('reply', options.content);
  }

  private async record(step: Step['step'], content?: string): Promise<void> {
    const going = this.opts.sessionId === undefined ? 0 : await goingCount(this.opts.sessionId);
    this.steps.push(content === undefined ? { step, going } : { step, content, going });
  }
}

// ---------------------------------------------------------------------------
// Tham gia / Huỷ
// ---------------------------------------------------------------------------

test('join defers first, upserts the presser, records attendance and confirms with the VN time', async () => {
  const sessionId = await openSession();
  const i = new FakeInteraction(`att:join:${sessionId}`, { sessionId });

  await handleInteraction(ctx, i);

  expect(i.steps).toEqual([
    { step: 'defer', going: 0 },
    { step: 'edit', content: 'Đã đăng ký buổi 21:00 ✅', going: 1 },
  ]);

  // Người bấm được tạo hồ sơ từ GuildMember (tên, avatar) và đã có trong danh sách.
  const presser = await testDb.member.findUniqueOrThrow({ where: { discordId: 'u1' } });
  expect(presser).toMatchObject({ displayName: 'Người bấm', avatarUrl: 'https://cdn.test/u1.png', status: 'active' });
  expect((await getSessionView(ctx, sessionId)).attendees).toEqual([{ memberId: presser.id, displayName: 'Người bấm' }]);

  // Embed được sửa qua service (không gọi interaction.update): một lần đăng, một lần sửa.
  expect(notifier.published).toHaveLength(1);
  expect(notifier.updated).toHaveLength(1);
  expect(notifier.updated[0]?.view.attendees).toHaveLength(1);
  expect(errors).not.toHaveBeenCalled();
});

test('leave confirms and frees the seat', async () => {
  const sessionId = await openSession();
  await handleInteraction(ctx, new FakeInteraction(`att:join:${sessionId}`));
  expect(await goingCount(sessionId)).toBe(1);

  const i = new FakeInteraction(`att:leave:${sessionId}`, { sessionId });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([
    { step: 'defer', going: 1 },
    { step: 'edit', content: 'Đã huỷ tham gia', going: 0 },
  ]);

  // Rời buổi chưa từng tham gia: vẫn trả lời như vậy, không lỗi.
  const other = new FakeInteraction(`att:leave:${sessionId}`, { member: guildMember('u2') });
  await handleInteraction(ctx, other);
  expect(other.steps.at(-1)).toMatchObject({ step: 'edit', content: 'Đã huỷ tham gia' });
});

test('a known member keeps their code and gets refreshed from Discord', async () => {
  const sessionId = await openSession();
  const existing = await createMember(testDb, { discordId: 'u1', displayName: 'Tên cũ', memberCode: 'GGD-0007' });

  await handleInteraction(ctx, new FakeInteraction(`att:join:${sessionId}`, { member: guildMember('u1', 'Tên mới') }));

  const refreshed = await testDb.member.findUniqueOrThrow({ where: { id: existing.id } });
  expect(refreshed).toMatchObject({ memberCode: 'GGD-0007', displayName: 'Tên mới' });
  expect((await getSessionView(ctx, sessionId)).attendees).toEqual([{ memberId: existing.id, displayName: 'Tên mới' }]);
});

test('full session answers Đã đủ người', async () => {
  const sessionId = await openSession(1);
  await handleInteraction(ctx, new FakeInteraction(`att:join:${sessionId}`, { member: guildMember('u1') }));

  const i = new FakeInteraction(`att:join:${sessionId}`, { member: guildMember('u2'), sessionId });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([
    { step: 'defer', going: 1 },
    { step: 'edit', content: 'Đã đủ người', going: 1 },
  ]);
  expect(errors).not.toHaveBeenCalled(); // lỗi nghiệp vụ không phải lỗi hệ thống
});

test('closed or unknown sessions answer with the business error message', async () => {
  const sessionId = await openSession();
  await cancelSession(ctx, sessionId);

  const cancelled = new FakeInteraction(`att:join:${sessionId}`);
  await handleInteraction(ctx, cancelled);
  expect(cancelled.steps.map((s) => s.step)).toEqual(['defer', 'edit']);
  expect(cancelled.steps[1]?.content).toBe('Buổi chơi đã kết thúc hoặc bị huỷ');

  const missing = new FakeInteraction('att:join:999');
  await handleInteraction(ctx, missing);
  expect(missing.steps[1]).toMatchObject({ step: 'edit', content: 'Không tìm thấy' });
  expect(errors).not.toHaveBeenCalled();
});

test('unexpected errors are logged and answered generically', async () => {
  const sessionId = await openSession();
  const broken: Ctx = {
    ...ctx,
    db: {
      member: {
        findUnique: async () => {
          throw new Error('db secret');
        },
      },
    } as unknown as PrismaClient,
  };

  const i = new FakeInteraction(`att:join:${sessionId}`);
  await handleInteraction(broken, i);
  expect(i.steps).toEqual([
    { step: 'defer', going: 0 },
    { step: 'edit', content: 'Có lỗi xảy ra, thử lại sau', going: 0 },
  ]);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(String(errors.mock.calls[0]?.[0])).toContain(`att:join:${sessionId}`);
  expect(await goingCount(sessionId)).toBe(0);
});

// ---------------------------------------------------------------------------
// Bỏ qua / từ chối
// ---------------------------------------------------------------------------

test('non-guild ignored', async () => {
  const sessionId = await openSession();

  for (const i of [
    new FakeInteraction(`att:join:${sessionId}`, { guildId: 'other-guild' }),
    new FakeInteraction(`att:join:${sessionId}`, { guildId: null, member: null }),
    // Server đúng nhưng chưa cache (dữ liệu thành viên thô): không có GuildMember để tạo hồ sơ.
    new FakeInteraction(`att:join:${sessionId}`, { member: null }),
  ]) {
    await handleInteraction(ctx, i);
    expect(i.steps).toEqual([{ step: 'reply', content: 'Bot chỉ dùng trong server chính', going: 0 }]);
  }

  expect(await goingCount(sessionId)).toBe(0);
  expect(await testDb.member.count()).toBe(1); // chỉ có admin tạo buổi
  expect(notifier.updated).toHaveLength(0);
});

test('unknown custom ids are ignored with a log line', async () => {
  for (const customId of ['att:join:abc', 'xyz', 'att:join:0']) {
    const i = new FakeInteraction(customId);
    await handleInteraction(ctx, i);
    expect(i.steps).toEqual([]);
  }
  expect(warns).toHaveBeenCalledTimes(3);
  expect(String(warns.mock.calls[0]?.[0])).toContain('att:join:abc');
});

test('vote menus are not supported yet', async () => {
  const i = new FakeInteraction('vote:1:2', { kind: 'select' });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([{ step: 'reply', content: 'Chưa hỗ trợ', going: 0 }]);
});

test('non-component interactions are ignored', async () => {
  const i = new FakeInteraction('att:join:1', { kind: 'command' });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([]);
  expect(warns).not.toHaveBeenCalled();
});
