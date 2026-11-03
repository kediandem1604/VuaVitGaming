/**
 * Mục "Ngày nhân điểm" của tab Cài đặt (chỉ admin, spec ngày nhân điểm §4): form thêm ngày và danh
 * sách server trả — các ngày từ hôm nay trở đi (gần nhất trước), rồi các ngày đã qua của mùa đang
 * mở (mờ, chip "Đã qua", không nút). Mỗi dòng: `{Thứ}, {dd/mm}` · chip `×{m}` · lời nhắn · Sửa/Xoá.
 *
 * Form (thêm và sửa dùng chung): "Ngày" (ô ngày, `min` = hôm nay giờ VN), "Hệ số" (`Select` ×2–×5),
 * "Lời nhắn" (tuỳ chọn, ≤ 100 ký tự; để trống → `null`). Chặn tại chỗ ngày đã qua và lời nhắn quá dài
 * bằng đúng câu của server; mọi lỗi khác (trùng ngày, ngày đã qua không sửa/xoá được…) là thông báo
 * nguyên văn của server. Xoá hỏi lại trước khi gửi.
 *
 * Thêm/sửa/xoá xong: tải lại danh sách này, danh sách "sắp tới" (banner + gợi ý ở form Khai điểm) và
 * mọi cache đọc điểm — hệ số đổi thì điểm mùa của các lần khai ngày đó đổi theo (spec §3).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { AdminMultiplierDayDto, MultiplierDayInput } from '../../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { MultiplierChip } from '../../components/MultiplierChip';
import { QueryState } from '../../components/QueryState';
import { Select, type SelectGroup } from '../../components/Select';
import { cx } from '../../lib/cx';
import { formatDayLabel, isIsoDate, vnTodayIso } from '../../lib/format';
import {
  ADMIN_MULTIPLIER_DAYS_KEY,
  APPROVED_REPORTS_KEY,
  LEADERBOARD_TOTALS_KEY,
  MEMBER_QUERY_KEY,
  MULTIPLIER_UPCOMING_KEY,
  MY_REPORTS_KEY,
  PENDING_REPORTS_KEY,
  TITLES_QUERY_KEY,
} from '../../lib/queryKeys';
import { Chip } from './Chip';

const MESSAGE_MAX = 100;
const MULTIPLIERS = [2, 3, 4, 5] as const;
const MULTIPLIER_GROUPS: SelectGroup<number>[] = [{ options: MULTIPLIERS.map((value) => ({ value, label: `×${value}` })) }];

/** Câu báo lỗi trùng với server (spec §4). */
const PAST_DAY = 'Chỉ đặt được cho hôm nay hoặc sau này';
const MESSAGE_TOO_LONG = 'Lời nhắn tối đa 100 ký tự';

/**
 * Cache làm mới sau mỗi thay đổi: danh sách quản trị, danh sách "sắp tới", và mọi nơi đọc điểm mùa
 * (bảng role, Top 3 / Tổng điểm theo phe, Đại sảnh, trang thành viên, danh hiệu) cùng các danh sách
 * lần khai mang chip `×m` (của tôi, hàng chờ, đã duyệt gần đây).
 */
const REFRESH_KEYS = [
  ADMIN_MULTIPLIER_DAYS_KEY,
  MULTIPLIER_UPCOMING_KEY,
  ['leaderboard'],
  ['leaderboard-factions'],
  LEADERBOARD_TOTALS_KEY,
  ['hall'],
  MEMBER_QUERY_KEY,
  TITLES_QUERY_KEY,
  MY_REPORTS_KEY,
  PENDING_REPORTS_KEY,
  APPROVED_REPORTS_KEY,
] as const;

const H2_CLASS = 'text-xl leading-tight font-extrabold text-white';
const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';
const STATUS_CLASS = 'min-h-5 text-sm font-bold text-ok';

function useRefreshMultipliers() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of REFRESH_KEYS) void queryClient.invalidateQueries({ queryKey });
  };
}

