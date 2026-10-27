/**
 * Ô hạng đầu dòng dùng chung cho "Top 3 mỗi phe" và "Tổng điểm theo phe": hạng 1-2-3 là huy
 * chương 🥇🥈🥉, từ hạng 4 ghi số. Emoji chỉ trang trí; trình đọc màn hình đọc "Hạng N".
 */

import { cx } from '../lib/cx';

const MEDALS = ['🥇', '🥈', '🥉'] as const;

export function RankMedal({ rank, className }: { rank: number; className?: string }) {
  const medal = MEDALS[rank - 1];
  return (
    <span className={cx('w-7 shrink-0 text-center leading-none', medal ? 'text-lg' : 'text-base font-bold text-white tabular-nums', className)} title={`Hạng ${rank}`}>
      <span aria-hidden="true">{medal ?? rank}</span>
      <span className="sr-only">Hạng {rank}</span>
    </span>
  );
}
