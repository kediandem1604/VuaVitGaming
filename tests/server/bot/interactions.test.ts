import type { PrismaClient } from '@prisma/client';
import { MessageFlags } from 'discord.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { GuildMemberSource } from '../../../src/server/bot/guild-directory.js';
import { handleInteraction } from '../../../src/server/bot/interactions.js';
import type {
  AutocompleteInteractionLike,
  CommandInteractionLike,
  InteractionLike,
  SelectMenuInteractionLike,
} from '../../../src/server/bot/interactions.js';
import type { Ctx } from '../../../src/server/ctx.js';
import { createBounty } from '../../../src/server/modules/bounties/admin.js';
import { closeVoteRound } from '../../../src/server/modules/mvp/votes.js';
import { endSession } from '../../../src/server/modules/sessions/end.js';
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
const voteCount = (roundId: number) => testDb.vote.count({ where: { roundId } });

/**
 * Buổi đã kết thúc có người tham gia `names` (theo thứ tự), mở vote với các hạng mục
 * `categoryNames`; trả về đợt, hạng mục và người tham gia để dựng menu vote giả.
 */
async function openRound(names: string[], categoryNames = ['Giết nhiều nhất']) {
  const sessionId = await openSession();
  const members = [];
  for (const [i, displayName] of names.entries()) {
    const m = await createMember(testDb, { displayName, discordId: `nominee-${i}` });
    await testDb.attendance.create({
      data: { sessionId, memberId: m.id, status: 'going', updatedAt: new Date(Date.UTC(2026, 9, 22, 11, 0, i)) },
    });
    members.push(m);
  }
  const categories = [];
  for (const name of categoryNames) categories.push(await testDb.awardCategory.findFirstOrThrow({ where: { name } }));
  await endSession(ctx, sessionId, categories.map((c) => c.id));
  const round = await testDb.voteRound.findUniqueOrThrow({ where: { sessionId } });
  return { sessionId, roundId: round.id, categories, members };
}

/** GuildMember giả (kiểu cấu trúc) của người bấm nút. */
const guildMember = (id: string, name = `User ${id}`): GuildMemberSource => ({
  id,
  displayName: name,
  displayAvatarURL: () => `https://cdn.test/${id}.png`,
  joinedAt: null,
  roles: { cache: new Map([['test-guild', {}]]) },
  guild: { id: 'test-guild' },
});

type Step = { step: 'defer' | 'edit' | 'reply'; content?: string; going: number; votes?: number };

/**
 * Tương tác giả. Mỗi lời gọi trả lời được ghi lại kèm số người `going` (buổi
 * `sessionId`) và số phiếu (đợt `roundId`) trong DB tại thời điểm đó — để kiểm tra
 * `deferReply` xảy ra TRƯỚC khi điểm danh / phiếu được ghi.
 */
class FakeInteraction implements InteractionLike, SelectMenuInteractionLike {
  steps: Step[] = [];

  constructor(
    public customId: string,
    private readonly opts: {
      kind?: 'button' | 'select' | 'command';
      guildId?: string | null;
      member?: GuildMemberSource | null;
      sessionId?: number;
      roundId?: number;
      /** Giá trị menu đã chọn (chỉ có ở menu chọn). */
      values?: string[];
    } = {},
  ) {}

  get guildId(): string | null {
    return this.opts.guildId === undefined ? 'test-guild' : this.opts.guildId;
  }

  get member(): GuildMemberSource | null {
    return this.opts.member === undefined ? guildMember('u1', 'Người bấm') : this.opts.member;
  }

  get values(): string[] {
    return this.opts.values ?? [];
  }

  isButton(): this is SelectMenuInteractionLike {
    return (this.opts.kind ?? 'button') === 'button';
  }

  isStringSelectMenu(): this is SelectMenuInteractionLike {
    return this.opts.kind === 'select';
  }

  // Lệnh slash và autocomplete có bản giả riêng ở commands.test.ts; `kind: 'command'` ở
  // đây chỉ là "không phải nút cũng không phải menu".
  isChatInputCommand(): this is CommandInteractionLike {
    return false;
  }

  isAutocomplete(): this is AutocompleteInteractionLike {
    return false;
  }