export function MultiplierDaysSection() {
  const titleId = useId();
  const refresh = useRefreshMultipliers();
  const days = useQuery({ queryKey: ADMIN_MULTIPLIER_DAYS_KEY, queryFn: () => apiGet<AdminMultiplierDayDto[]>('/api/admin/multiplier-days') });
  /** Tăng sau mỗi lần thêm xong: form tự về trống (không dựng lại, để dòng "Đã thêm" vẫn được đọc). */
  const [added, setAdded] = useState(0);

  const create = useMutation({
    mutationFn: (body: MultiplierDayInput) => apiSend<AdminMultiplierDayDto>('POST', '/api/admin/multiplier-days', body),
    onSuccess: () => {
      refresh();
      setAdded((count) => count + 1);
    },
  });

  return (
    <section aria-labelledby={titleId} className="panel flex max-w-lg flex-col gap-3">
      <h2 id={titleId} className={H2_CLASS}>
        Ngày nhân điểm
      </h2>
      <p className={HINT_CLASS}>
        Điểm cộng của các lần khai có ngày chơi là ngày này được nhân. Điểm trừ, +1 báo cáo và treo thưởng không nhân. Mọi người thấy banner trên web, bot đăng ở #thông-báo và nhắc lúc
        9:00 đúng ngày.
      </p>
      <MultiplierForm
        resetKey={added}
        formLabel="Thêm ngày nhân điểm"
        initial={{ day: '', multiplier: 2, message: '' }}
        submitLabel="Thêm"
        pending={create.isPending}
        error={create.isError ? errorMessage(create.error) : null}
        success={create.isSuccess ? 'Đã thêm' : null}
        onChange={() => {
          if (create.isError || create.isSuccess) create.reset();
        }}
        onSubmit={(body) => create.mutate(body)}
      />
      <QueryState query={days}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState>
              <p>Chưa có ngày nhân điểm nào</p>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((item) => (
                <MultiplierRow key={item.id} item={item} />
              ))}
            </ul>
          )
        }
      </QueryState>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Một dòng: Sửa, Xoá (chỉ ngày từ hôm nay trở đi)
// ---------------------------------------------------------------------------

