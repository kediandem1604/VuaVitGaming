/**
 * Tab Gửi lỗi (spec §9): 100 lần gửi nhắc thất bại gần nhất, mới nhất trước — buổi,
 * người nhận, loại nhắc, kênh, giờ gửi và lỗi — dạng bảng (một panel, hàng kẻ
 * `night-700`, chữ 14px). Chỉ để xem; không có gì để thử lại (spec: không gửi lại nhắc lỗi).
 */

import { useQuery } from '@tanstack/react-query';
import type { NotificationFailureDto, NotifyChannel, ReminderKind } from '../../../shared/api-types';
import { apiGet } from '../../api';
import { EmptyState } from '../../components/EmptyState';
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
        <h2 className="text-xl leading-tight font-extrabold text-white">Nhắc giờ gửi lỗi</h2>
        <button type="button" className="btn-secondary" disabled={failures.isFetching} onClick={() => void failures.refetch()}>
          Tải lại
        </button>
      </div>
      <p className="text-sm text-night-300">100 lần gần nhất, mới nhất trước. Nhắc lỗi không được gửi lại.</p>
      <QueryState query={failures}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState>
              <p>Chưa có lần gửi nhắc nào lỗi</p>
            </EmptyState>
          ) : (
            <ul className="panel flex flex-col divide-y divide-night-700 p-0">
              {list.map((row) => (
                <li key={`${row.sessionId}-${row.memberId}-${row.kind}-${row.channel}`} className="flex flex-col gap-1 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-base font-bold text-white">{row.displayName}</span>
                    <span className="text-night-200">{row.sessionLabel}</span>
                    <time dateTime={row.sentAt} className="ml-auto text-night-300 tabular-nums">
                      {formatTime(row.sentAt)} {formatDateLabel(new Date(row.sentAt))}
                    </time>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Chip>{KIND_LABEL[row.kind]}</Chip>
                    <Chip tone={row.channel === 'email' ? 'third' : 'goose'}>{CHANNEL_LABEL[row.channel]}</Chip>
                  </div>
                  <p className="font-bold break-words text-duck-soft">{row.error}</p>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </section>
  );
}
