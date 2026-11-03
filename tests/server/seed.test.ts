import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, test } from 'vitest';
import type { Faction } from '@prisma/client';
import { dateOnlyToDb } from '../../src/server/lib/time.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createMember, roleByKey } from '../helpers/factories.js';
import { seedReferenceData } from '../../src/server/seed/seed.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

beforeEach(resetDb);

test('main roles per faction', async () => {
  const count = (faction: Faction) => testDb.role.count({ where: { faction, active: true, modeId: null } });
  expect(await count('goose')).toBe(30);
  expect(await count('duck')).toBe(31);
  expect(await count('neutral')).toBe(10);
  expect(await testDb.role.count({ where: { NOT: { modeId: null } } })).toBe(20);
  expect(await testDb.role.count({ where: { NOT: { modeId: null }, active: true } })).toBe(0);
});

test('key roles carry spec values', async () => {
  expect(await testDb.role.findUnique({ where: { key: 'swordsman' } })).toMatchObject({
    faction: 'duck',
    nameVi: 'Kiếm sĩ',
    metricLabel: 'Số mạng chém',
    maxPerGame: 15,
  });
  expect(await testDb.role.findUnique({ where: { key: 'cuckoo' } })).toMatchObject({
    faction: 'neutral',
    nameVi: 'Cò gáy',
    metricLabel: 'Số trứng không bị đập',
    maxPerGame: 30,
  });
  expect(await testDb.role.findUnique({ where: { key: 'street_urchin' } })).toMatchObject({
    mapNote: 'Chỉ có ở Ancient Sands',
  });
  expect(await testDb.role.findUnique({ where: { key: 'hoot_sniper' }, include: { mode: true } })).toMatchObject({
    faction: 'duck',
    active: false,
    metricLabel: 'Chưa đặt chỉ số',
    maxPerGame: 15,
    mode: { key: 'hoot_seek' },
  });
});

/** Giá trị đích của Ám sát sau migration và trong seed (spec chỉ số phụ §4). */
const ASSASSIN_TARGET = {
  metricLabel: 'Số mạng đã giết',
  maxPerGame: 15,
  extraMetricLabel: 'Số lần ám sát trong cuộc họp',
  extraMaxPerGame: 2,
  extraPoints: 3,
};

test('seed gives Ám sát the secondary metric and no other role', async () => {
  expect(await testDb.role.findUnique({ where: { key: 'assassin' } })).toMatchObject(ASSASSIN_TARGET);
  const withExtra = await testDb.role.findMany({ where: { NOT: { extraMetricLabel: null } }, select: { key: true } });
  expect(withExtra).toEqual([{ key: 'assassin' }]);
  expect(await testDb.role.count({ where: { OR: [{ NOT: { extraMaxPerGame: null } }, { NOT: { extraPoints: null } }] } })).toBe(1);
});

// ---------------------------------------------------------------------------
// Migration chỉ số phụ: cột mới, CHECK, chuyển dữ liệu Ám sát trên DB có sẵn
// ---------------------------------------------------------------------------

const EXTRA_MIGRATION_SQL = readFileSync(path.join(REPO_ROOT, 'prisma', 'migrations', '20261027090000_role_extra_metric', 'migration.sql'), 'utf8');

/** Câu UPDATE đầu tiên của bảng `table` trong migration (tới dấu `;` kết câu). */
function updateStatement(table: string): string {
  const m = EXTRA_MIGRATION_SQL.match(new RegExp(`UPDATE\\s+"?${table}"?\\s[^;]*;`));
  if (!m) throw new Error(`migration không có UPDATE ${table}`);
  return m[0];
}

