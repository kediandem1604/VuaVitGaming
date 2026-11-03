import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { CATEGORIES } from '../../src/server/seed/categories.js';
import { BADGES, badgeDef, monthlyBadgeTitle } from '../../src/shared/badges.js';
import type { BadgeKey } from '../../src/shared/badges.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Danh mục (src/shared/badges.ts)
// ---------------------------------------------------------------------------

test('badges catalogue has 7 monthly and 9 milestone entries with unique keys', () => {
  expect(BADGES.filter((b) => b.kind === 'monthly')).toHaveLength(7);
  expect(BADGES.filter((b) => b.kind === 'milestone')).toHaveLength(9);
  expect(new Set(BADGES.map((b) => b.key)).size).toBe(BADGES.length);
  for (const b of BADGES) {
    expect(b.howTo, b.key).not.toBe('');
    expect(b.name, b.key).not.toBe('');
    expect(b.icon, b.key).not.toBe('');
  }
});

test('badges catalogue follows the spec order with its icons and names', () => {
  const expected: [BadgeKey, string, string][] = [
    ['smvp', '👑', 'SMVP'],
    ['fun_king', '🤡', 'Vua tấu hài'],
    ['top_goose', '🪿', 'Chiến thần phe Ngỗng'],
    ['top_duck', '🦆', 'Sát thủ phe Vịt'],
    ['top_neutral', '🃏', 'Trùm phe thứ 3'],
    ['grinder', '🔥', 'Chăm cày'],
    ['versatile', '🎭', 'Đa diện'],
    ['games_10', '🎮', 'Quen mặt'],
    ['games_50', '🏅', 'Lão làng'],
    ['games_100', '🏆', 'Huyền thoại sảnh'],
    ['mvp_1', '⭐', 'Ngôi sao mới'],
    ['mvp_10', '🌟', 'Ngôi sao sáng'],
    ['mvp_50', '💫', 'Siêu sao'],
    ['incarnate_1', '🎖️', 'Lần đầu hoá thân'],
    ['incarnate_5', '🧬', 'Bậc thầy hoá thân'],
    ['director', '🎬', 'Đạo diễn'],
  ];
  expect(BADGES.map((b) => [b.key, b.icon, b.name])).toEqual(expected);
});

test('badgeDef returns the catalogue entry for a key', () => {
  expect(badgeDef('games_50')).toEqual({
    key: 'games_50',
    kind: 'milestone',
    icon: '🏅',
    name: 'Lão làng',
    howTo: 'Đi đủ 50 trận',
  });
  expect(badgeDef('versatile')).toMatchObject({
    kind: 'monthly',
    name: 'Đa diện',
    howTo: 'Khai điểm được duyệt ở nhiều role khác nhau nhất (ít nhất 2)',
  });
  expect(badgeDef('smvp')).toBe(BADGES[0]);
});

test('monthlyBadgeTitle formats "{name} tháng {MM}/{YYYY}"', () => {
  expect(monthlyBadgeTitle('SMVP', '2026-10')).toBe('SMVP tháng 10/2026');
  expect(monthlyBadgeTitle('Đa diện', '2027-01')).toBe('Đa diện tháng 01/2027');
  expect(() => monthlyBadgeTitle('SMVP', '2026-13')).toThrow();
  expect(() => monthlyBadgeTitle('SMVP', '10/2026')).toThrow();
});

// ---------------------------------------------------------------------------
// Nhóm hạng mục: seed cho DB mới, migration cho dữ liệu có sẵn
// ---------------------------------------------------------------------------

const MVP_NAMES = ['Giết nhiều nhất', 'Ngỗng chạy giỏi nhất'];
const FUN_NAMES = ['Pha xử lý ngu nhất', 'Pha dí người ngu nhất', 'Pha đẻ trứng lộ liễu nhất (Cò gáy)', 'Pha chém lố nhất (Kiếm sĩ)'];

test('seed categories map badge groups by name', () => {
  expect(CATEGORIES).toHaveLength(6);
  const groupOf = new Map(CATEGORIES.map((c) => [c.name, c.badgeGroup]));
  for (const name of MVP_NAMES) expect(groupOf.get(name), name).toBe('mvp');
  for (const name of FUN_NAMES) expect(groupOf.get(name), name).toBe('fun');
});

test('migration sets badge groups for existing categories', () => {
  const sql = readFileSync(path.join(REPO_ROOT, 'prisma', 'migrations', '20261026120000_member_badges', 'migration.sql'), 'utf8');

  // Mỗi nhóm đúng một câu UPDATE … IN (…); dòng có sẵn trên DB thật chỉ nhận nhóm từ đây.
  // Tên hạng mục có thể chứa dấu ngoặc đơn nên lấy tới `);` kết câu, không dừng ở `)` đầu tiên.
  const updates = [...sql.matchAll(/UPDATE\s+"?award_categories"?\s+SET\s+"?badge_group"?\s*=\s*'(\w+)'\s+WHERE\s+"?name"?\s+IN\s*\(([\s\S]*?)\);/g)];
  const byGroup = new Map(updates.map((m) => [m[1], m[2] ?? '']));
  expect([...byGroup.keys()].sort()).toEqual(['fun', 'mvp']);
  expect(updates).toHaveLength(2);

  const names = (list: string) => [...list.matchAll(/'((?:[^']|'')*)'/g)].map((m) => (m[1] ?? '').replaceAll("''", "'"));
  expect(names(byGroup.get('mvp') ?? '').sort()).toEqual([...MVP_NAMES].sort());
  expect(names(byGroup.get('fun') ?? '').sort()).toEqual([...FUN_NAMES].sort());

  // Tạo enum, cột, hai bảng và chỉ mục trước khi UPDATE.
  expect(sql).toMatch(/CREATE TYPE "BadgeGroup" AS ENUM \('mvp', 'fun', 'none'\)/);
  expect(sql).toMatch(/ALTER TABLE "award_categories" ADD COLUMN\s+"badge_group" "BadgeGroup" NOT NULL DEFAULT 'none'/);
  expect(sql).toMatch(/CREATE TABLE "member_badges"/);
  expect(sql).toMatch(/CREATE TABLE "badge_months"/);
  expect(sql).toMatch(/CREATE UNIQUE INDEX "member_badges_badge_key_period_id_member_id_key"/);
  expect(sql.indexOf('CREATE TABLE "member_badges"')).toBeLessThan(sql.indexOf('UPDATE "award_categories"'));
});
