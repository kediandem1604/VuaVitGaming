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

/** Tên phe ngắn (bỏ chữ "Phe") cho chỗ hẹp như tiêu đề nhóm trong ô chọn role. */
export const FACTION_SHORT_LABEL: Record<Faction, string> = {
  goose: 'Ngỗng',
  duck: 'Vịt',
  neutral: 'Phe thứ 3',
};

/** Tên phe đứng sau chữ "phe" trong một câu ("phe Ngỗng", "phe thứ 3") — khung báo cáo người chơi, khớp ghi chú/DM của server. */
export const FACTION_NAME: Record<Faction, string> = {
  goose: 'Ngỗng',
  duck: 'Vịt',
  neutral: 'thứ 3',
};

/** Chữ màu phe trên nền tối (`night-800`/`night-900`): bản `-soft` để đủ tương phản (spec §5.3). */
export const FACTION_TEXT: Record<Faction, string> = {
  goose: 'text-goose-soft',
  duck: 'text-duck-soft',
  neutral: 'text-third-soft',
};

/**
 * Nền băng/nhãn phe mang chữ trắng (thẻ role, khối "Top 3 mỗi phe"): dùng `-strong` để chữ
 * trắng đủ tương phản — không đặt chữ trắng thẳng lên `goose`/`duck` (spec §5.3).
 */
export const FACTION_BAND: Record<Faction, string> = {
  goose: 'bg-goose-strong',
  duck: 'bg-duck-strong',
  neutral: 'bg-third',
};

export const SPECIAL_LABEL = 'Chế độ đặc biệt';

export function isSpecialRole(role: RoleDto): boolean {
  return role.modeKey !== null;
}

export function isFaction(value: string | null): value is Faction {
  return value !== null && (FACTIONS as readonly string[]).includes(value);
}