function MultiplierRow({ item }: { item: AdminMultiplierDayDto }) {
  const queryClient = useQueryClient();
  const refresh = useRefreshMultipliers();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const label = formatDayLabel(item.day);

  const patch = useMutation({
    mutationFn: (body: MultiplierDayInput) => apiSend<AdminMultiplierDayDto>('PATCH', `/api/admin/multiplier-days/${item.id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<AdminMultiplierDayDto[]>(ADMIN_MULTIPLIER_DAYS_KEY, (current) => current?.map((entry) => (entry.id === updated.id ? updated : entry)));
      refresh();
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => apiSend<undefined>('DELETE', `/api/admin/multiplier-days/${item.id}`),
    onSuccess: () => {
      queryClient.setQueryData<AdminMultiplierDayDto[]>(ADMIN_MULTIPLIER_DAYS_KEY, (current) => current?.filter((entry) => entry.id !== item.id));
      refresh();
    },
    onSettled: () => setConfirmingDelete(false),
  });

  const busy = patch.isPending || remove.isPending;
  const rowError = remove.isError ? errorMessage(remove.error) : null;

  return (
    <li className={cx('panel-inset flex flex-col gap-2 text-sm', item.past && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-base font-bold text-white">{label}</span>
        <MultiplierChip multiplier={item.multiplier} />
        {item.past && <Chip>Đã qua</Chip>}
      </div>
      {item.message && !editing && <p className="break-words text-night-200">{item.message}</p>}

      {item.past ? null : editing ? (
        <MultiplierForm
          formLabel={`Sửa ${label}`}
          initial={{ day: item.day, multiplier: item.multiplier, message: item.message ?? '' }}
          submitLabel="Lưu"
          pending={patch.isPending}
          error={patch.isError ? errorMessage(patch.error) : null}
          onCancel={() => {
            patch.reset();
            setEditing(false);
          }}
          onChange={() => {
            if (patch.isError) patch.reset();
          }}
          onSubmit={(body) => patch.mutate(body)}
        />
      ) : confirmingDelete ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-white">Xoá ngày này?</span>
          <button type="button" className="btn-danger" disabled={busy} onClick={() => remove.mutate()}>
            {remove.isPending ? 'Đang xoá…' : 'Xác nhận xoá'}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmingDelete(false)}>
            Thôi
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              patch.reset();
              remove.reset();
              setEditing(true);
            }}
          >
            Sửa
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              remove.reset();
              setConfirmingDelete(true);
            }}
          >
            Xoá
          </button>
        </div>
      )}
      {rowError && (
        <p role="alert" className={ERROR_CLASS}>
          {rowError}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Form dùng chung cho thêm và sửa
// ---------------------------------------------------------------------------

interface MultiplierValues {
  day: string;
  multiplier: number;
  message: string;
}

interface MultiplierFormProps {
  formLabel: string;
  initial: MultiplierValues;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  /** Dòng báo thành công (form thêm); bỏ trống thì form không có dòng trạng thái (form sửa đóng lại khi lưu xong). */
  success?: string | null;
  /** Đổi giá trị thì form về `initial` (sau khi thêm xong). */
  resetKey?: number;
  onCancel?: () => void;
  onChange: () => void;
  onSubmit: (body: MultiplierDayInput) => void;
}

function MultiplierForm({ formLabel, initial, submitLabel, pending, error, success, resetKey, onCancel, onChange, onSubmit }: MultiplierFormProps) {
  const id = useId();
  const today = vnTodayIso();
  const [values, setValues] = useState<MultiplierValues>(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  // Chỉnh state ngay trong lúc render khi `resetKey` đổi (mẫu "lưu giá trị prop trước" của React).
  const [seenResetKey, setSeenResetKey] = useState(resetKey);
  if (resetKey !== seenResetKey) {
    setSeenResetKey(resetKey);
    setValues(initial);
  }

  const update = (patch: Partial<MultiplierValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setLocalError(null);
    onChange();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isIsoDate(values.day)) return setLocalError('Hãy chọn ngày');
    // So chuỗi `YYYY-MM-DD` là so ngày; server vẫn kiểm tra lại theo giờ VN.
    if (values.day < today) return setLocalError(PAST_DAY);
    const message = values.message.trim();
    if (message.length > MESSAGE_MAX) return setLocalError(MESSAGE_TOO_LONG);
    setLocalError(null);
    onSubmit({ day: values.day, multiplier: values.multiplier, message: message === '' ? null : message });
  };

  const shown = localError ?? error;

  return (
    <form noValidate aria-label={formLabel} onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-day`} className={LABEL_CLASS}>
            Ngày
          </label>
          <input id={`${id}-day`} type="date" className="field" min={today} value={values.day} onChange={(event) => update({ day: event.target.value })} />
        </div>
        <Select stacked label="Hệ số" value={values.multiplier} onChange={(multiplier) => update({ multiplier })} groups={MULTIPLIER_GROUPS} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-message`} className={LABEL_CLASS}>
          Lời nhắn
        </label>
        {/* Không đặt `maxLength`: gõ/dán quá dài thì báo rõ thay vì lặng lẽ cắt. */}
        <input id={`${id}-message`} type="text" className="field" value={values.message} onChange={(event) => update({ message: event.target.value })} />
        <p className={HINT_CLASS}>Không bắt buộc, tối đa {MESSAGE_MAX} ký tự — hiện trên banner và tin Discord.</p>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? 'Đang lưu…' : submitLabel}
          </button>
          {onCancel && (
            <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>
              Huỷ
            </button>
          )}
        </div>
        {shown && (
          <p role="alert" className={ERROR_CLASS}>
            {shown}
          </p>
        )}
        {success !== undefined && (
          <p role="status" aria-live="polite" className={STATUS_CLASS}>
            {success}
          </p>
        )}
      </div>
    </form>
  );
}