  inCachedGuild(): this is SelectMenuInteractionLike & { member: GuildMemberSource } {
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
    const entry: Step = { step, going: this.opts.sessionId === undefined ? 0 : await goingCount(this.opts.sessionId) };
    if (content !== undefined) entry.content = content;
    if (this.opts.roundId !== undefined) entry.votes = await voteCount(this.opts.roundId);
    this.steps.push(entry);
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
    // Menu vote cũng vậy.
    new FakeInteraction('vote:1:1', { kind: 'select', values: ['1'], guildId: 'other-guild' }),
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

test('non-component interactions are ignored', async () => {
  const i = new FakeInteraction('att:join:1', { kind: 'command' });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([]);
  expect(warns).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Menu vote
// ---------------------------------------------------------------------------

test('vote select defers first, upserts the voter, records the vote and confirms with the names', async () => {
  const { roundId, categories, members } = await openRound(['An', 'Bình']);
  const kills = categories[0]!;
  const [an, binh] = members as [(typeof members)[0], (typeof members)[0]];

  const i = new FakeInteraction(`vote:${roundId}:${kills.id}`, { kind: 'select', values: [String(an.id)], roundId });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([
    { step: 'defer', going: 0, votes: 0 },
    { step: 'edit', content: 'Đã vote An cho “Giết nhiều nhất”. Đổi ý thì chọn lại.', going: 0, votes: 1 },
  ]);

  // Người vote (ngoài buổi, cả server được vote) có hồ sơ từ GuildMember; phiếu ghi đúng người.
  const voter = await testDb.member.findUniqueOrThrow({ where: { discordId: 'u1' } });
  expect(voter).toMatchObject({ displayName: 'Người bấm', avatarUrl: 'https://cdn.test/u1.png', status: 'active' });
  expect(await testDb.vote.findMany()).toEqual([
    { roundId, categoryId: kills.id, voterId: voter.id, nomineeId: an.id, updatedAt: ctx.now() },
  ]);

  // Đổi ý: chọn lại người khác → đổi phiếu, vẫn một phiếu.
  const again = new FakeInteraction(`vote:${roundId}:${kills.id}`, { kind: 'select', values: [String(binh.id)], roundId });
  await handleInteraction(ctx, again);
  expect(again.steps).toEqual([
    { step: 'defer', going: 0, votes: 1 },
    { step: 'edit', content: 'Đã vote Bình cho “Giết nhiều nhất”. Đổi ý thì chọn lại.', going: 0, votes: 1 },
  ]);
  expect((await testDb.vote.findFirstOrThrow()).nomineeId).toBe(binh.id);
  expect(errors).not.toHaveBeenCalled();
  expect(warns).not.toHaveBeenCalled();
});

test('self vote is refused with the business message', async () => {
  const { roundId, categories, members } = await openRound(['An', 'Bình']);
  const kills = categories[0]!;
  const an = members[0]!;
  // Người bấm (u1) chính là An.
  await testDb.member.update({ where: { id: an.id }, data: { discordId: 'u1' } });

  const i = new FakeInteraction(`vote:${roundId}:${kills.id}`, { kind: 'select', values: [String(an.id)], roundId });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([
    { step: 'defer', going: 0, votes: 0 },
    { step: 'edit', content: 'Không được tự vote', going: 0, votes: 0 },
  ]);
  expect(errors).not.toHaveBeenCalled(); // lỗi nghiệp vụ không phải lỗi hệ thống
});

test('bad menu values and other vote rule violations answer with the business message', async () => {
  const { roundId, categories, members } = await openRound(['An', 'Bình']);
  const kills = categories[0]!;
  const an = members[0]!;
  const outsider = await createMember(testDb, { displayName: 'Người ngoài' });
  const egg = await testDb.awardCategory.findFirstOrThrow({ where: { name: 'Pha đẻ trứng lộ liễu nhất (Cò gáy)' } });

  const answer = async (customId: string, values: string[]) => {
    const i = new FakeInteraction(customId, { kind: 'select', values });
    await handleInteraction(ctx, i);
    expect(i.steps.map((s) => s.step)).toEqual(['defer', 'edit']);
    return i.steps[1]?.content;
  };
  const menu = `vote:${roundId}:${kills.id}`;

  // Giá trị menu bị sửa (không phải id hợp lệ) → lỗi dữ liệu, không lộ gì.
  for (const values of [['abc'], [], ['0'], ['1.5'], ['-1'], ['01']]) {
    expect(await answer(menu, values), JSON.stringify(values)).toBe('Dữ liệu không hợp lệ');
  }
  expect(await answer(menu, [String(outsider.id)])).toBe('Người này không có mặt ở buổi chơi');
  expect(await answer(`vote:${roundId}:${egg.id}`, [String(an.id)])).toBe('Hạng mục không thuộc đợt vote này');
  expect(await answer(`vote:999:${kills.id}`, [String(an.id)])).toBe('Không tìm thấy');
  expect(await voteCount(roundId)).toBe(0);

  await closeVoteRound(ctx, roundId);
  expect(await answer(menu, [String(an.id)])).toBe('Vote đã đóng');
  expect(await voteCount(roundId)).toBe(0);
  expect(errors).not.toHaveBeenCalled();
});

test('unexpected errors while voting are logged and answered generically', async () => {
  const { roundId, categories, members } = await openRound(['An']);
  const kills = categories[0]!;
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

  const i = new FakeInteraction(`vote:${roundId}:${kills.id}`, { kind: 'select', values: [String(members[0]!.id)], roundId });
  await handleInteraction(broken, i);
  expect(i.steps).toEqual([
    { step: 'defer', going: 0, votes: 0 },
    { step: 'edit', content: 'Có lỗi xảy ra, thử lại sau', going: 0, votes: 0 },
  ]);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(String(errors.mock.calls[0]?.[0])).toContain(`vote:${roundId}:${kills.id}`);
  expect(String(errors.mock.calls[0]?.[1] ?? '')).not.toBe(''); // lỗi gốc đi kèm trong log
});

// ---------------------------------------------------------------------------
// Menu treo thưởng
// ---------------------------------------------------------------------------

async function bountyOf(title: string, sessionId: number | null = null): Promise<number> {
  const mod = await testDb.member.findFirstOrThrow({ where: { accessLevel: 'admin' } });
  return (await createBounty(ctx, mod.id, { title, description: null, points: 5, roleId: null, sessionId })).id;
}

test('bounty menu defers, upserts the presser and claims each chosen bounty with one line per item', async () => {
  const sessionId = await openSession();
  const kills = await bountyOf('Giết *3* ngỗng', sessionId);
  const survive = await bountyOf('Sống sót');
  await handleInteraction(ctx, new FakeInteraction(`att:join:${sessionId}`));

  const i = new FakeInteraction(`bounty:claim:${sessionId}`, { kind: 'select', values: [String(kills), String(survive)], sessionId });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([
    { step: 'defer', going: 1 },
    {
      step: 'edit',
      content: '✅ **Giết \\*3\\* ngỗng** — Đã gửi, chờ mod duyệt\n✅ **Sống sót** — Đã gửi, chờ mod duyệt',
      going: 1,
    },
  ]);
  const presser = await testDb.member.findUniqueOrThrow({ where: { discordId: 'u1' } });
  const claims = await testDb.bountyClaim.findMany({ orderBy: { bountyId: 'asc' } });
  expect(claims.map((c) => ({ bountyId: c.bountyId, memberId: c.memberId, sessionId: c.sessionId, status: c.status, source: c.source }))).toEqual([
    { bountyId: kills, memberId: presser.id, sessionId, status: 'pending', source: 'discord' },
    { bountyId: survive, memberId: presser.id, sessionId, status: 'pending', source: 'discord' },
  ]);

  // Chọn lại: một mục đã nhận, mục kia vẫn báo riêng.
  const again = new FakeInteraction(`bounty:claim:${sessionId}`, { kind: 'select', values: [String(survive)] });
  await handleInteraction(ctx, again);
  expect(again.steps.at(-1)).toMatchObject({ step: 'edit', content: '❌ **Sống sót** — Bạn đã nhận mục này ở buổi này rồi' });
  expect(errors).not.toHaveBeenCalled();
});

test('claiming from the menu needs no attendance: a new user and one who left the session both claim (owner decision 2026-10-30)', async () => {
  const sessionId = await openSession();
  const survive = await bountyOf('Sống sót');

  const i = new FakeInteraction(`bounty:claim:${sessionId}`, { kind: 'select', values: [String(survive)], member: guildMember('new-1', 'Người mới') });
  await handleInteraction(ctx, i);
  const fresh = await testDb.member.findUniqueOrThrow({ where: { discordId: 'new-1' } });
  expect(fresh).toMatchObject({ displayName: 'Người mới' });
  expect(i.steps.at(-1)).toMatchObject({ content: '✅ **Sống sót** — Đã gửi, chờ mod duyệt' });

  // Tham gia rồi rời buổi (điểm danh `cancelled`) vẫn nhận được.
  await handleInteraction(ctx, new FakeInteraction(`att:join:${sessionId}`, { member: guildMember('u2') }));
  await handleInteraction(ctx, new FakeInteraction(`att:leave:${sessionId}`, { member: guildMember('u2') }));
  const left = await testDb.member.findUniqueOrThrow({ where: { discordId: 'u2' } });
  expect(await testDb.attendance.findFirst({ where: { sessionId, memberId: left.id } })).toMatchObject({ status: 'cancelled' });
  const j = new FakeInteraction(`bounty:claim:${sessionId}`, { kind: 'select', values: [String(survive)], member: guildMember('u2') });
  await handleInteraction(ctx, j);
  expect(j.steps.at(-1)).toMatchObject({ content: '✅ **Sống sót** — Đã gửi, chờ mod duyệt' });
  expect(await testDb.bountyClaim.findMany({ select: { memberId: true, source: true }, orderBy: { id: 'asc' } })).toEqual([
    { memberId: fresh.id, source: 'discord' },
    { memberId: left.id, source: 'discord' },
  ]);
});

test('bad values are reported per item', async () => {
  const sessionId = await openSession();
  const survive = await bountyOf('Sống sót');
  const other = await openSession();
  const elsewhere = await bountyOf('Chỉ buổi khác', other);

  const mixed = new FakeInteraction(`bounty:claim:${sessionId}`, { kind: 'select', values: [String(elsewhere), 'abc', String(survive), String(survive)] });
  await handleInteraction(ctx, mixed);
  expect(mixed.steps.at(-1)).toMatchObject({
    content: [
      '❌ **Chỉ buổi khác** — Mục treo thưởng không áp dụng cho buổi này',
      '❌ **Mục không rõ** — Mục treo thưởng không áp dụng cho buổi này',
      '✅ **Sống sót** — Đã gửi, chờ mod duyệt',
    ].join('\n'),
  });
  expect(await testDb.bountyClaim.count()).toBe(1);
});

test('unexpected errors on one bounty are logged and answered generically without blocking the others', async () => {
  const sessionId = await openSession();
  const a = await bountyOf('A');
  const b = await bountyOf('B');
  await handleInteraction(ctx, new FakeInteraction(`att:join:${sessionId}`));

  // Giao dịch ghi lần nhận đầu tiên hỏng (DB chập chờn); lần sau chạy thật.
  let failNext = true;
  const flaky = new Proxy(testDb, {
    get(target, prop) {
      if (prop === '$transaction' && failNext) {
        failNext = false;
        return async () => {
          throw new Error('DB chập chờn');
        };
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const i = new FakeInteraction(`bounty:claim:${sessionId}`, { kind: 'select', values: [String(a), String(b)] });
  await handleInteraction({ ...ctx, db: flaky }, i);
  expect(i.steps.at(-1)?.content).toBe('❌ **A** — Có lỗi xảy ra, thử lại sau\n✅ **B** — Đã gửi, chờ mod duyệt');
  expect(errors).toHaveBeenCalledWith(expect.stringContaining('Lỗi nhận treo thưởng'), expect.any(Error));
});

test('bounty menu outside the main guild is refused', async () => {
  const i = new FakeInteraction('bounty:claim:1', { kind: 'select', values: ['1'], guildId: 'other' });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([{ step: 'reply', content: 'Bot chỉ dùng trong server chính', going: 0 }]);
});
