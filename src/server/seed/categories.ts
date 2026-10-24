import type { CategoryScope } from '@prisma/client';

export type CategorySeed = {
  name: string;
  scope: CategoryScope;
  modeKey: string | null;
  sortOrder: number;
};

// Chỉ được nạp khi bảng award_categories còn trống — xem seed.ts.
export const CATEGORIES: readonly CategorySeed[] = [
  { name: 'Giết nhiều nhất', scope: 'always', modeKey: null, sortOrder: 1 },
  { name: 'Pha xử lý ngu nhất', scope: 'always', modeKey: null, sortOrder: 2 },
  { name: 'Pha dí người ngu nhất', scope: 'always', modeKey: null, sortOrder: 3 },
  { name: 'Ngỗng chạy giỏi nhất', scope: 'mode', modeKey: 'goose_hunt', sortOrder: 4 },
  { name: 'Pha đẻ trứng lộ liễu nhất (Cò gáy)', scope: 'optional', modeKey: null, sortOrder: 5 },
  { name: 'Pha chém lố nhất (Kiếm sĩ)', scope: 'optional', modeKey: null, sortOrder: 6 },
];
