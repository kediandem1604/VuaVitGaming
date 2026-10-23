/**
 * Tab Gửi lỗi (spec §9): 100 lần gửi nhắc thất bại gần nhất, mới nhất trước — buổi,
 * người nhận, loại nhắc, kênh, giờ gửi và lỗi. Chỉ để xem; không có gì để thử lại
 * (spec: không gửi lại nhắc lỗi).
 */

import { useQuery } from '@tanstack/react-query';
import type { NotificationFailureDto, NotifyChannel, ReminderKind } from '../../../shared/api-types';
import { apiGet } from '../../api';
import { QueryState } from '../../components/QueryState';
import { formatDateLabel, formatTime } from '../../lib/format';
import { Chip } from './Chip';

const FAILURES_KEY = ['admin', 'notification-failures'] as const;

const KIND_LABEL: Record<ReminderKind, string> = { pre15: 'Nhắc trước giờ', start: 'Đúng giờ bắt đầu' };
const CHANNEL_LABEL: Record<NotifyChannel, string> = { email: 'Email', dm: 'Discord DM' };

export function FailuresTab() {
  const failures = useQuery({ queryKey: FAILURES_KEY, queryFn: () => apiGet<NotificationFailureDto[]>('/api/admin/notification-failures') });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Nhắc giờ gửi lỗi</h2>
        <button type="button" className="btn-secondary" disabled={failures.isFetching} onClick={() => void failures.refetch()}>
          Tải lại
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">100 lần gần nhất, mới nhất trước. Nhắc lỗi không được gửi lại.</p>
      <QueryState query={failures}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-slate-600 dark:text-slate-400">Chưa có lần gửi nhắc nào lỗi</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((row) => (
                <li key={`${row.sessionId}-${row.memberId}-${row.kind}-${row.channel}`} className="card flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{row.displayName}</span>
                    <span className="text-sm text-slate-600 dark:text-slate-400">{row.sessionLabel}</span>
                    <time dateTime={row.sentAt} className="ml-auto text-sm text-slate-600 tabular-nums dark:text-slate-400">
                      {formatTime(row.sentAt)} {formatDateLabel(new Date(row.sentAt))}
                    </time>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Chip>{KIND_LABEL[row.kind]}</Chip>
                    <Chip tone={row.channel === 'email' ? 'third' : 'goose'}>{CHANNEL_LABEL[row.channel]}</Chip>
                  </div>
                  <p className="text-sm break-words text-duck">{row.error}</p>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </section>
  );
}
