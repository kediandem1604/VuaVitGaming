import type { Member, Role } from '@prisma/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Ctx } from '../../src/server/ctx.js';
import { reviewReport, submitReport } from '../../src/server/modules/stats/reports.js';
import { assignRanks, rankRoleSpec, syncRankRoles } from '../../src/server/modules/stats/rank-roles.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, roleByKey } from '../helpers/factories.js';
import type { FakeRankRoles } from '../helpers/fakes.js';

/** 12:00 ngày 10/10/2026 giờ VN: mùa 2026-10. */
const NOW = '2026-10-10T05:00:00Z';

const DUCK_1 = '🦆 Top 1 Vịt';
const DUCK_2 = '🦆 Top 2 Vịt';
const DUCK_3 = '🦆 Top 3 Vịt';

let ctx: Ctx;
let rankRoles: FakeRankRoles;
let mod: Member;
let duck: Role;

beforeEach(async () => {
  await resetDb();
  let setNow: (iso: string) => void;
  ({ ctx, rankRoles, setNow } = makeTestCtx());
  setNow(NOW);
  mod = await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' });
  duck = await roleByKey(testDb, 'duck');
});
afterEach(() => vi.restoreAllMocks());

/** Khai `kills` mạng giết bằng role (mặc định Vịt) ngày 10/10 rồi duyệt ngay. */
async function approvedKills(memberId: number, kills: number, roleId = duck.id): Promise<void> {
  const r = await submitReport(ctx, memberId, { roleId, value: kills, playedOn: '2026-10-10' });
  await reviewReport(ctx, { id: mod.id, accessLevel: mod.accessLevel }, r.id, { approve: true });
}

async function fourDucks(): Promise<Member[]> {
  const members = [];
  for (const [i, kills] of [4, 3, 2, 1].entries()) {
    const m = await createMember(testDb, { discordId: `duck-${i + 1}` });
    await approvedKills(m.id, kills);
    members.push(m);
  }
  return members;
}

test('creates nine rank roles, remembers their ids and gives the duck top 3 their roles', async () => {
  await fourDucks();

  await syncRankRoles(ctx);

  expect([...rankRoles.roles.values()].map((r) => r.spec.name)).toEqual([
    '🪿 Top 1 Ngỗng',
    '🪿 Top 2 Ngỗng',
    '🪿 Top 3 Ngỗng',
    DUCK_1,
    DUCK_2,
    DUCK_3,
    '🐦 Top 1 Phe thứ 3',
    '🐦 Top 2 Phe thứ 3',
    '🐦 Top 3 Phe thứ 3',
  ]);
  expect(rankRoleSpec('duck', 1)).toEqual({ name: DUCK_1, color: 0xe5484d, hoist: true });
  expect(rankRoleSpec('duck', 2).hoist).toBe(false);
  expect(await testDb.appSetting.findUnique({ where: { key: 'rank_role_duck_1' } })).toMatchObject({ value: 'rank-4' });

  expect(rankRoles.holdersOf(DUCK_1)).toEqual(['duck-1']);
  expect(rankRoles.holdersOf(DUCK_2)).toEqual(['duck-2']);
  expect(rankRoles.holdersOf(DUCK_3)).toEqual(['duck-3']);
  expect(rankRoles.holdersOf('🪿 Top 1 Ngỗng')).toEqual([]);

  // Chạy lại: không gắn/gỡ gì thêm, không tạo role mới.
  rankRoles.calls = [];
  await syncRankRoles(ctx);
  expect(rankRoles.calls).toEqual([]);
  expect(rankRoles.roles.size).toBe(9);
});

test('moves roles when the ranking changes and strips roles held by anyone else', async () => {
  const [first, , third] = await fourDucks();
  await syncRankRoles(ctx);

  // Người hạng 3 vượt lên đầu; ai đó tự gắn tay role Top 1.
  await approvedKills(third!.id, 5);
  const top1Id = (await testDb.appSetting.findUniqueOrThrow({ where: { key: 'rank_role_duck_1' } })).value;
  rankRoles.roles.get(top1Id)!.holders.add('someone-else');

  await syncRankRoles(ctx);

  expect(rankRoles.holdersOf(DUCK_1)).toEqual(['duck-3']);
  expect(rankRoles.holdersOf(DUCK_2)).toEqual(['duck-1']);
  expect(rankRoles.holdersOf(DUCK_3)).toEqual(['duck-2']);
  expect(first!.discordId).toBe('duck-1');
});

