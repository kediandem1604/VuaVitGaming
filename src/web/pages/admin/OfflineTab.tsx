/**
 * Tab Offline (spec offline, mod và admin): form thêm sự kiện và danh sách — sắp tới trước (gần nhất
 * trước), rồi đã qua (thứ tự của server). Mỗi dòng: tên, thời gian, địa điểm, "{g} đi được · {k}
 * không đi được", nút Sửa, Đóng vote / Mở lại, Xoá (hỏi lại trước khi gửi).
 *
 * Form (thêm và sửa dùng chung): "Tên", "Thời gian" (`datetime-local`, giờ VN), "Địa điểm", "Mô tả"
 * (tuỳ chọn), "Hạn vote" (tuỳ chọn, ≤ thời gian sự kiện). Giờ gửi lên nguyên dạng `YYYY-MM-DDTHH:mm`
 * giờ VN — server đổi sang UTC; form sửa điền sẵn bằng `vnDateTimeInputValue` (qua `Intl`, múi giờ
 * VN), nên đúng cả khi máy người dùng không ở múi giờ Việt Nam. Hai chuỗi cùng dạng so theo từ điển
 * đúng bằng so thời gian (kiểm tra hạn vote tại chỗ). Sửa chỉ gửi các trường đã đổi.
 *
 * Mọi thay đổi làm mới danh sách và thẻ offline ở trang Hôm nay (`OFFLINE_UPCOMING_KEY`).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { AdminOfflineEventDto, OfflineEventInput, OfflineEventPatch } from '../../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { QueryState } from '../../components/QueryState';
import { cx } from '../../lib/cx';
import { formatDayTimeLabel, vnDateTimeInputValue } from '../../lib/format';
import { useStaggerOnce } from '../../lib/motion';
import { ADMIN_OFFLINE_EVENTS_KEY, OFFLINE_UPCOMING_KEY } from '../../lib/queryKeys';
import { Chip } from './Chip';

const TITLE_MAX = 80;
const PLACE_MAX = 120;
const DESCRIPTION_MAX = 500;

const H2_CLASS = 'text-xl leading-tight font-extrabold text-white';
const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';

interface EventValues {
  title: string;
  /** Giờ VN `YYYY-MM-DDTHH:mm` (rỗng = chưa chọn). */
  startsAt: string;
  place: string;
  description: string;
  /** Giờ VN `YYYY-MM-DDTHH:mm`, rỗng = không đặt hạn. */
  voteDeadline: string;
}

const EMPTY: EventValues = { title: '', startsAt: '', place: '', description: '', voteDeadline: '' };

/** Làm mới danh sách quản trị và thẻ offline ở trang Hôm nay. */
function useRefreshOffline() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ADMIN_OFFLINE_EVENTS_KEY });
    void queryClient.invalidateQueries({ queryKey: OFFLINE_UPCOMING_KEY });
  };
}

