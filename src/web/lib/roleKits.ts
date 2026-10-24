/**
 * Bảng tra từ role sang hình vẽ nhân vật (spec §4.2): role → bộ đồ (`kitForRole`),
 * loài chim → màu mào (`birdCrestColour`), phe → màu vòng sáng và viền huy hiệu
 * (`FACTION_COLOUR`). File này chỉ là dữ liệu; hình vẽ nằm ở `components/goose/`.
 *
 * Key không có trong bảng — kể cả role admin thêm sau — mặc bộ `badge`, nên bảng chỉ
 * liệt kê role có bộ đồ riêng. Test `tests/web/roleKits.test.ts` so bảng này với spec.
 */

import type { Faction, RoleDto } from '../../shared/api-types';
import { PALETTE } from './palette';

/** 17 bộ đồ theo thứ tự bảng spec §4.2, cuối cùng là bộ mặc định `badge`. */
export const KITS = [
  'knife',
  'sword',
  'detective',
  'police',
  'ninja',
  'wizard',
  'engineer',
  'bomb',
  'crown',
  'heart',
  'clown',
  'halo',
  'explorer',
  'sniper',
  'bird',
  'pouch',
  'vampire',
  'badge',
] as const;

export type Kit = (typeof KITS)[number];

/** Phần của role mà hình vẽ cần — nhóm ngỗng trang đăng nhập vẽ bộ đồ không có role thật. */
export type KitRole = Pick<RoleDto, 'key' | 'icon' | 'faction'>;

/** Các loài chim của bộ `bird`; mỗi loài một màu mào trong `BIRD_CREST`. */
const BIRDS = ['dodo', 'dueling_dodos', 'vulture', 'pigeon', 'falcon', 'hawk', 'raven', 'cuckoo', 'magpie', 'crow', 'owl', 'chicken'] as const;

type Bird = (typeof BIRDS)[number];

/** Bảng spec §4.2 — bộ đồ nào cho role nào (theo `key`). Mỗi key chỉ đứng ở một dòng. */
const KIT_ROLES: Record<Exclude<Kit, 'badge'>, readonly string[]> = {
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
  bird: BIRDS,
  pouch: ['pelican'],
  vampire: ['vampire', 'thrall'],
};

/** Bảng đảo: key role → bộ đồ, dựng một lần lúc nạp module. */
const ROLE_KIT = new Map<string, Kit>();
for (const kit of KITS) if (kit !== 'badge') for (const key of KIT_ROLES[kit]) ROLE_KIT.set(key, kit);

/** Bộ đồ của một role theo `key`; không có trong bảng → `badge`. */
export function kitForRole(key: string): Kit {
  return ROLE_KIT.get(key) ?? 'badge';
}

/**
 * Màu mào của từng loài chim (spec §4.2: quạ đen, chim ưng nâu, bồ câu xám…). Màu
 * riêng của hình, cố ý không có token trong palette; mào nằm trên đầu trắng viền `ink`
 * nên không cần đạt mức tương phản của chữ.
 */
const BIRD_CREST: Record<Bird, string> = {
  dodo: '#9DB4C8', // xám xanh nhạt
  dueling_dodos: '#3FA7A3', // xanh ngọc
  vulture: '#8E2F2F', // đỏ nâu như đầu kền kền
  pigeon: '#8C8F99', // xám bồ câu
  falcon: '#5B6B8C', // xám xanh đá
  hawk: '#8B5A2B', // nâu
  raven: '#1F2A44', // đen ánh xanh
  cuckoo: '#A89F6B', // nâu ô liu
  magpie: '#1F6E8C', // xanh ánh kim
  crow: '#15121F', // đen
  owl: '#C58A4A', // nâu vàng
  chicken: '#E03A2F', // đỏ mào gà
};

/** Màu mào cho bộ `bird`; key không phải chim → `night-600` trung tính. */
export function birdCrestColour(key: string): string {
  return Object.hasOwn(BIRD_CREST, key) ? BIRD_CREST[key as Bird] : PALETTE['night-600'];
}

/** Màu phe (Global Constraints) cho vòng sáng dưới chân và viền huy hiệu; phe thứ 3 là token `third`. */
export const FACTION_COLOUR: Record<Faction, string> = {
  goose: PALETTE.goose,
  duck: PALETTE.duck,
  neutral: PALETTE.third,
};
