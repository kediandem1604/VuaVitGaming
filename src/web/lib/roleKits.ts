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
 * Màu "điểm nhấn" của từng loài chim — phần mang `data-part="crest"` trong bộ `bird`
 * (mào, băng đô, cổ lông, vòng mũ, tổ chim…). Màu riêng của hình, cố ý không có token
 * trong palette; nằm trên nét viền `ink` nên không cần đạt mức tương phản của chữ.
 */
const BIRD_CREST: Record<Bird, string> = {
  dodo: '#6FB7F2', // xanh trời của chùm lông xoăn
  dueling_dodos: '#E0533B', // đỏ cam băng đô đấu sĩ
  vulture: '#EFE3CC', // kem của cổ lông xù
  pigeon: '#7B4FD0', // tím ánh kim của dải mũ bác sĩ dịch hạch
  falcon: '#E8A317', // vàng chùm lông mũ trụ
  hawk: '#3FA7A3', // xanh ngọc lông vũ trên băng đô
  raven: '#B57BFF', // tím phát sáng của bùa hộ mệnh
  cuckoo: '#8B6B3E', // nâu tổ chim
  magpie: '#2E8FB8', // xanh ánh kim dải mũ chóp
  crow: '#B3263A', // đỏ thẫm vương miện gai
  owl: '#7A4E24', // nâu sẫm túm tai
  chicken: '#E03A2F', // đỏ mào gà
};

/**
 * Dáng thân riêng của từng loài (phe thứ 3, vài chim của chế độ đặc biệt, ngỗng Canada): màu thân, cánh,
 * mỏ, chân, vòng mắt (mắt phát sáng trên thân tối) và đĩa mặt (cú). `GooseBody` tô theo đây;
 * role không có trong bảng giữ ngỗng trắng.
 */
export interface BodyLook {
  body: string;
  wing: string;
  beak?: string;
  feet?: string;
  /** Tròng mắt tô sau con ngươi — để mắt nổi trên thân tối, hoặc mắt vàng của chim săn mồi. */
  eyeRing?: string;
  /** Đĩa mặt vẽ sau mắt (cú). */
  face?: string;
  /** Quầng sáng mảnh quanh thân — thân gần đen thì vẫn tách khỏi nền đêm. */
  rim?: string;
}

const BODY_LOOK: Partial<Record<string, BodyLook>> = {
  dodo: { body: '#B9C6D6', wing: '#8FA3BA' },
  dueling_dodos: { body: '#A8DCD5', wing: '#5FB5AE' },
  vulture: { body: '#5C4A3E', wing: '#3E322B', beak: '#E2C58C', feet: '#C9B7A0', eyeRing: '#F2E8D0' },
  pigeon: { body: '#A3A8B6', wing: '#7B8091', feet: '#E5737A' },
  falcon: { body: '#D7B98E', wing: '#8C6A48', beak: '#F2C14E', feet: '#F2C14E', eyeRing: '#FFD23F' },
  hawk: { body: '#9C6B3C', wing: '#5E3A1A', beak: '#F2C14E', feet: '#F2C14E', eyeRing: '#FFD23F' },
  raven: { body: '#2A2740', wing: '#1B1930', beak: '#4A4560', feet: '#4A4560', eyeRing: '#C9A2F2', rim: '#B57BFF' },
  cuckoo: { body: '#B0A88E', wing: '#7D765F', eyeRing: '#FFD23F' },
  magpie: { body: '#1F1E2B', wing: '#1F6E8C', beak: '#3A3848', feet: '#3A3848', eyeRing: '#E6E2F0', rim: '#7CB8FF' },
  crow: { body: '#17141F', wing: '#2A2340', beak: '#3A3448', feet: '#3A3448', eyeRing: '#FF5A5F', rim: '#FF5A5F' },
  owl: { body: '#C58A4A', wing: '#8B5E30', face: '#F2DDB4' },
  pelican: { body: '#F4F1EA', wing: '#D9D3C4' },
  // Ngỗng Canada: thân nâu xám, mỏ và chân đen.
  canadian: { body: '#D8CCB8', wing: '#7A6650', beak: '#3A3448', feet: '#3A3448' },
};

/** Dáng thân của role (`undefined` = ngỗng trắng mặc định). */
export function bodyLook(key: string): BodyLook | undefined {
  return BODY_LOOK[key];
}

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