export function OfflineTab() {
  const events = useQuery({ queryKey: ADMIN_OFFLINE_EVENTS_KEY, queryFn: () => apiGet<AdminOfflineEventDto[]>('/api/admin/offline-events') });
  const headingId = useId();
  const stagger = useStaggerOnce((events.data?.length ?? 0) > 0);

  return (
    <>
      <CreateEvent />
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <h2 id={headingId} className={H2_CLASS}>
          Sự kiện offline
        </h2>
        <QueryState query={events}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>
                <p>Chưa có sự kiện offline nào</p>
              </EmptyState>
            ) : (
              <ul className={cx('panel flex flex-col divide-y divide-night-700 p-0', stagger)}>
                {list.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            )
          }
        </QueryState>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Thêm
// ---------------------------------------------------------------------------

function CreateEvent() {
  const refresh = useRefreshOffline();
  const create = useMutation({
    mutationFn: (body: OfflineEventInput) => apiSend<AdminOfflineEventDto>('POST', '/api/admin/offline-events', body),
    onSuccess: refresh,
  });

  return (
    <section className="panel flex flex-col gap-3">
      <h2 className={H2_CLASS}>Thêm sự kiện offline</h2>
      {/* `key` theo sự kiện vừa tạo: thêm xong thì form dựng lại trống. */}
      <EventForm
        key={create.data?.id ?? 'new'}
        formLabel="Thêm sự kiện offline"
        initial={EMPTY}
        submitLabel="Thêm sự kiện"
        pending={create.isPending}
        error={create.isError ? errorMessage(create.error) : null}
        success={create.isSuccess ? `Đã thêm “${create.data.title}”` : null}
        onChange={() => {
          if (create.isError || create.isSuccess) create.reset();
        }}
        onSubmit={(input) => create.mutate(input)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Một sự kiện: Sửa, Đóng vote / Mở lại, Xoá
// ---------------------------------------------------------------------------

function valuesOf(event: AdminOfflineEventDto): EventValues {
  return {
    title: event.title,
    startsAt: vnDateTimeInputValue(event.startsAt),
    place: event.place,
    description: event.description ?? '',
    voteDeadline: event.voteDeadline ? vnDateTimeInputValue(event.voteDeadline) : '',
  };
}

/** Chỉ các trường khác với giá trị ban đầu. */
function changedFields(initial: EventValues, input: OfflineEventInput): OfflineEventPatch {
  const patch: OfflineEventPatch = {};
  if (input.title !== initial.title) patch.title = input.title;
  if (input.startsAt !== initial.startsAt) patch.startsAt = input.startsAt;
  if (input.place !== initial.place) patch.place = input.place;
  if ((input.description ?? '') !== initial.description) patch.description = input.description ?? null;
  if ((input.voteDeadline ?? '') !== initial.voteDeadline) patch.voteDeadline = input.voteDeadline ?? null;
  return patch;
}

function EventRow({ event }: { event: AdminOfflineEventDto }) {
  const queryClient = useQueryClient();
  const refresh = useRefreshOffline();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const initial = valuesOf(event);

  const patch = useMutation({
    mutationFn: (body: OfflineEventPatch) => apiSend<AdminOfflineEventDto>('PATCH', `/api/admin/offline-events/${event.id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<AdminOfflineEventDto[]>(ADMIN_OFFLINE_EVENTS_KEY, (current) => current?.map((item) => (item.id === updated.id ? updated : item)));
      refresh();
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => apiSend<undefined>('DELETE', `/api/admin/offline-events/${event.id}`),
    onSuccess: () => {
      queryClient.setQueryData<AdminOfflineEventDto[]>(ADMIN_OFFLINE_EVENTS_KEY, (current) => current?.filter((item) => item.id !== event.id));
      refresh();
    },
    onSettled: () => setConfirmingDelete(false),
  });

  const rowError = patch.isError && !editing ? errorMessage(patch.error) : remove.isError ? errorMessage(remove.error) : null;
  const busy = patch.isPending || remove.isPending;

  return (
    <li className={cx('flex flex-col gap-2 px-4 py-3 text-sm', event.past && 'opacity-75')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 text-base font-bold break-words text-white">{event.title}</span>
        {event.past && <Chip>Đã qua</Chip>}
        {event.closed && <Chip tone="duck">Đã đóng vote</Chip>}
      </div>
      <p className="text-night-200 tabular-nums">{formatDayTimeLabel(event.startsAt)}</p>
      <p className="break-words text-night-200">{`📍 ${event.place}`}</p>
      {event.description && !editing && <p className="break-words whitespace-pre-line text-night-300">{event.description}</p>}
      <p className="text-night-300 tabular-nums">
        {`${event.goingCount} đi được · ${event.notGoingCount} không đi được`}
        {event.voteDeadline && ` · Hạn vote: ${formatDayTimeLabel(event.voteDeadline)}`}
      </p>

      {editing ? (
        <EventForm
          formLabel={`Sửa ${event.title}`}
          initial={initial}
          submitLabel="Lưu"
          pending={patch.isPending}
          error={patch.isError ? errorMessage(patch.error) : null}
          success={null}
          onCancel={() => {
            patch.reset();
            setEditing(false);
          }}
          onChange={() => {
            if (patch.isError) patch.reset();
          }}
          onSubmit={(input) => {
            const body = changedFields(initial, input);
            if (Object.keys(body).length === 0) return setEditing(false);
            patch.mutate(body);
          }}
        />
      ) : confirmingDelete ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-white">Xoá sự kiện này?</span>
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
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => patch.mutate({ closed: !event.closed })}>
            {event.closed ? 'Mở lại' : 'Đóng vote'}
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

interface EventFormProps {
  formLabel: string;
  initial: EventValues;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  success: string | null;
  onChange: () => void;
  /** Nhận thân đã kiểm tra: chữ đã cắt khoảng trắng, mô tả/hạn vote rỗng → `null`. */
  onSubmit: (input: OfflineEventInput) => void;
  onCancel?: () => void;
}

function EventForm({ formLabel, initial, submitLabel, pending, error, success, onChange, onSubmit, onCancel }: EventFormProps) {
  const id = useId();
  const [values, setValues] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);

  const update = (next: Partial<EventValues>) => {
    setValues((current) => ({ ...current, ...next }));
    setLocalError(null);
    onChange();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = values.title.trim();
    const place = values.place.trim();
    const description = values.description.trim();
    if (title === '' || title.length > TITLE_MAX) return setLocalError('Tên 1–80 ký tự');
    if (values.startsAt === '') return setLocalError('Hãy chọn thời gian');
    if (place === '' || place.length > PLACE_MAX) return setLocalError('Địa điểm 1–120 ký tự');
    if (description.length > DESCRIPTION_MAX) return setLocalError('Mô tả tối đa 500 ký tự');
    // Cùng dạng `YYYY-MM-DDTHH:mm` nên so chuỗi đúng bằng so thời gian.
    if (values.voteDeadline !== '' && values.voteDeadline > values.startsAt) return setLocalError('Hạn vote phải trước giờ sự kiện');
    setLocalError(null);
    onSubmit({
      title,
      startsAt: values.startsAt,
      place,
      description: description === '' ? null : description,
      voteDeadline: values.voteDeadline === '' ? null : values.voteDeadline,
    });
  };

  const shownError = localError ?? error;

  return (
    <form noValidate aria-label={formLabel} onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={`${id}-title`} className={LABEL_CLASS}>
          Tên
        </label>
        <input id={`${id}-title`} type="text" maxLength={TITLE_MAX} className="field" value={values.title} onChange={(e) => update({ title: e.target.value })} />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-starts`} className={LABEL_CLASS}>
          Thời gian
        </label>
        <input
          id={`${id}-starts`}
          type="datetime-local"
          className="field min-w-0"
          value={values.startsAt}
          onChange={(e) => update({ startsAt: e.target.value })}
        />
        <p className={HINT_CLASS}>Giờ Việt Nam.</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-deadline`} className={LABEL_CLASS}>
          Hạn vote
        </label>
        <input
          id={`${id}-deadline`}
          type="datetime-local"
          className="field min-w-0"
          max={values.startsAt || undefined}
          value={values.voteDeadline}
          onChange={(e) => update({ voteDeadline: e.target.value })}
        />
        <p className={HINT_CLASS}>Tuỳ chọn — để trống thì vote tới giờ sự kiện.</p>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={`${id}-place`} className={LABEL_CLASS}>
          Địa điểm
        </label>
        <input id={`${id}-place`} type="text" maxLength={PLACE_MAX} className="field" value={values.place} onChange={(e) => update({ place: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${id}-description`} className={LABEL_CLASS}>
            Mô tả
          </label>
          <span className={cx(HINT_CLASS, 'tabular-nums')}>
            {values.description.length}/{DESCRIPTION_MAX}
          </span>
        </div>
        <textarea
          id={`${id}-description`}
          rows={3}
          maxLength={DESCRIPTION_MAX}
          className="field"
          value={values.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
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
        {shownError && (
          <p role="alert" className={ERROR_CLASS}>
            {shownError}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm font-bold text-ok">
            {success}
          </p>
        )}
      </div>
    </form>
  );
}