test('keeps a role the admin renamed instead of creating a new one', async () => {
  await fourDucks();
  await syncRankRoles(ctx);
  const top1Id = (await testDb.appSetting.findUniqueOrThrow({ where: { key: 'rank_role_duck_1' } })).value;
  rankRoles.roles.get(top1Id)!.spec = { ...rankRoles.roles.get(top1Id)!.spec, name: 'Vua Vịt' };

  await syncRankRoles(ctx);

  expect(rankRoles.roles.size).toBe(9);
  expect(rankRoles.holdersOf('Vua Vịt')).toEqual(['duck-1']);
});

test('a member who left the guild is skipped and the next one moves up', async () => {
  const [first] = await fourDucks();
  await testDb.member.update({ where: { id: first!.id }, data: { status: 'left' } });

  await syncRankRoles(ctx);

  expect(rankRoles.holdersOf(DUCK_1)).toEqual(['duck-2']);
  expect(rankRoles.holdersOf(DUCK_2)).toEqual(['duck-3']);
  expect(rankRoles.holdersOf(DUCK_3)).toEqual(['duck-4']);
});

test('someone on top of two factions keeps only their best rank', async () => {
  const [first, second] = await fourDucks();
  const goose = await roleByKey(testDb, 'goose');
  const g = await createMember(testDb, { discordId: 'goose-1' });
  // Ngỗng: g 30, duck-1 20, duck-2 10 → duck-1 Top 2 Ngỗng nhưng đã là Top 1 Vịt; duck-2 Top 3 Ngỗng nhưng đã là Top 2 Vịt.
  await approvedKills(g.id, 3, goose.id);
  await approvedKills(first!.id, 2, goose.id);
  await approvedKills(second!.id, 1, goose.id);

  await syncRankRoles(ctx);

  expect(rankRoles.holdersOf(DUCK_1)).toEqual(['duck-1']);
  expect(rankRoles.holdersOf(DUCK_2)).toEqual(['duck-2']);
  expect(rankRoles.holdersOf('🪿 Top 1 Ngỗng')).toEqual(['goose-1']);
  // Không còn ai khác có điểm Ngỗng → Top 2, Top 3 Ngỗng bỏ trống.
  expect(rankRoles.holdersOf('🪿 Top 2 Ngỗng')).toEqual([]);
  expect(rankRoles.holdersOf('🪿 Top 3 Ngỗng')).toEqual([]);
});

test('assignRanks gives each member one rank, their best, and fills the gaps', () => {
  const board = (...rows: [number, number][]) => rows.map(([memberId, points]) => ({ memberId, points }));
  // 1 đứng đầu cả hai phe (Vịt nhiều điểm hơn); 2 là Top 2 Ngỗng và Top 1 Phe thứ 3.
  const result = assignRanks(
    {
      goose: board([1, 50], [2, 40], [3, 30], [4, 20]),
      duck: board([1, 90], [5, 80], [6, 70]),
      neutral: board([2, 10]),
    },
    3,
  );
  expect(result).toEqual({
    goose: [3, 4],
    duck: [1, 5, 6],
    neutral: [2],
  });
});

test('assignRanks breaks an equal-points tie by faction order', () => {
  const result = assignRanks({ goose: [{ memberId: 1, points: 10 }], duck: [{ memberId: 1, points: 10 }], neutral: [] }, 3);
  expect(result).toEqual({ goose: [1], duck: [], neutral: [] });
});

test('ranks by faction total, not by single role', async () => {
  const goose = await roleByKey(testDb, 'goose');
  const sheriff = await roleByKey(testDb, 'sheriff');
  const a = await createMember(testDb, { discordId: 'a' });
  const b = await createMember(testDb, { discordId: 'b' });
  // A: Ngỗng 20 + Cảnh sát trưởng 20 = 40 cả phe; B: Ngỗng 30 — hơn A ở từng role nhưng thua tổng.
  await approvedKills(a.id, 2, goose.id);
  await approvedKills(a.id, 2, sheriff.id);
  await approvedKills(b.id, 3, goose.id);

  await syncRankRoles(ctx);

  expect(rankRoles.holdersOf('🪿 Top 1 Ngỗng')).toEqual(['a']);
  expect(rankRoles.holdersOf('🪿 Top 2 Ngỗng')).toEqual(['b']);
});

test('missing Manage Roles warns once instead of failing every tick', async () => {
  await fourDucks();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  rankRoles.denied = true;

  await expect(syncRankRoles(ctx)).resolves.toBeUndefined();
  await expect(syncRankRoles(ctx)).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toContain('Manage Roles');

  rankRoles.denied = false;
  await syncRankRoles(ctx);
  expect(rankRoles.holdersOf(DUCK_1)).toEqual(['duck-1']);
});
