import type { BadgeGroup, CategoryScope } from '@prisma/client';

export type CategorySeed = {
  name: string;
  scope: CategoryScope;
  modeKey: string | null;
  sortOrder: number;
  /** Nhóm tính cho danh hiệu tháng (spec huy hiệu §4); DB có sẵn nhận giá trị này qua migration `member_badges`. */
  badgeGroup: BadgeGroup;
};

// Chỉ được nạp khi bảng award_categories còn trống — xem seed.ts.
export const CATEGORIES: readonly CategorySeed[] = [
  { name: 'Giết nhiều nhất', scope: 'always', modeKey: null, sortOrder: 1, badgeGroup: 'mvp' },
  { name: 'Pha xử lý ngu nhất', scope: 'always', modeKey: null, sortOrder: 2, badgeGroup: 'fun' },
  { name: 'Pha dí người ngu nhất', scope: 'always', modeKey: null, sortOrder: 3, badgeGroup: 'fun' },
  { name: 'Ngỗng chạy giỏi nhất', scope: 'mode', modeKey: 'goose_hunt', sortOrder: 4, badgeGroup: 'mvp' },
  { name: 'Pha đẻ trứng lộ liễu nhất (Cò gáy)', scope: 'optional', modeKey: null, sortOrder: 5, badgeGroup: 'fun' },
  { name: 'Pha chém lố nhất (Kiếm sĩ)', scope: 'optional', modeKey: null, sortOrder: 6, badgeGroup: 'fun' },
];
