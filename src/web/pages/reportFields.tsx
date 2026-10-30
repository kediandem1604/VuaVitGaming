/**
 * Các ô dùng chung của form Khai điểm và form Báo cáo người chơi (trang Khai điểm): Ngày chơi
 * (giới hạn [hôm nay − 3, hôm nay] giờ VN), Buổi chơi (không bắt buộc, bỏ buổi đã huỷ), Ghi chú
 * (≤ 300 ký tự) — và hook `useReportDay` giữ ngày + buổi đang chọn với giá trị mặc định của spec
 * ngày chơi mặc định §A: ngày = `defaultPlayedOn(bây giờ)` (trước 6:00 sáng là hôm qua), buổi =
 * `pickDefaultSession` trong các buổi của ngày đó. Người dùng đổi được cả hai; đổi ngày thì buổi
 * tự chọn lại theo ngày mới, trừ khi người dùng đã tự chọn buổi (khi đó về "không chọn buổi" như
 * trước — buổi của ngày cũ không còn hợp lệ).
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SessionDto } from '../../shared/api-types';
import { defaultPlayedOn, pickDefaultSession } from '../../shared/report-day';
import { apiGet } from '../api';
import { cx } from '../lib/cx';
import { addDaysIso, formatTime } from '../lib/format';

export const NOTE_MAX = 300;
/** Khai/báo cáo được trận từ hôm nay lùi tối đa bấy nhiêu ngày (server kiểm tra lại). */
export const WINDOW_DAYS = 3;
const VN_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const LABEL_CLASS = 'text-sm font-bold text-night-200';
export const HINT_CLASS = 'text-sm text-night-300';

/** Các buổi (không bị huỷ) của ngày `playedOn`; không tải khi ngày gõ dở. */
function useDaySessions(playedOn: string) {
  const valid = VN_DATE.test(playedOn);
  const sessions = useQuery({
    queryKey: ['sessions', 'date', playedOn],
    queryFn: () => apiGet<SessionDto[]>(`/api/sessions?date=${playedOn}`),
    enabled: valid,
  });
  const options = (sessions.data ?? []).filter((session) => session.status !== 'cancelled');
  return { valid, sessions, options };
}

export type DaySessions = ReturnType<typeof useDaySessions>;

/**
 * Ngày chơi + buổi đang chọn của một form. `choice === null` = chưa tự chọn buổi: buổi hiện tại là
 * buổi mặc định của ngày (tính lại mỗi lần vẽ, nên danh sách buổi về muộn vẫn được chọn sẵn); tự
 * chọn (kể cả "không chọn buổi") thì giữ đúng lựa chọn đó.
 */
export function useReportDay() {
  const [playedOn, setPlayedOnState] = useState(() => defaultPlayedOn(new Date()));
  const [choice, setChoice] = useState<string | null>(null);
  const day = useDaySessions(playedOn);
  const auto = day.sessions.data ? pickDefaultSession(day.options, new Date(), playedOn) : null;
  const sessionId = choice ?? (auto ? String(auto.id) : '');

  return {
    playedOn,
    sessionId,
    day,
    setPlayedOn(next: string) {
      setPlayedOnState(next);
      // Đã tự chọn buổi của ngày cũ → về "không chọn buổi"; chưa tự chọn → buổi mặc định của ngày mới.
      if (choice !== null) setChoice('');
    },
    setSessionId(next: string) {
      setChoice(next);
    },
  };
}

interface DateFieldProps {
  id: string;
  today: string;
  value: string;
  /** Hệ số nhân điểm của ngày đang chọn (1 = không nhân, không có dòng gợi ý). */
  multiplier: number;
  onChange: (value: string) => void;
}

/** Ngày chơi, giới hạn [hôm nay − 3, hôm nay] giờ VN (server vẫn kiểm tra lại); ngày nhân điểm thì kèm dòng gợi ý. */
export function DateField({ id, today, value, multiplier, onChange }: DateFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        Ngày chơi
      </label>
      <input
        id={id}
        type="date"
        className="field"
        min={addDaysIso(today, -WINDOW_DAYS)}
        max={today}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {multiplier > 1 && <p className="text-sm font-bold text-gold">{`Ngày này điểm cộng ×${multiplier}`}</p>}
    </div>
  );
}

interface SessionFieldProps {
  id: string;
  /** Danh sách buổi của ngày đang chọn (`useReportDay().day`). */
  day: DaySessions;
  value: string;
  onChange: (value: string) => void;
  /** Lời báo khi không tải được danh sách buổi. */
  loadError?: string;
}

/** Buổi chơi của ngày đã chọn (bỏ buổi đã huỷ); không bắt buộc. */
export function SessionField({ id, day, value, onChange, loadError = 'Không tải được danh sách buổi, bạn vẫn khai được không kèm buổi' }: SessionFieldProps) {
  const { valid, sessions, options } = day;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        Buổi chơi (không bắt buộc)
      </label>
      <select id={id} className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">— Không chọn buổi —</option>
        {options.map((session) => (
          <option key={session.id} value={String(session.id)}>
            {formatTime(session.startsAt)} {session.modeName}
          </option>
        ))}
      </select>
      {sessions.isError && <p className="text-sm text-duck-soft">{loadError}</p>}
      {valid && sessions.data && options.length === 0 && <p className={HINT_CLASS}>Ngày này không có buổi chơi nào</p>}
    </div>
  );
}

interface NoteFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

export function NoteField({ id, value, onChange }: NoteFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={LABEL_CLASS}>
          Ghi chú
        </label>
        <span className={cx(HINT_CLASS, 'tabular-nums')}>
          {value.length}/{NOTE_MAX}
        </span>
      </div>
      <textarea
        id={id}
        className="field min-h-20"
        maxLength={NOTE_MAX}
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
