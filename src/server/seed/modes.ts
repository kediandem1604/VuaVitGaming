export type ModeSeed = {
  key: string;
  nameVi: string;
  nameEn: string;
};

// Spec §6.5 — nameVi là cột "Tên hiển thị" (chưa xác minh trừ Săn ngỗng; admin sửa được).
export const MODES: readonly ModeSeed[] = [
  { key: 'classic', nameVi: 'Cổ điển (Classic)', nameEn: 'Classic' },
  { key: 'draft', nameVi: 'Chọn role (Draft)', nameEn: 'Draft' },
  { key: 'goose_hunt', nameVi: 'Săn ngỗng (Goose Hunt)', nameEn: 'Goose Hunt' },
  { key: 'dine_dash', nameVi: 'Dine & Dash', nameEn: 'Dine & Dash' },
  { key: 'trick_or_treat', nameVi: 'Cho kẹo hay bị ghẹo (Trick or Treat)', nameEn: 'Trick or Treat' },
  { key: 'corruption', nameVi: 'Tha hoá (Corruption)', nameEn: 'Corruption' },
  { key: 'tastes_like_chicken', nameVi: 'Tastes Like Chicken', nameEn: 'Tastes Like Chicken' },
  { key: 'hoot_seek', nameVi: 'Hoot & Seek', nameEn: 'Hoot & Seek' },
  { key: 'task_race', nameVi: 'Đua nhiệm vụ (Task Race)', nameEn: 'Task Race' },
  { key: 'hanging_out', nameVi: 'Đi chơi (Hanging Out)', nameEn: 'Hanging Out' },
];
