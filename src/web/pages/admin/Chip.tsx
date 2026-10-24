import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

type Tone = 'neutral' | 'goose' | 'duck' | 'third';

/**
 * `neutral` là chip mặc định của utility `chip` (`night-700`, chữ trắng); ba tông phe dùng
 * nền `-strong`/`third` để chữ trắng đủ 4.5:1 (spec §3.3 — `goose`/`duck` gốc chỉ ~3.9:1).
 */
const TONE_CLASS: Record<Tone, string | undefined> = {
  neutral: undefined,
  goose: 'bg-goose-strong',
  duck: 'bg-duck-strong',
  third: 'bg-third',
};

/** Nhãn nhỏ dạng viên thuốc (trạng thái, quyền, phạm vi…) dùng chung cho các tab quản trị: `chip` thu gọn, chữ 14px. */
export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('chip px-2.5 py-0.5', TONE_CLASS[tone])}>{children}</span>;
}
