import { expect, test } from 'vitest';
import { ROLES } from '../../src/server/seed/roles';
import { PALETTE } from '../../src/web/lib/palette';
import { birdCrestColour, kitForRole, KITS, type Kit } from '../../src/web/lib/roleKits';

/** Bảng spec §4.2 chép nguyên — chốt giữ bảng ánh xạ trong code không trôi khỏi spec. */
const EXPECTED: Record<Exclude<Kit, 'badge'>, string[]> = {
  knife: ['duck', 'cannibal', 'professional', 'assassin', 'hitman', 'undertaker', 'serial_killer'],
  sword: ['swordsman'],
  detective: ['detective', 'birdwatcher', 'mortician', 'tracker', 'stalker', 'coroner', 'inquisitor', 'hoot_spotter'],
  police: ['vigilante', 'sheriff', 'bodyguard', 'avenger', 'soldier', 'demon_hunter'],
  ninja: ['morphling', 'silencer', 'spy', 'identity_thief', 'ninja', 'invisibility', 'camo_duck'],
  wizard: ['medium', 'astral', 'fortune_teller', 'lucid_dreamer', 'warlock', 'esper', 'witch_doctor'],
  engineer: ['locksmith', 'engineer', 'scientist', 'sensor'],
  bomb: ['demolitionist'],
  crown: ['politician', 'celebrity', 'lobbyist'],
  heart: ['lover_goose', 'lover_duck', 'cupid'],
  clown: ['party', 'mime', 'clown'],
  halo: ['preacher', 'saint', 'high_priest', 'initiate', 'sin_eater'],
  explorer: ['adventurer', 'street_urchin', 'survivalist', 'looter'],
  sniper: ['sniper', 'hoot_sniper'],
  bird: ['dodo', 'dueling_dodos', 'vulture', 'pigeon', 'falcon', 'hawk', 'raven', 'cuckoo', 'magpie', 'crow', 'owl', 'chicken'],
  pouch: ['pelican'],
  vampire: ['vampire', 'thrall'],
};

test('KITS lists the 17 outfits of the spec table plus the default badge, once each', () => {
  expect(KITS).toHaveLength(18);
  expect(new Set(KITS).size).toBe(KITS.length);
  for (const kit of Object.keys(EXPECTED)) expect(KITS).toContain(kit);
  expect(KITS).toContain('badge');
});

test('every role in the spec table gets its kit', () => {
  for (const [kit, keys] of Object.entries(EXPECTED)) for (const key of keys) expect(kitForRole(key)).toBe(kit);
});

test('seeded roles outside the table, and unknown keys, wear the badge', () => {
  const mapped = new Set(Object.values(EXPECTED).flat());
  for (const role of ROLES) if (!mapped.has(role.key)) expect(kitForRole(role.key)).toBe('badge');
  expect(kitForRole('goose')).toBe('badge');
  expect(kitForRole('khong-co-role-nay')).toBe('badge');
});

test('every spec key exists in the seed', () => {
  const seeded = new Set(ROLES.map((r) => r.key));
  for (const key of Object.values(EXPECTED).flat()) expect(seeded.has(key)).toBe(true);
});

test('each bird has its own crest colour', () => {
  const colours = EXPECTED.bird.map(birdCrestColour);
  expect(new Set(colours).size).toBe(EXPECTED.bird.length);
  for (const c of colours) expect(c).toMatch(/^#[0-9A-F]{6}$/i);
  // Key không phải chim → màu bóng trung tính, không ném lỗi.
  expect(birdCrestColour('goose')).toBe(PALETTE['night-600']);
  expect(birdCrestColour('khong-co-role-nay')).toBe(PALETTE['night-600']);
});
