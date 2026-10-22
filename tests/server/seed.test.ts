import { beforeEach, expect, test } from 'vitest';
import type { Faction } from '@prisma/client';
import { resetDb, testDb } from '../helpers/db.js';
import { seedReferenceData } from '../../src/server/seed/seed.js';

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

test('modes and categories', async () => {
  expect(await testDb.gameMode.count()).toBe(10);
  expect(await testDb.awardCategory.count({ where: { scope: 'always' } })).toBe(3);
  expect(await testDb.awardCategory.count({ where: { scope: 'optional' } })).toBe(2);
  expect(await testDb.awardCategory.findFirst({ where: { scope: 'mode' }, include: { mode: true } })).toMatchObject({
    name: 'Ngỗng chạy giỏi nhất',
    mode: { key: 'goose_hunt' },
  });
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
