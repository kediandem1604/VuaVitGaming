/**
 * Ô "chưa có gì" dùng chung (spec §5.4): `panel-inset` với một con ngỗng nhỏ bên trái và câu
 * mời bên phải. Các trang truyền nguyên câu đang có ("Chưa có mùa nào", …) làm `children`.
 */

import type { ReactNode } from 'react';
import { MiniGoose } from './goose/MiniGoose';

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="panel-inset flex items-center gap-3 text-night-300">
      <MiniGoose className="h-12 w-9" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