test('extra-metric migration text: columns, CHECK, Ám sát conversion', () => {
  const sql = EXTRA_MIGRATION_SQL;
  expect(sql).toMatch(/ALTER TABLE "roles" ADD COLUMN\s+"extra_max_per_game" INTEGER,\s*ADD COLUMN\s+"extra_metric_label" TEXT,\s*ADD COLUMN\s+"extra_points" INTEGER;/);
  expect(sql).toMatch(/ALTER TABLE "stat_reports" ADD COLUMN\s+"extra_value" INTEGER NOT NULL DEFAULT 0;/);
  // CHECK: ba trường cùng null hoặc cùng có.
  expect(sql).toMatch(/ADD CONSTRAINT roles_extra_metric_all_or_none CHECK \(\s*\(extra_metric_label IS NULL AND extra_max_per_game IS NULL AND extra_points IS NULL\)\s*OR \(extra_metric_label IS NOT NULL AND extra_max_per_game IS NOT NULL AND extra_points IS NOT NULL\)\s*\)/);
  expect(sql).toMatch(/ADD CONSTRAINT stat_reports_extra_value_nonneg CHECK \(extra_value >= 0\)/);

  // Role Ám sát: đúng một câu UPDATE roles với đủ năm giá trị đích, chỉ theo key.
  const roleUpdates = [...sql.matchAll(/UPDATE\s+"?roles"?\s[^;]*;/g)].map((m) => m[0]);
  expect(roleUpdates).toHaveLength(1);
  const roleUpdate = roleUpdates[0] ?? '';
  expect(roleUpdate).toMatch(/"?metric_label"?\s*=\s*'Số mạng đã giết'/);
  expect(roleUpdate).toMatch(/"?max_per_game"?\s*=\s*15\b/);
  expect(roleUpdate).toMatch(/"?extra_metric_label"?\s*=\s*'Số lần ám sát trong cuộc họp'/);
  expect(roleUpdate).toMatch(/"?extra_max_per_game"?\s*=\s*2\b/);
  expect(roleUpdate).toMatch(/"?extra_points"?\s*=\s*3\b/);
  expect(roleUpdate).toMatch(/WHERE\s+"?key"?\s*=\s*'assassin'\s*;$/);

  // Lần khai của Ám sát (mọi trạng thái): extra_value = value, value = 0; chỉ role đó.
  const reportUpdates = [...sql.matchAll(/UPDATE\s+"?stat_reports"?\s[^;]*;/g)].map((m) => m[0]);
  expect(reportUpdates).toHaveLength(1);
  expect(reportUpdates[0]).toMatch(
    /SET\s+"?extra_value"?\s*=\s*"?value"?\s*,\s*"?value"?\s*=\s*0\s+WHERE\s+"?role_id"?\s*=\s*\(SELECT\s+"?id"?\s+FROM\s+"?roles"?\s+WHERE\s+"?key"?\s*=\s*'assassin'\)\s*;$/,
  );
  expect(reportUpdates[0]).not.toMatch(/status/);

  // Thứ tự: thêm cột → CHECK → UPDATE role → UPDATE lần khai.
  const at = (needle: string | RegExp) => (typeof needle === 'string' ? sql.indexOf(needle) : sql.search(needle));
  expect(at('ADD COLUMN')).toBeGreaterThanOrEqual(0);
  expect(at('ADD COLUMN')).toBeLessThan(at('roles_extra_metric_all_or_none'));
  expect(at('roles_extra_metric_all_or_none')).toBeLessThan(at(/UPDATE\s+"?roles"?\s/));
  expect(at(/UPDATE\s+"?roles"?\s/)).toBeLessThan(at(/UPDATE\s+"?stat_reports"?\s/));
});

