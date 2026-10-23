import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

type Tone = 'neutral' | 'goose' | 'duck' | 'third' | 'amber';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  goose: 'bg-goose/10 text-goose',
  duck: 'bg-duck/10 text-duck',
  third: 'bg-third/10 text-third',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

/** Nhãn nhỏ dạng viên thuốc (trạng thái, quyền, phạm vi…) dùng chung cho các tab quản trị. */
export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', TONE_CLASS[tone])}>{children}</span>;
}
