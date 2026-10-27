import type { Member, Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Ctx } from '../../../src/server/ctx.js';
import type { OAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { createWebSession } from '../../../src/server/modules/auth/sessions.js';
import { buildApp } from '../../../src/server/web/app.js';
import type { BadgeDto, PublicMemberDto } from '../../../src/shared/api-types.js';
import { BADGES, badgeDef, monthlyBadgeTitle } from '../../../src/shared/badges.js';
import type { BadgeKey } from '../../../src/shared/badges.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, createSession } from '../../helpers/factories.js';

/** Không route nào ở đây đụng tới OAuth. */
const oauth: OAuthClient = {
  authorizeUrl: () => 'https://discord.test/authorize',
  exchange: async () => {
    throw new Error('không dùng');
  },
};

let ctx: Ctx;
let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  ({ ctx } = makeTestCtx());
  app = await buildApp(ctx, { oauth });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

/** Cookie phiên (đã ký) của một thành viên — không qua OAuth. */
async function sidFor(member: Member): Promise<string> {
  const session = await createWebSession(ctx, member.id);
  return app.signCookie(session.id);
}

const memberWithSid = async (p: Parameters<typeof createMember>[1] = {}) => {
  const member = await createMember(testDb, p);
  return { member, sid: await sidFor(member) };
};

const get = (url: string, sid?: string) => app.inject({ url, cookies: sid ? { ggd_sid: sid } : {} });

const errorBody = (code: string, message: string) => ({ error: { code, message } });
const UNAUTHENTICATED = errorBody('UNAUTHENTICATED', 'Bạn cần đăng nhập');
const INVALID = errorBody('VALIDATION', 'Dữ liệu không hợp lệ');
const NOT_FOUND = errorBody('NOT_FOUND', 'Không tìm thấy');

/** Giờ trao của danh hiệu tháng 10/2026 (00:05 VN ngày 4/11) và tháng 9/2026. */
const AWARDED_OCT = '2026-11-03T17:05:00.000Z';
const AWARDED_SEP = '2026-10-03T17:05:00.000Z';
/** Một cột mốc trao lẻ giữa hai đợt trên. */
const AWARDED_MILESTONE = '2026-10-20T03:00:00.000Z';

/**
 * Ghi thẳng một dòng `member_badges` như job trao đã làm: danh hiệu tháng có `periodId`
 * `YYYY-MM` và tên kèm tháng, cột mốc có `periodId = ''` và tên trong danh mục.
 */
async function grant(memberId: number, key: BadgeKey, awardedAt: string, periodId = '', detail = 'chi tiết') {
  const def = badgeDef(key);
  return testDb.memberBadge.create({
    data: {
      memberId,
      badgeKey: key,
      periodId,
      title: def.kind === 'monthly' ? monthlyBadgeTitle(def.name, periodId) : def.name,
      icon: def.icon,
      detail,
      awardedAt: new Date(awardedAt),
    },
  });
}

const ids = (dtos: { id: number }[]) => dtos.map((d) => d.id);

// ---------------------------------------------------------------------------
// Đăng nhập
// ---------------------------------------------------------------------------

test('both routes need a login', async () => {
  const member = await createMember(testDb);
  await grant(member.id, 'games_10', AWARDED_MILESTONE);

  for (const url of ['/api/badges', `/api/members/${member.id}`]) {
    const res = await get(url);
    expect(res.statusCode, url).toBe(401);
    expect(res.json()).toEqual(UNAUTHENTICATED);
  }
});

// ---------------------------------------------------------------------------
// Tường huy hiệu
// ---------------------------------------------------------------------------

test('badge wall lists every badge newest first with the frozen text and the member', async () => {
  const { member: an, sid } = await memberWithSid({ displayName: 'An', avatarUrl: 'https://cdn.test/an.png' });
  const binh = await createMember(testDb, { displayName: 'Bình', avatarUrl: null });

  // Dòng mới hơn có id NHỎ hơn: thứ tự phải theo `awardedAt`, không theo id.
  const octSmvp = await grant(an.id, 'smvp', AWARDED_OCT, '2026-10', '7 lần MVP');
  const sepGrinder = await grant(binh.id, 'grinder', AWARDED_SEP, '2026-09', '12 trận');
  const sepSmvp = await grant(binh.id, 'smvp', AWARDED_SEP, '2026-09', '3 lần MVP');
  const milestone = await grant(binh.id, 'games_10', AWARDED_MILESTONE, '', 'Đã đi 10 trận');

  const res = await get('/api/badges', sid);
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json<BadgeDto[]>();
  // Cùng `awardedAt` (hai danh hiệu tháng 9) → id giảm dần.
  expect(ids(body)).toEqual([octSmvp.id, milestone.id, sepSmvp.id, sepGrinder.id]);

  expect(body[0]).toEqual({
    id: octSmvp.id,
    badgeKey: 'smvp',
    kind: 'monthly',
    periodId: '2026-10',
    title: 'SMVP tháng 10/2026',
    icon: '👑',
    detail: '7 lần MVP',
    awardedAt: AWARDED_OCT,
    member: { id: an.id, displayName: 'An', avatarUrl: 'https://cdn.test/an.png' },
  });
  expect(body[1]).toEqual({
    id: milestone.id,
    badgeKey: 'games_10',
    kind: 'milestone',
    periodId: '',
    title: 'Quen mặt',
    icon: '🎮',
    detail: 'Đã đi 10 trận',
    awardedAt: AWARDED_MILESTONE,
    member: { id: binh.id, displayName: 'Bình', avatarUrl: null },
  });
});

test('a row whose key left the catalogue still lists, with kind inferred from periodId', async () => {
  const { member, sid } = await memberWithSid({ displayName: 'An' });
  // Khoá không (còn) có trong `BADGES`: chữ đóng băng vẫn hiện, `kind` suy từ `periodId`.
  const legacy = (badgeKey: string, periodId: string, awardedAt: string) =>
    testDb.memberBadge.create({
      data: { memberId: member.id, badgeKey, periodId, title: 'Danh hiệu cũ', icon: '🏅', detail: 'chi tiết cũ', awardedAt: new Date(awardedAt) },
    });
  const oldMonthly = await legacy('legacy_monthly', '2026-10', AWARDED_OCT);
  const oldMilestone = await legacy('legacy_milestone', '', AWARDED_MILESTONE);
  expect(BADGES.some((def) => def.key === 'legacy_monthly' || def.key === 'legacy_milestone')).toBe(false);

  const wall = await get('/api/badges', sid);
  expect(wall.statusCode, wall.body).toBe(200);
  expect(wall.json<BadgeDto[]>()).toMatchObject([
    { id: oldMonthly.id, badgeKey: 'legacy_monthly', kind: 'monthly', periodId: '2026-10', title: 'Danh hiệu cũ', icon: '🏅' },
    { id: oldMilestone.id, badgeKey: 'legacy_milestone', kind: 'milestone', periodId: '', title: 'Danh hiệu cũ', icon: '🏅' },
  ]);

  // Trang thành viên đi qua cùng `toBadgeDto`.
  const page = await get(`/api/members/${member.id}`, sid);
  expect(page.statusCode).toBe(200);
  expect(page.json<PublicMemberDto>().badges.map((b) => [b.badgeKey, b.kind])).toEqual([
    ['legacy_monthly', 'monthly'],
    ['legacy_milestone', 'milestone'],
  ]);
});

test('badge wall is empty when nothing has been awarded', async () => {
  const { sid } = await memberWithSid();
  const res = await get('/api/badges', sid);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual([]);
});

test('before continues after the given row across different award times', async () => {
  const { member, sid } = await memberWithSid();
  const other = await createMember(testDb);
  const oct = await grant(member.id, 'smvp', AWARDED_OCT, '2026-10');
  const octOther = await grant(other.id, 'fun_king', AWARDED_OCT, '2026-10');
  const milestone = await grant(member.id, 'games_10', AWARDED_MILESTONE);
  const sep = await grant(member.id, 'smvp', AWARDED_SEP, '2026-09');

  const first = await get('/api/badges?limit=2', sid);
  expect(ids(first.json<BadgeDto[]>())).toEqual([octOther.id, oct.id]);

  // `before` = id dòng cuối trang trước, kể cả khi dòng kế có `awardedAt` khác.
  const second = await get(`/api/badges?before=${oct.id}&limit=2`, sid);
  expect(ids(second.json<BadgeDto[]>())).toEqual([milestone.id, sep.id]);

  // `before` ở giữa một nhóm cùng `awardedAt`: chỉ lấy dòng có id nhỏ hơn trong nhóm, rồi các nhóm cũ hơn.
  const fromOther = await get(`/api/badges?before=${octOther.id}&limit=10`, sid);
  expect(ids(fromOther.json<BadgeDto[]>())).toEqual([oct.id, milestone.id, sep.id]);

  const last = await get(`/api/badges?before=${sep.id}`, sid);
  expect(last.statusCode).toBe(200);
  expect(last.json()).toEqual([]);
});

test('paging 120 rows that share one awardedAt returns 50+50+20 with no repeats or gaps', async () => {
  const { sid } = await memberWithSid();
  // 8 thành viên × 16 danh hiệu = 128 tổ hợp (badgeKey, periodId, memberId) khác nhau; lấy 120, cùng một giờ trao.
  const members: Member[] = [];
  for (let i = 0; i < 8; i += 1) members.push(await createMember(testDb));
  const data: Prisma.MemberBadgeCreateManyInput[] = [];
  for (const m of members) {
    for (const def of BADGES) {
      const periodId = def.kind === 'monthly' ? '2026-10' : '';
      data.push({
        memberId: m.id,
        badgeKey: def.key,
        periodId,
        title: def.kind === 'monthly' ? monthlyBadgeTitle(def.name, periodId) : def.name,
        icon: def.icon,
        detail: 'chi tiết',
        awardedAt: new Date(AWARDED_OCT),
      });
    }
  }
  await testDb.memberBadge.createMany({ data: data.slice(0, 120) });
  const all = await testDb.memberBadge.findMany({ select: { id: true }, orderBy: { id: 'desc' } });
  expect(all).toHaveLength(120);

  const page1 = await get('/api/badges', sid);
  expect(page1.statusCode, page1.body).toBe(200);
  const rows1 = page1.json<BadgeDto[]>();
  expect(rows1).toHaveLength(50);

  const page2 = await get(`/api/badges?before=${rows1[49]!.id}`, sid);
  const rows2 = page2.json<BadgeDto[]>();
  expect(rows2).toHaveLength(50);

  const page3 = await get(`/api/badges?before=${rows2[49]!.id}`, sid);
  const rows3 = page3.json<BadgeDto[]>();
  expect(rows3).toHaveLength(20);

  const page4 = await get(`/api/badges?before=${rows3[19]!.id}`, sid);
  expect(page4.json()).toEqual([]);

  // Ba trang nối lại = đúng 120 dòng, mỗi dòng một lần, id giảm dần.
  const seen = [...ids(rows1), ...ids(rows2), ...ids(rows3)];
  expect(seen).toEqual(all.map((r) => r.id));
  expect(new Set(seen).size).toBe(120);
  for (const dto of [...rows1, ...rows2, ...rows3]) expect(dto.awardedAt).toBe(AWARDED_OCT);
});

test('limit is 1..100 (default 50) and before must be an existing id', async () => {
  const { member, sid } = await memberWithSid();
  const row = await grant(member.id, 'games_10', AWARDED_MILESTONE);

  for (const query of ['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'before=junk', 'before=0', 'before=-1', 'before=1.5', 'before=']) {
    const res = await get(`/api/badges?${query}`, sid);
    expect(res.statusCode, query).toBe(400);
    expect(res.json(), query).toEqual(INVALID);
  }

  // Id đúng dạng nhưng không có trong `member_badges`: không lặng lẽ trả trang đầu.
  const unknown = await get(`/api/badges?before=${row.id + 1000}`, sid);
  expect(unknown.statusCode).toBe(400);
  expect(unknown.json()).toEqual(errorBody('VALIDATION', 'Mốc phân trang không hợp lệ'));

  for (const query of ['limit=1', 'limit=100', `before=${row.id}&limit=1`]) {
    const res = await get(`/api/badges?${query}`, sid);
    expect(res.statusCode, query).toBe(200);
  }
});

// ---------------------------------------------------------------------------
// Trang thành viên công khai
// ---------------------------------------------------------------------------

test('public member page lists only that member’s badges, newest first', async () => {
  const { sid } = await memberWithSid({ displayName: 'Người xem' });
  const joinedAt = new Date('2026-08-01T05:00:00.000Z');
  const an = await createMember(testDb, { displayName: 'An', avatarUrl: 'https://cdn.test/an.png', joinedAt });
  const binh = await createMember(testDb, { displayName: 'Bình' });

  const anSep = await grant(an.id, 'grinder', AWARDED_SEP, '2026-09', '12 trận');
  await grant(binh.id, 'smvp', AWARDED_SEP, '2026-09', '3 lần MVP');
  const anMilestone = await grant(an.id, 'games_10', AWARDED_MILESTONE, '', 'Đã đi 10 trận');
  const anOct = await grant(an.id, 'smvp', AWARDED_OCT, '2026-10', '7 lần MVP');

  const res = await get(`/api/members/${an.id}`, sid);
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json<PublicMemberDto>();
  expect(body).toEqual({
    id: an.id,
    displayName: 'An',
    avatarUrl: 'https://cdn.test/an.png',
    joinedAt: '2026-08-01T05:00:00.000Z',
    // now = 2026-10-22T12:00Z (ngày 22/10 VN); 01/08 → 22/10 = 82 ngày.
    daysInServer: 82,
    games: 0,
    left: false,
    badges: [
      {
        id: anOct.id,
        badgeKey: 'smvp',
        kind: 'monthly',
        periodId: '2026-10',
        title: 'SMVP tháng 10/2026',
        icon: '👑',
        detail: '7 lần MVP',
        awardedAt: AWARDED_OCT,
        member: { id: an.id, displayName: 'An', avatarUrl: 'https://cdn.test/an.png' },
      },
      {
        id: anMilestone.id,
        badgeKey: 'games_10',
        kind: 'milestone',
        periodId: '',
        title: 'Quen mặt',
        icon: '🎮',
        detail: 'Đã đi 10 trận',
        awardedAt: AWARDED_MILESTONE,
        member: { id: an.id, displayName: 'An', avatarUrl: 'https://cdn.test/an.png' },
      },
      {
        id: anSep.id,
        badgeKey: 'grinder',
        kind: 'monthly',
        periodId: '2026-09',
        title: 'Chăm cày tháng 09/2026',
        icon: '🔥',
        detail: '12 trận',
        awardedAt: AWARDED_SEP,
        member: { id: an.id, displayName: 'An', avatarUrl: 'https://cdn.test/an.png' },
      },
    ],
  });
});

test('a member without badges has an empty list; one who left is flagged', async () => {
  const { member: me, sid } = await memberWithSid();
  const gone = await createMember(testDb, { displayName: 'Kẹ Rời', status: 'left', leftAt: new Date() });

  const mine = await get(`/api/members/${me.id}`, sid);
  expect(mine.statusCode).toBe(200);
  expect(mine.json<PublicMemberDto>()).toMatchObject({ id: me.id, left: false, badges: [] });

  const theirs = await get(`/api/members/${gone.id}`, sid);
  expect(theirs.statusCode).toBe(200);
  expect(theirs.json<PublicMemberDto>()).toMatchObject({ id: gone.id, displayName: 'Kẹ Rời', left: true, badges: [] });
});

test('public member page uses the Discord join date when known, counts to leftAt, and shows adjusted games', async () => {
  const { sid } = await memberWithSid();
  // Ngày vào Discord có → `joinedAt` của DTO là ngày đó (không phải ngày app thấy lần đầu).
  const guildJoinedAt = new Date('2026-09-30T17:30:00.000Z'); // 00:30 VN ngày 01/10 → tới 22/10 = 21 ngày
  const an = await createMember(testDb, { displayName: 'An', joinedAt: new Date('2026-10-20T00:00:00Z'), guildJoinedAt, gamesAdjustment: 5 });
  const s = await createSession(testDb, { status: 'ended', endedAt: new Date('2026-10-20T16:00:00Z') });
  await testDb.attendance.create({ data: { sessionId: s.id, memberId: an.id, status: 'going' } });

  const res = await get(`/api/members/${an.id}`, sid);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json<PublicMemberDto>()).toMatchObject({ joinedAt: guildJoinedAt.toISOString(), daysInServer: 21, games: 6 });

  // Đã rời: đếm tới `leftAt` (01/10 → 05/10 VN = 4 ngày); chỉnh âm quá số tự đếm → 0.
  const gone = await createMember(testDb, {
    displayName: 'Rời',
    joinedAt: new Date('2026-10-01T03:00:00Z'),
    status: 'left',
    leftAt: new Date('2026-10-05T03:00:00Z'),
    gamesAdjustment: -2,
  });
  const theirs = await get(`/api/members/${gone.id}`, sid);
  expect(theirs.json<PublicMemberDto>()).toMatchObject({ joinedAt: '2026-10-01T03:00:00.000Z', daysInServer: 4, games: 0, left: true });
});

test('public member page never exposes email, Discord id, access level or member code', async () => {
  const { sid } = await memberWithSid();
  const admin = await createMember(testDb, {
    displayName: 'Quản trị',
    email: 'secret@example.com',
    discordId: '123456789012345678',
    accessLevel: 'admin',
    memberCode: 'GGD-0777',
  });
  await grant(admin.id, 'director', AWARDED_MILESTONE, '', 'Highlight đầu tiên được duyệt');

  const res = await get(`/api/members/${admin.id}`, sid);
  expect(res.statusCode).toBe(200);
  // Soi thân phản hồi THÔ: không chỉ kiểm DTO đã parse.
  for (const leak of ['email', 'secret@example.com', 'discordId', '123456789012345678', 'accessLevel', 'admin', 'memberCode', 'GGD-0777', 'notifyEmail', 'status', 'leftAt', 'gamesAdjustment']) {
    expect(res.body, leak).not.toContain(leak);
  }
  const body = res.json<PublicMemberDto>();
  expect(Object.keys(body).sort()).toEqual(['avatarUrl', 'badges', 'daysInServer', 'displayName', 'games', 'id', 'joinedAt', 'left']);
  expect(Object.keys(body.badges[0]!.member).sort()).toEqual(['avatarUrl', 'displayName', 'id']);
});

test('unknown or malformed member id → 404', async () => {
  const { member, sid } = await memberWithSid();
  for (const id of [member.id + 1000, 'abc', '1.5', '0', '-1', '99999999999']) {
    const res = await get(`/api/members/${id}`, sid);
    expect(res.statusCode, String(id)).toBe(404);
    expect(res.json(), String(id)).toEqual(NOT_FOUND);
  }
});