test('extra-metric migration converts Ám sát and its reports only', async () => {
  // Mô phỏng DB thật trước migration: Ám sát còn chỉ số cũ, có lần khai ở mọi trạng thái; role khác có lần khai.
  const assassin = await roleByKey(testDb, 'assassin');
  const duck = await roleByKey(testDb, 'duck');
  await testDb.role.update({
    where: { id: assassin.id },
    data: { metricLabel: 'Số lần ám sát thành công trong cuộc họp', maxPerGame: 2, extraMetricLabel: null, extraMaxPerGame: null, extraPoints: null },
  });
  const member = await createMember(testDb);
  const playedOn = dateOnlyToDb('2026-10-10');
  await testDb.statReport.createMany({
    data: [
      { memberId: member.id, roleId: assassin.id, playedOn, value: 2, status: 'approved' },
      { memberId: member.id, roleId: assassin.id, playedOn, value: 1, status: 'pending' },
      { memberId: member.id, roleId: assassin.id, playedOn, value: 0, status: 'rejected', rejectReason: 'thử' },
      { memberId: member.id, roleId: duck.id, playedOn, value: 5, status: 'approved' },
    ],
  });

  await testDb.$executeRawUnsafe(updateStatement('roles'));
  await testDb.$executeRawUnsafe(updateStatement('stat_reports'));

  expect(await testDb.role.findUniqueOrThrow({ where: { id: assassin.id } })).toMatchObject({ nameVi: 'Ám sát', ...ASSASSIN_TARGET });
  expect(await testDb.role.findUniqueOrThrow({ where: { id: duck.id } })).toMatchObject({
    metricLabel: 'Số mạng đã giết',
    maxPerGame: 15,
    extraMetricLabel: null,
    extraMaxPerGame: null,
    extraPoints: null,
  });
  const reports = await testDb.statReport.findMany({ orderBy: { id: 'asc' }, select: { roleId: true, status: true, value: true, extraValue: true } });
  expect(reports).toEqual([
    { roleId: assassin.id, status: 'approved', value: 0, extraValue: 2 },
    { roleId: assassin.id, status: 'pending', value: 0, extraValue: 1 },
    { roleId: assassin.id, status: 'rejected', value: 0, extraValue: 0 },
    { roleId: duck.id, status: 'approved', value: 5, extraValue: 0 },
  ]);

  // Không có role `assassin` (DB tự tạo): hai câu UPDATE không đổi gì và không lỗi.
  await testDb.statReport.deleteMany({ where: { roleId: assassin.id } });
  await testDb.role.delete({ where: { id: assassin.id } });
  expect(await testDb.$executeRawUnsafe(updateStatement('roles'))).toBe(0);
  expect(await testDb.$executeRawUnsafe(updateStatement('stat_reports'))).toBe(0);
  expect(await testDb.statReport.findMany({ select: { value: true, extraValue: true } })).toEqual([{ value: 5, extraValue: 0 }]);
});

test('database rejects a partial secondary metric and a negative extra value', async () => {
  const swordsman = await roleByKey(testDb, 'swordsman');
  // Chỉ một hoặc hai trong ba trường → CHECK roles_extra_metric_all_or_none.
  await expect(testDb.role.update({ where: { id: swordsman.id }, data: { extraPoints: 3 } })).rejects.toThrow(/roles_extra_metric_all_or_none/);
  await expect(testDb.role.update({ where: { id: swordsman.id }, data: { extraMetricLabel: 'Số lần chém đôi', extraMaxPerGame: 2 } })).rejects.toThrow(
    /roles_extra_metric_all_or_none/,
  );
  await expect(testDb.role.update({ where: { id: swordsman.id }, data: { extraMetricLabel: 'Số lần chém đôi', extraMaxPerGame: 2, extraPoints: 3 } })).resolves.toMatchObject({
    extraPoints: 3,
  });
  await expect(testDb.role.update({ where: { id: swordsman.id }, data: { extraMaxPerGame: null } })).rejects.toThrow(/roles_extra_metric_all_or_none/);

  const member = await createMember(testDb);
  await expect(
    testDb.statReport.create({ data: { memberId: member.id, roleId: swordsman.id, playedOn: dateOnlyToDb('2026-10-10'), value: 1, extraValue: -1 } }),
  ).rejects.toThrow(/stat_reports_extra_value_nonneg/);
  // Mặc định 0.
  const report = await testDb.statReport.create({ data: { memberId: member.id, roleId: swordsman.id, playedOn: dateOnlyToDb('2026-10-10'), value: 1 } });
  expect(report.extraValue).toBe(0);
});

