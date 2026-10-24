/**
 * Nhãn phe dùng chung cho Đại sảnh và Bảng xếp hạng. Role riêng của chế độ đặc biệt
 * (`modeKey` khác null) đứng thành nhóm thứ tư "Chế độ đặc biệt" thay vì xếp theo phe
 * của nó (spec §6.4: phe của các role này chỉ là dự đoán).
 */

import type { Faction, RoleDto } from '../../shared/api-types';

export const FACTIONS: readonly Faction[] = ['goose', 'duck', 'neutral'];

export const FACTION_LABEL: Record<Faction, string> = {
  goose: 'Phe Ngỗng',
  duck: 'Phe Vịt',
  neutral: 'Phe thứ 3',
};

export const SPECIAL_LABEL = 'Chế độ đặc biệt';

export function isSpecialRole(role: RoleDto): boolean {
  return role.modeKey !== null;
}

export function isFaction(value: string | null): value is Faction {
  return value !== null && (FACTIONS as readonly string[]).includes(value);
}
