/**
 * Chip `×{m}` vàng cạnh một lần khai có ngày chơi là ngày nhân điểm (`multiplier > 1`) — ở "Lần khai
 * của tôi", hàng chờ Duyệt điểm và "Đã duyệt gần đây" (spec ngày nhân điểm §5). Hệ số 1 thì không vẽ.
 * `title` nói rõ nghĩa cho rê chuột (chữ "×2" đứng một mình hơi cụt).
 */

import { cx } from '../lib/cx';

export function MultiplierChip({ multiplier, className }: { multiplier: number; className?: string }) {
  if (!(multiplier > 1)) return null;
  return (
    <span title={`Điểm cộng ×${multiplier} (ngày nhân điểm)`} className={cx('chip bg-gold px-2.5 py-0.5 text-gold-ink tabular-nums', className)}>
      {`×${multiplier}`}
    </span>
  );
}