// ---------------------------------------------------------------------------
// Điểm theo role và chỉ số phạt (spec điểm role §4): seed và migration điểm khởi đầu
// ---------------------------------------------------------------------------

const PENALTY_LABEL = 'Số phát bắn sai';
/** Role bắn: điểm 3, phạt "Số phát bắn sai" tối đa = max_per_game, −1 mỗi lần. */
const SHOOTERS = ['lobbyist', 'soldier', 'sheriff', 'avenger'];

/** Giá trị đích cho mọi role theo `key`/`maxPerGame` (spec §4 "Dữ liệu điểm khởi đầu"). */
function expectedPoints(role: { key: string; maxPerGame: number }) {
  if (role.key === 'vigilante') return { points: 5, penaltyMetricLabel: PENALTY_LABEL, penaltyMaxPerGame: 1, penaltyPoints: 3 };
  if (SHOOTERS.includes(role.key)) return { points: 3, penaltyMetricLabel: PENALTY_LABEL, penaltyMaxPerGame: role.maxPerGame, penaltyPoints: 1 };
  return { points: role.maxPerGame === 1 ? 5 : 1, penaltyMetricLabel: null, penaltyMaxPerGame: null, penaltyPoints: null };
}

test('seed gives every role its starting points and penalty metric by key', async () => {
  const roles = await testDb.role.findMany({ select: { key: true, maxPerGame: true, points: true, penaltyMetricLabel: true, penaltyMaxPerGame: true, penaltyPoints: true } });
  expect(roles).toHaveLength(91);
  for (const role of roles) expect(role, role.key).toMatchObject(expectedPoints(role));
  // Vài mốc cụ thể.
  expect(await testDb.role.findUnique({ where: { key: 'vigilante' } })).toMatchObject({ points: 5, penaltyMetricLabel: PENALTY_LABEL, penaltyMaxPerGame: 1, penaltyPoints: 3 });
  expect(await testDb.role.findUnique({ where: { key: 'sheriff' } })).toMatchObject({ maxPerGame: 10, points: 3, penaltyMaxPerGame: 10, penaltyPoints: 1 });
  expect(await testDb.role.findUnique({ where: { key: 'avenger' } })).toMatchObject({ maxPerGame: 5, points: 3, penaltyMaxPerGame: 5, penaltyPoints: 1 });
  expect(await testDb.role.findUnique({ where: { key: 'dodo' } })).toMatchObject({ maxPerGame: 1, points: 5, penaltyMetricLabel: null });
  expect(await testDb.role.findUnique({ where: { key: 'bodyguard' } })).toMatchObject({ maxPerGame: 1, points: 5, penaltyMetricLabel: null });
  expect(await testDb.role.findUnique({ where: { key: 'duck' } })).toMatchObject({ points: 1, penaltyMetricLabel: null });
  expect(await testDb.role.findUnique({ where: { key: 'assassin' } })).toMatchObject({ points: 1, penaltyMetricLabel: null, ...ASSASSIN_TARGET });
  expect(await testDb.role.findUnique({ where: { key: 'hoot_sniper' } })).toMatchObject({ points: 1, penaltyMetricLabel: null });
  expect(await testDb.role.count({ where: { NOT: { penaltyMetricLabel: null } } })).toBe(5);
});

const POINTS_MIGRATION_SQL = readFileSync(
  path.join(REPO_ROOT, 'prisma', 'migrations', '20261028120000_role_points_accusations', 'migration.sql'),
  'utf8',
);

