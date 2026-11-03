/**
 * Chủ đề chung của cả app: nút đổi chủ đề cho mọi người (thanh trên, chỉ admin thấy) và lớp
 * trang trí nền của chủ đề đang bật. `ThemeDecor` nằm ở gốc ứng dụng nên cũng là nơi theo chủ
 * đề của server; lớp trang trí chỉ được gắn vào DOM khi chủ đề của nó bật — Sảnh đêm không có
 * lớp nào, nên không còn hoạt ảnh nền nào chạy.
 *
 * Nút xoay vòng Sảnh đêm → Halloween → Giáng sinh → Sảnh đêm (`THEME_CYCLE`). Icon là chủ đề
 * đang bật; `title` nói chủ đề đang bật và chủ đề sẽ sang khi bấm.
 */

import { Ghost, Moon, TreePine, type LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx';
import { nextTheme, THEME_LABEL, useSetSharedTheme, useTheme, useThemeSync, type Theme } from '../lib/theme';
import { ChristmasDecor } from './ChristmasDecor';
import { HalloweenDecor } from './HalloweenDecor';

const ICON: Record<Theme, LucideIcon> = { night: Moon, halloween: Ghost, christmas: TreePine };

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const next = nextTheme(theme);
  const setShared = useSetSharedTheme();
  const Icon = ICON[theme];
  return (
    <button
      type="button"
      data-theme-on={theme}
      title={`Đang: ${THEME_LABEL[theme]} — bấm để đổi sang ${THEME_LABEL[next]} cho mọi người`}
      disabled={setShared.isPending}
      onClick={() => setShared.mutate(next)}
      className={cx('theme-toggle btn-secondary px-2 py-1', className)}
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={2.5} />
      <span className="sr-only">Chủ đề giao diện</span>
    </button>
  );
}

export function ThemeDecor() {
  useThemeSync();
  const theme = useTheme();
  if (theme === 'halloween') return <HalloweenDecor />;
  if (theme === 'christmas') return <ChristmasDecor />;
  return null;
}
