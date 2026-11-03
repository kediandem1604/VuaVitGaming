/**
 * Chip phe thắng của một ván (spec ván §5): "🦢 Ngỗng thắng" / "🦆 Vịt thắng" / "Phe thứ 3 thắng" /
 * "Chưa chọn phe thắng" — trang buổi, trang Khai điểm và tab Duyệt điểm.
 */

import type { Faction } from '../../shared/api-types';
import { cx } from '../lib/cx';
import { WINNER_CHIP_CLASS, winnerText } from '../lib/rounds';

export function WinnerChip({ faction }: { faction: Faction | null }) {
  return <span className={cx('chip max-w-full px-2.5 py-0.5 rounded-xl! break-words whitespace-normal!', WINNER_CHIP_CLASS[faction ?? 'none'])}>{winnerText(faction)}</span>;
}