test('role-points migration text: columns, CHECKs, enums, player_accusations, and the starting-point UPDATEs by key', () => {
  const sql = POINTS_MIGRATION_SQL;
  // Enum mới.
  expect(sql).toMatch(/CREATE TYPE "ReportSource" AS ENUM \('self', 'accusation'\);/);
  expect(sql).toMatch(/CREATE TYPE "AccusationStatus" AS ENUM \('pending', 'approved', 'rejected', 'superseded'\);/);
  // roles: points mặc định 1, ba cột phạt null.
  expect(sql).toMatch(/ALTER TABLE "roles" ADD COLUMN\s+"penalty_max_per_game" INTEGER,\s*ADD COLUMN\s+"penalty_metric_label" TEXT,\s*ADD COLUMN\s+"penalty_points" INTEGER,\s*ADD COLUMN\s+"points" INTEGER NOT NULL DEFAULT 1;/);
  expect(sql).toMatch(/ADD CONSTRAINT roles_points_range CHECK \(points BETWEEN 1 AND 100\)/);
  expect(sql).toMatch(/ADD CONSTRAINT roles_penalty_metric_all_or_none CHECK \(\s*\(penalty_metric_label IS NULL AND penalty_max_per_game IS NULL AND penalty_points IS NULL\)\s*OR \(penalty_metric_label IS NOT NULL AND penalty_max_per_game IS NOT NULL AND penalty_points IS NOT NULL\)\s*\)/);
  expect(sql).toMatch(/ADD CONSTRAINT roles_penalty_points_range CHECK \(penalty_points IS NULL OR penalty_points BETWEEN 1 AND 100\)/);
  // stat_reports: penalty_value ≥ 0, bonus_points 0..1, source mặc định self.
  expect(sql).toMatch(/ALTER TABLE "stat_reports" ADD COLUMN\s+"bonus_points" INTEGER NOT NULL DEFAULT 0,\s*ADD COLUMN\s+"penalty_value" INTEGER NOT NULL DEFAULT 0,\s*ADD COLUMN\s+"source" "ReportSource" NOT NULL DEFAULT 'self';/);
  expect(sql).toMatch(/ADD CONSTRAINT stat_reports_penalty_value_nonneg CHECK \(penalty_value >= 0\)/);
  expect(sql).toMatch(/ADD CONSTRAINT stat_reports_bonus_points_range CHECK \(bonus_points BETWEEN 0 AND 1\)/);
  // player_accusations: bảng, khoá, chỉ mục, CHECK.
  expect(sql).toMatch(/CREATE TABLE "player_accusations" \(/);
  for (const column of ['report_id', 'reporter_id', 'accused_id', 'accused_role_id', 'victim_id', 'victim_faction', 'played_on', 'status', 'reject_reason', 'penalty_report_id', 'created_at', 'reviewed_by', 'reviewed_at']) {
    expect(sql, column).toMatch(new RegExp(`"${column}"`));
  }
  expect(sql).toMatch(/CREATE UNIQUE INDEX "player_accusations_report_id_key" ON "player_accusations"\("report_id"\);/);
  expect(sql).toMatch(/CREATE UNIQUE INDEX "player_accusations_penalty_report_id_key" ON "player_accusations"\("penalty_report_id"\);/);
  // Prisma cắt tên chỉ mục còn 63 ký tự.
  expect(sql).toMatch(/CREATE INDEX "player_accusations_accused_id_accused_role_id_victim_id_pla_idx" ON "player_accusations"\("accused_id", "accused_role_id", "victim_id", "played_on", "status"\);/);
  expect(sql).toMatch(/ADD CONSTRAINT player_accusations_not_self CHECK \(accused_id <> reporter_id\)/);
  expect(sql).toMatch(/ADD CONSTRAINT player_accusations_victim_not_accused CHECK \(victim_id <> accused_id\)/);
  for (const fk of ['report_id', 'reporter_id', 'accused_id', 'accused_role_id', 'victim_id', 'penalty_report_id', 'reviewed_by']) {
    expect(sql, fk).toMatch(new RegExp(`ADD CONSTRAINT "player_accusations_${fk}_fkey" FOREIGN KEY \\("${fk}"\\)`));
  }

  // Điểm khởi đầu: ba câu UPDATE roles theo key, câu chung (max_per_game = 1 → 5) đi TRƯỚC hai câu riêng.
  const updates = [...sql.matchAll(/UPDATE\s+"?roles"?\s[^;]*;/g)].map((m) => m[0]);
  expect(updates).toHaveLength(3);
  const [generic, vigilante, shooters] = updates as [string, string, string];
  expect(generic).toMatch(/SET\s+"?points"?\s*=\s*5\s+WHERE\s+"?max_per_game"?\s*=\s*1\s*;$/);
  expect(vigilante).toMatch(/"?points"?\s*=\s*5\b/);
  expect(vigilante).toMatch(/"?penalty_metric_label"?\s*=\s*'Số phát bắn sai'/);
  expect(vigilante).toMatch(/"?penalty_max_per_game"?\s*=\s*1\b/);
  expect(vigilante).toMatch(/"?penalty_points"?\s*=\s*3\b/);
  expect(vigilante).toMatch(/WHERE\s+"?key"?\s*=\s*'vigilante'\s*;$/);
  expect(shooters).toMatch(/"?points"?\s*=\s*3\b/);
  expect(shooters).toMatch(/"?penalty_metric_label"?\s*=\s*'Số phát bắn sai'/);
  expect(shooters).toMatch(/"?penalty_max_per_game"?\s*=\s*"?max_per_game"?/);
  expect(shooters).toMatch(/"?penalty_points"?\s*=\s*1\b/);
  expect(shooters).toMatch(/WHERE\s+"?key"?\s+IN\s*\('lobbyist',\s*'soldier',\s*'sheriff',\s*'avenger'\)\s*;$/);
  // Không đụng stat_reports hay role_titles bằng UPDATE.
  expect(sql).not.toMatch(/UPDATE\s+"?stat_reports"?/);
  expect(sql).not.toMatch(/UPDATE\s+"?role_titles"?/);
  // Thứ tự: thêm cột → CHECK → UPDATE.
  expect(sql.indexOf('ADD COLUMN')).toBeLessThan(sql.indexOf('roles_points_range'));
  expect(sql.indexOf('roles_penalty_metric_all_or_none')).toBeLessThan(sql.search(/UPDATE\s+"?roles"?\s/));
});

test('role-points migration sets the starting points by key on an existing DB and leaves role_titles alone', async () => {
  // Mô phỏng DB thật ngay sau khi thêm cột: mọi role points = 1, chưa có chỉ số phạt; có mùa đã chốt.
  await testDb.role.updateMany({ data: { points: 1, penaltyMetricLabel: null, penaltyMaxPerGame: null, penaltyPoints: null } });
  // Admin đã đổi tối đa của Cảnh sát trưởng (10 → 7) và tạo role riêng tối đa 1 mỗi trận.
  await testDb.role.update({ where: { key: 'sheriff' }, data: { maxPerGame: 7 } });
  await testDb.role.create({
    data: { key: 'custom_one', faction: 'goose', nameVi: 'Riêng', nameEn: 'Custom', description: '', metricLabel: 'Số lần', maxPerGame: 1, icon: '🧪', sortOrder: 99 },
  });
  const member = await createMember(testDb);
  const vigilante = await roleByKey(testDb, 'vigilante');
  await testDb.season.create({ data: { id: '2026-09', startsAt: new Date('2026-08-31T17:00:00Z'), endsAt: new Date('2026-09-30T17:00:00Z'), closedAt: new Date('2026-10-01T00:00:00Z') } });
  await testDb.roleTitle.create({ data: { seasonId: '2026-09', roleId: vigilante.id, memberId: member.id, score: 2 } });

  for (const statement of [...POINTS_MIGRATION_SQL.matchAll(/UPDATE\s+"?roles"?\s[^;]*;/g)].map((m) => m[0])) {
    await testDb.$executeRawUnsafe(statement);
  }

  const roles = await testDb.role.findMany({ select: { key: true, maxPerGame: true, points: true, penaltyMetricLabel: true, penaltyMaxPerGame: true, penaltyPoints: true } });
  for (const role of roles) expect(role, role.key).toMatchObject(expectedPoints(role));
  expect(roles.find((r) => r.key === 'sheriff')).toMatchObject({ points: 3, penaltyMaxPerGame: 7 });
  expect(roles.find((r) => r.key === 'custom_one')).toMatchObject({ points: 5, penaltyMetricLabel: null });
  // `role_titles` của mùa đã chốt không đổi.
  expect(await testDb.roleTitle.findMany()).toEqual([{ seasonId: '2026-09', roleId: vigilante.id, memberId: member.id, score: 2 }]);
});

test('database rejects points outside 1..100, a partial penalty metric, a negative penalty value, a bonus outside 0..1 and a self accusation', async () => {
  const swordsman = await roleByKey(testDb, 'swordsman');
  await expect(testDb.role.update({ where: { id: swordsman.id }, data: { points: 0 } })).rejects.toThrow(/roles_points_range/);
  await expect(testDb.role.update({ where: { id: swordsman.id }, data: { points: 101 } })).rejects.toThrow(/roles_points_range/);
  await expect(testDb.role.update({ where: { id: swordsman.id }, data: { points: 100 } })).resolves.toMatchObject({ points: 100 });
  await expect(testDb.role.update({ where: { id: swordsman.id }, data: { penaltyPoints: 3 } })).rejects.toThrow(/roles_penalty_metric_all_or_none/);
  await expect(testDb.role.update({ where: { id: swordsman.id }, data: { penaltyMetricLabel: 'Số lần chém nhầm', penaltyMaxPerGame: 2 } })).rejects.toThrow(
    /roles_penalty_metric_all_or_none/,
  );
  await expect(
    testDb.role.update({ where: { id: swordsman.id }, data: { penaltyMetricLabel: 'Số lần chém nhầm', penaltyMaxPerGame: 2, penaltyPoints: 0 } }),
  ).rejects.toThrow(/roles_penalty_points_range/);
  await expect(
    testDb.role.update({ where: { id: swordsman.id }, data: { penaltyMetricLabel: 'Số lần chém nhầm', penaltyMaxPerGame: 2, penaltyPoints: 2 } }),
  ).resolves.toMatchObject({ penaltyPoints: 2 });

  const member = await createMember(testDb);
  const other = await createMember(testDb);
  const victim = await createMember(testDb);
  const playedOn = dateOnlyToDb('2026-10-10');
  const base = { memberId: member.id, roleId: swordsman.id, playedOn, value: 1 };
  await expect(testDb.statReport.create({ data: { ...base, penaltyValue: -1 } })).rejects.toThrow(/stat_reports_penalty_value_nonneg/);
  await expect(testDb.statReport.create({ data: { ...base, bonusPoints: 2 } })).rejects.toThrow(/stat_reports_bonus_points_range/);
  await expect(testDb.statReport.create({ data: { ...base, bonusPoints: -1 } })).rejects.toThrow(/stat_reports_bonus_points_range/);
  // Mặc định: penalty 0, bonus 0, source self.
  const report = await testDb.statReport.create({ data: base });
  expect(report).toMatchObject({ penaltyValue: 0, bonusPoints: 0, source: 'self' });

  const accusation = {
    reportId: report.id,
    reporterId: member.id,
    accusedId: other.id,
    accusedRoleId: swordsman.id,
    victimId: victim.id,
    victimFaction: 'goose' as const,
    playedOn,
  };
  await expect(testDb.playerAccusation.create({ data: { ...accusation, accusedId: member.id } })).rejects.toThrow(/player_accusations_not_self/);
  await expect(testDb.playerAccusation.create({ data: { ...accusation, victimId: other.id } })).rejects.toThrow(/player_accusations_victim_not_accused/);
  const created = await testDb.playerAccusation.create({ data: accusation });
  expect(created).toMatchObject({ status: 'pending', rejectReason: null, penaltyReportId: null, reviewedById: null, reviewedAt: null });
  // Mỗi lần khai tối đa một báo cáo.
  await expect(testDb.playerAccusation.create({ data: { ...accusation, victimId: member.id, accusedId: victim.id } })).rejects.toThrow(/Unique constraint/);
});

test('modes and categories', async () => {
  expect(await testDb.gameMode.count()).toBe(10);
  expect(await testDb.awardCategory.count({ where: { scope: 'always' } })).toBe(3);
  expect(await testDb.awardCategory.count({ where: { scope: 'optional' } })).toBe(2);
  expect(await testDb.awardCategory.findFirst({ where: { scope: 'mode' }, include: { mode: true } })).toMatchObject({
    name: 'Ngỗng chạy giỏi nhất',
    mode: { key: 'goose_hunt' },
  });
  // Nhóm tính cho danh hiệu theo tên (spec huy hiệu §4): hai hạng mục Khen, bốn hạng mục Vui.
  const groups = await testDb.awardCategory.findMany({ select: { name: true, badgeGroup: true }, orderBy: { sortOrder: 'asc' } });
  expect(groups.map((c) => c.badgeGroup)).toEqual(['mvp', 'fun', 'fun', 'mvp', 'fun', 'fun']);
});

test('reseed keeps admin edits and adds nothing', async () => {
  await testDb.role.update({ where: { key: 'coroner' }, data: { nameVi: 'Nhân viên pháp y' } });
  await seedReferenceData(testDb);
  expect((await testDb.role.findUnique({ where: { key: 'coroner' } }))!.nameVi).toBe('Nhân viên pháp y');
  expect(await testDb.role.count()).toBe(91);
  expect(await testDb.gameMode.count()).toBe(10);
  expect(await testDb.awardCategory.count()).toBe(6);
});

test('category seed leaves admin edits alone', async () => {
  const category = await testDb.awardCategory.findFirstOrThrow({ where: { name: 'Pha xử lý ngu nhất' } });
  await testDb.awardCategory.update({ where: { id: category.id }, data: { name: 'Pha xử lý đỉnh nhất' } });
  await seedReferenceData(testDb);
  expect(await testDb.awardCategory.count()).toBe(6);
  expect(await testDb.awardCategory.count({ where: { name: 'Pha xử lý đỉnh nhất' } })).toBe(1);
  expect(await testDb.awardCategory.count({ where: { name: 'Pha xử lý ngu nhất' } })).toBe(0);
});

test('self vote blocked by database', async () => {
  const voter = await testDb.member.create({
    data: { discordId: '100', memberCode: 'GGD-0001', displayName: 'An' },
  });
  const other = await testDb.member.create({
    data: { discordId: '200', memberCode: 'GGD-0002', displayName: 'Bình' },
  });
  const mode = await testDb.gameMode.findUniqueOrThrow({ where: { key: 'classic' } });
  const session = await testDb.gameSession.create({
    data: { startsAt: new Date('2026-10-22T13:00:00Z'), modeId: mode.id, createdById: voter.id, status: 'ended' },
  });
  const round = await testDb.voteRound.create({
    data: { sessionId: session.id, closesAt: new Date('2026-10-23T01:00:00Z') },
  });
  const category = await testDb.awardCategory.findFirstOrThrow({ where: { scope: 'always' } });

  await expect(
    testDb.vote.create({
      data: { roundId: round.id, categoryId: category.id, voterId: voter.id, nomineeId: voter.id },
    }),
  ).rejects.toThrow(/votes_no_self/);

  await expect(
    testDb.vote.create({
      data: { roundId: round.id, categoryId: category.id, voterId: voter.id, nomineeId: other.id },
    }),
  ).resolves.toMatchObject({ nomineeId: other.id });
});
