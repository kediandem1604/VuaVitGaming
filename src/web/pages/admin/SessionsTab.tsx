/**
 * Tab Buổi chơi (spec §4.3, §4.5): form tạo buổi (ngày, giờ, chế độ, sức chứa, mã
 * phòng, ghi chú); buổi của một ngày với nút Huỷ buổi và Kết thúc (hộp chọn hạng mục
 * từ `end-options`, tick sẵn theo `preselected`; không tick gì = kết thúc không mở
 * vote); các đợt vote đang mở với nút Đóng vote sớm. Sau mỗi thao tác ghi, các danh
 * sách liên quan được tải lại (kể cả trang Hôm nay dùng khoá `['sessions', …]`).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { EndOptionDto, ModeDto, OpenVoteRoundDto, SessionDto } from '../../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../../api';
import { QueryState } from '../../components/QueryState';
import { cx } from '../../lib/cx';
import { formatDateLabel, formatDayLabel, formatTime, vnTodayIso } from '../../lib/format';
import { Chip } from './Chip';

const MODES_KEY = ['modes'] as const;
const OPEN_ROUNDS_KEY = ['admin', 'vote-rounds', 'open'] as const;
const SESSIONS_PREFIX = ['sessions'] as const;
const HALL_PREFIX = ['mvp'] as const;

const VN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_CAPACITY = 16;
const DEFAULT_TIME = '21:00';
const CAPACITY_MIN = 1;
const CAPACITY_MAX = 25;
const ROOM_CODE_MAX = 20;
const NOTE_MAX = 300;

interface CreateBody {
  date: string;
  time: string;
  modeId: number;
  capacity: number;
  roomCode?: string;
  note?: string;
}

export function SessionsTab() {
  const [date, setDate] = useState(vnTodayIso());

  return (
    <>
      <CreateSessionForm onCreated={setDate} />
      <DaySessions date={date} onDateChange={setDate} />
      <OpenVoteRounds />
    </>
  );
}

// ---------------------------------------------------------------------------
// Tạo buổi
// ---------------------------------------------------------------------------

function CreateSessionForm({ onCreated }: { onCreated: (date: string) => void }) {
  const queryClient = useQueryClient();
  const id = useId();
  const modes = useQuery({ queryKey: MODES_KEY, queryFn: () => apiGet<ModeDto[]>('/api/modes') });

  const [date, setDate] = useState(vnTodayIso());
  const [time, setTime] = useState(DEFAULT_TIME);
  const [modeId, setModeId] = useState('');
  const [capacity, setCapacity] = useState(String(DEFAULT_CAPACITY));
  const [roomCode, setRoomCode] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // Chế độ đầu tiên làm mặc định khi danh sách tới (chỉ khi người dùng chưa chọn).
  const firstModeId = modes.data?.[0]?.id;
  useEffect(() => {
    if (firstModeId !== undefined) setModeId((current) => (current === '' ? String(firstModeId) : current));
  }, [firstModeId]);

  const create = useMutation({
    mutationFn: (body: CreateBody) => apiSend<SessionDto>('POST', '/api/admin/sessions', body),
    onSuccess: (_created, body) => {
      void queryClient.invalidateQueries({ queryKey: SESSIONS_PREFIX });
      setRoomCode('');
      setNote('');
      onCreated(body.date);
    },
  });

  const touch = () => {
    setLocalError(null);
    if (create.isError || create.isSuccess) create.reset();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (modeId === '') return setLocalError('Hãy chọn chế độ chơi');
    if (time === '') return setLocalError('Hãy nhập giờ bắt đầu');
    if (date === '') return setLocalError('Hãy chọn ngày');
    setLocalError(null);
    const room = roomCode.trim();
    const text = note.trim();
    create.mutate({
      date,
      time,
      modeId: Number(modeId),
      capacity: Number(capacity),
      ...(room !== '' ? { roomCode: room } : {}),
      ...(text !== '' ? { note: text } : {}),
    });
  };

  const error = localError ?? (create.isError ? errorMessage(create.error) : null);

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Tạo buổi chơi</h2>
      <form noValidate onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={`${id}-date`} label="Ngày">
          <input id={`${id}-date`} type="date" className="field" value={date} onChange={(e) => (setDate(e.target.value), touch())} />
        </Field>
        <Field id={`${id}-time`} label="Giờ bắt đầu">
          <input id={`${id}-time`} type="time" className="field" value={time} onChange={(e) => (setTime(e.target.value), touch())} />
        </Field>
        <Field id={`${id}-mode`} label="Chế độ chơi">
          <select id={`${id}-mode`} className="field" value={modeId} onChange={(e) => (setModeId(e.target.value), touch())}>
            {modes.data === undefined && <option value="">Đang tải…</option>}
            {modes.data?.map((mode) => (
              <option key={mode.id} value={String(mode.id)}>
                {mode.nameVi}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-capacity`} label="Sức chứa" hint={`${CAPACITY_MIN}–${CAPACITY_MAX} người`}>
          <input
            id={`${id}-capacity`}
            type="number"
            inputMode="numeric"
            min={CAPACITY_MIN}
            max={CAPACITY_MAX}
            step={1}
            className="field"
            value={capacity}
            onChange={(e) => (setCapacity(e.target.value), touch())}
          />
        </Field>
        <Field id={`${id}-room`} label="Mã phòng" hint="Không bắt buộc">
          <input id={`${id}-room`} type="text" maxLength={ROOM_CODE_MAX} className="field" value={roomCode} onChange={(e) => (setRoomCode(e.target.value), touch())} />
        </Field>
        <Field id={`${id}-note`} label="Ghi chú" hint={`${note.length}/${NOTE_MAX}`}>
          <input id={`${id}-note`} type="text" maxLength={NOTE_MAX} className="field" value={note} onChange={(e) => (setNote(e.target.value), touch())} />
        </Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <button type="submit" className="btn-primary w-full sm:w-auto sm:self-start" disabled={create.isPending || modes.data === undefined}>
            {create.isPending ? 'Đang tạo…' : 'Tạo buổi'}
          </button>
          {modes.isError && <p className="text-sm text-duck">Không tải được danh sách chế độ chơi: {errorMessage(modes.error)}</p>}
          {error && (
            <p role="alert" className="text-sm text-duck">
              {error}
            </p>
          )}
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-goose">
            {create.isSuccess && `Đã tạo buổi ${formatTime(create.data.startsAt)} ${create.data.modeName}`}
          </p>
        </div>
      </form>
    </section>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buổi của một ngày
// ---------------------------------------------------------------------------

function DaySessions({ date, onDateChange }: { date: string; onDateChange: (date: string) => void }) {
  const id = useId();
  const valid = VN_DATE.test(date);
  const sessions = useQuery({
    queryKey: [...SESSIONS_PREFIX, 'date', date],
    queryFn: () => apiGet<SessionDto[]>(`/api/sessions?date=${date}`),
    enabled: valid,
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{valid ? `Buổi chơi ${formatDayLabel(date)}` : 'Buổi chơi'}</h2>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Xem buổi ngày</span>
          <input id={`${id}-day`} type="date" className="field w-auto" value={date} onChange={(e) => onDateChange(e.target.value)} />
        </label>
      </div>
      <QueryState query={sessions}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-slate-600 dark:text-slate-400">Ngày này chưa có buổi chơi nào</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((session) => (
                <AdminSessionRow key={session.id} session={session} />
              ))}
            </ul>
          )
        }
      </QueryState>
    </section>
  );
}

const STATUS_CHIP: Record<Exclude<SessionDto['status'], 'scheduled'>, { text: string; tone: 'duck' | 'neutral' }> = {
  cancelled: { text: 'Đã huỷ', tone: 'duck' },
  ended: { text: 'Đã kết thúc', tone: 'neutral' },
};

function AdminSessionRow({ session }: { session: SessionDto }) {
  const queryClient = useQueryClient();
  const [ending, setEnding] = useState(false);
  const label = `${formatTime(session.startsAt)} ${session.modeName}`;

  const cancel = useMutation({
    mutationFn: () => apiSend<undefined>('POST', `/api/admin/sessions/${session.id}/cancel`),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: SESSIONS_PREFIX }),
  });

  const onCancel = () => {
    if (window.confirm(`Huỷ buổi ${label}? Người đã đăng ký sẽ nhận DM báo huỷ.`)) cancel.mutate();
  };

  return (
    <li>
      <article aria-label={label} className={cx('card flex flex-col gap-2', session.status === 'cancelled' && 'opacity-70')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <time dateTime={session.startsAt} className="text-xl font-bold tabular-nums">
            {formatTime(session.startsAt)}
          </time>
          <span className="font-semibold">{session.modeName}</span>
          {session.status !== 'scheduled' && <Chip tone={STATUS_CHIP[session.status].tone}>{STATUS_CHIP[session.status].text}</Chip>}
          <span className="ml-auto text-sm text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {session.attendees.length}/{session.capacity}
            </span>{' '}
            người
          </span>
        </div>
        {session.roomCode && <p className="text-sm font-medium">Mã phòng: {session.roomCode}</p>}
        {session.note && <p className="text-sm text-slate-700 dark:text-slate-300">{session.note}</p>}
        {session.status === 'scheduled' && (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={cancel.isPending} onClick={() => setEnding(true)}>
                Kết thúc
              </button>
              <button type="button" className="btn-secondary" disabled={cancel.isPending} onClick={onCancel}>
                {cancel.isPending ? 'Đang huỷ…' : 'Huỷ buổi'}
              </button>
            </div>
            {cancel.isError && (
              <p role="alert" className="text-sm text-duck">
                {errorMessage(cancel.error)}
              </p>
            )}
          </div>
        )}
        {ending && <EndDialog session={session} label={label} onClose={() => setEnding(false)} />}
      </article>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Hộp "Kết thúc buổi"
// ---------------------------------------------------------------------------

const SCOPE_NOTE: Record<EndOptionDto['scope'], string> = {
  always: 'Luôn có',
  mode: 'Theo chế độ',
  optional: 'Tuỳ chọn',
};

interface EndDialogProps {
  session: SessionDto;
  label: string;
  onClose: () => void;
}

/** Hộp chọn hạng mục mở vote; tick sẵn theo `preselected`, admin tick thêm hạng mục tuỳ chọn. */
function EndDialog({ session, label, onClose }: EndDialogProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const options = useQuery({
    queryKey: ['admin', 'end-options', session.id],
    queryFn: () => apiGet<EndOptionDto[]>(`/api/admin/sessions/${session.id}/end-options`),
  });
  // null = chưa đụng: lấy theo preselected của dữ liệu; đổi thì giữ bản của người dùng.
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const ticked = picked ?? new Set((options.data ?? []).filter((o) => o.preselected).map((o) => o.id));

  const end = useMutation({
    mutationFn: (categoryIds: number[]) => apiSend<undefined>('POST', `/api/admin/sessions/${session.id}/end`, { categoryIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SESSIONS_PREFIX });
      void queryClient.invalidateQueries({ queryKey: OPEN_ROUNDS_KEY });
      void queryClient.invalidateQueries({ queryKey: HALL_PREFIX });
      onClose();
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (optionId: number) => {
    const next = new Set(ticked);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    setPicked(next);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Theo thứ tự hạng mục của server (sortOrder), không theo thứ tự tick.
    end.mutate((options.data ?? []).filter((option) => ticked.has(option.id)).map((option) => option.id));
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card flex w-full max-w-md flex-col gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="text-lg font-semibold">
          Kết thúc buổi {label}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">Chọn hạng mục mở vote. Không tick gì thì buổi kết thúc mà không mở vote.</p>
        <QueryState query={options}>
          {(list) => (
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
              {list.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">Không có hạng mục nào đang bật</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {list.map((option) => (
                    <li key={option.id}>
                      <label className="flex items-center gap-2 py-1">
                        <input type="checkbox" className="size-4 accent-goose" checked={ticked.has(option.id)} onChange={() => toggle(option.id)} />
                        <span className="min-w-0 flex-1">{option.name}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{SCOPE_NOTE[option.scope]}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-primary" disabled={end.isPending}>
                  {end.isPending ? 'Đang kết thúc…' : 'Kết thúc buổi'}
                </button>
                <button type="button" className="btn-secondary" disabled={end.isPending} onClick={onClose}>
                  Đóng
                </button>
              </div>
              {end.isError && (
                <p role="alert" className="text-sm text-duck">
                  {errorMessage(end.error)}
                </p>
              )}
            </form>
          )}
        </QueryState>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vote đang mở
// ---------------------------------------------------------------------------

function OpenVoteRounds() {
  const rounds = useQuery({ queryKey: OPEN_ROUNDS_KEY, queryFn: () => apiGet<OpenVoteRoundDto[]>('/api/admin/vote-rounds?status=open') });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Vote đang mở</h2>
      <QueryState query={rounds}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-slate-600 dark:text-slate-400">Không có vote nào đang mở</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((round) => (
                <OpenRoundRow key={round.id} round={round} />
              ))}
            </ul>
          )
        }
      </QueryState>
    </section>
  );
}

function OpenRoundRow({ round }: { round: OpenVoteRoundDto }) {
  const queryClient = useQueryClient();
  const close = useMutation({
    mutationFn: () => apiSend<undefined>('POST', `/api/admin/vote-rounds/${round.id}/close`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: OPEN_ROUNDS_KEY });
      void queryClient.invalidateQueries({ queryKey: HALL_PREFIX });
    },
  });

  const onClose = () => {
    if (window.confirm(`Đóng sớm vote của buổi ${round.sessionLabel}? Kết quả sẽ được công bố ngay.`)) close.mutate();
  };

  return (
    <li className="card flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{round.sessionLabel}</span>
        <span className="text-sm text-slate-600 dark:text-slate-400">
          Tự đóng lúc {formatTime(round.closesAt)} {formatDateLabel(new Date(round.closesAt))}
        </span>
        <button type="button" className="btn-secondary ml-auto" disabled={close.isPending} onClick={onClose}>
          {close.isPending ? 'Đang đóng…' : 'Đóng vote sớm'}
        </button>
      </div>
      {close.isError && (
        <p role="alert" className="text-sm text-duck">
          {errorMessage(close.error)}
        </p>
      )}
    </li>
  );
}
