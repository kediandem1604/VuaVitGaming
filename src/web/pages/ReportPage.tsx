/**
 * Trang Khai điểm (spec §4.6): form khai một trận — tìm role (không phân biệt dấu,
 * `normalizeText` dùng chung với lệnh slash), giá trị có `max` = `maxPerGame` và nhãn
 * = `metricLabel` của role, ngày chơi trong [hôm nay − 3, hôm nay] giờ VN, buổi của
 * ngày đó (không bắt buộc), ghi chú ≤ 300 ký tự — rồi "Lần khai của tôi" với trạng
 * thái và ô sửa cho lần khai còn chờ duyệt.
 *
 * Form chỉ chặn tại chỗ hai lỗi hiển nhiên (chưa chọn role, chưa nhập giá trị); mọi
 * quy tắc khác (giới hạn của role, cửa sổ 3 ngày, mùa đã chốt…) do server báo và
 * thông báo của server được hiện nguyên văn. Lần khai vừa tạo/sửa được ghi thẳng vào
 * cache danh sách (dùng DTO server trả về) thay vì tải lại.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ReportDto, ReportStatus, RoleDto, SessionDto } from '../../shared/api-types';
import { normalizeText } from '../../shared/text';
import { apiGet, apiSend, errorMessage } from '../api';
import { QueryState } from '../components/QueryState';
import { cx } from '../lib/cx';
import { addDaysIso, formatDateLabel, formatTime, vnTodayIso } from '../lib/format';

export const MY_REPORTS_KEY = ['reports', 'mine'] as const;
const ROLES_KEY = ['roles'] as const;

const NOTE_MAX = 300;
/** Khai được trận từ hôm nay lùi tối đa bấy nhiêu ngày (server kiểm tra lại). */
const WINDOW_DAYS = 3;
/** Số gợi ý role tối đa khi gõ tìm. */
const MAX_SUGGESTIONS = 10;
const VN_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SUCCESS_MESSAGE = 'Đã gửi, chờ mod duyệt';

const STATUS_CHIP: Record<ReportStatus, { text: string; className: string }> = {
  pending: { text: 'Chờ duyệt', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { text: 'Đã duyệt', className: 'bg-goose/10 text-goose' },
  rejected: { text: 'Bị từ chối', className: 'bg-duck/10 text-duck' },
};

interface ReportBody {
  roleId: number;
  value: number;
  playedOn: string;
  sessionId?: number;
  note?: string;
}

interface ReportPatchBody {
  value: number;
  playedOn: string;
  note: string | null;
}

export function ReportPage() {
  const roles = useQuery({ queryKey: ROLES_KEY, queryFn: () => apiGet<RoleDto[]>('/api/roles') });
  const mine = useQuery({ queryKey: MY_REPORTS_KEY, queryFn: () => apiGet<ReportDto[]>('/api/reports/mine?limit=50') });

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-bold">Khai điểm</h1>

      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Khai một trận</h2>
        <QueryState query={roles}>{(list) => <ReportForm roles={list} />}</QueryState>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Lần khai của tôi</h2>
        <QueryState query={mine}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400">Bạn chưa khai điểm lần nào</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {list.map((report) => (
                  <ReportItem key={report.id} report={report} />
                ))}
              </ul>
            )
          }
        </QueryState>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form khai
// ---------------------------------------------------------------------------

function ReportForm({ roles }: { roles: RoleDto[] }) {
  const queryClient = useQueryClient();
  const ids = useFieldIds();
  const today = vnTodayIso();

  const [role, setRole] = useState<RoleDto | null>(null);
  const [value, setValue] = useState('');
  const [playedOn, setPlayedOn] = useState(today);
  const [sessionId, setSessionId] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: (body: ReportBody) => apiSend<ReportDto>('POST', '/api/reports', body),
    onSuccess: (created) => {
      queryClient.setQueryData<ReportDto[]>(MY_REPORTS_KEY, (current) => [created, ...(current ?? [])]);
      setValue('');
      setNote('');
    },
  });

  /** Người dùng sửa gì đó: bỏ thông báo của lần gửi trước. */
  const touch = () => {
    setLocalError(null);
    if (submit.isError || submit.isSuccess) submit.reset();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!role) {
      setLocalError('Hãy chọn role');
      return;
    }
    if (value.trim() === '') {
      setLocalError(`Hãy nhập ${role.metricLabel}`);
      return;
    }
    setLocalError(null);
    const trimmedNote = note.trim();
    submit.mutate({
      roleId: role.id,
      value: Number(value),
      playedOn,
      ...(sessionId !== '' ? { sessionId: Number(sessionId) } : {}),
      ...(trimmedNote !== '' ? { note: trimmedNote } : {}),
    });
  };

  const error = localError ?? (submit.isError ? errorMessage(submit.error) : null);

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <RolePicker
        roles={roles}
        selected={role}
        onSelect={(next) => {
          setRole(next);
          touch();
        }}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.value} className="text-sm font-medium">
          {role ? role.metricLabel : 'Giá trị'}
        </label>
        <input
          id={ids.value}
          type="number"
          inputMode="numeric"
          min={0}
          max={role?.maxPerGame}
          step={1}
          className="field"
          value={value}
          disabled={!role}
          onChange={(event) => {
            setValue(event.target.value);
            touch();
          }}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {role ? `Tối đa ${role.maxPerGame} mỗi trận` : 'Chọn role để biết chỉ số cần khai'}
        </p>
      </div>

      <DateField
        id={ids.date}
        today={today}
        value={playedOn}
        onChange={(next) => {
          setPlayedOn(next);
          setSessionId(''); // buổi thuộc ngày cũ không còn hợp lệ
          touch();
        }}
      />

      <SessionField
        id={ids.session}
        playedOn={playedOn}
        value={sessionId}
        onChange={(next) => {
          setSessionId(next);
          touch();
        }}
      />

      <NoteField
        id={ids.note}
        value={note}
        onChange={(next) => {
          setNote(next);
          touch();
        }}
      />

      <div className="flex flex-col gap-2">
        <button type="submit" className="btn-primary w-full sm:w-auto sm:self-start" disabled={submit.isPending}>
          {submit.isPending ? 'Đang gửi…' : 'Gửi khai điểm'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-duck">
            {error}
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-goose">
          {submit.isSuccess && SUCCESS_MESSAGE}
        </p>
      </div>
    </form>
  );
}

/** Id duy nhất cho các ô của một form (trang có nhiều form: khai mới và sửa từng lần khai). */
function useFieldIds() {
  const base = useId();
  return { value: `${base}-value`, date: `${base}-date`, session: `${base}-session`, note: `${base}-note` };
}

// ---------------------------------------------------------------------------
// Ô tìm role
// ---------------------------------------------------------------------------

interface RolePickerProps {
  roles: RoleDto[];
  selected: RoleDto | null;
  onSelect: (role: RoleDto | null) => void;
}

/** Khớp theo tên Việt, tên Anh hoặc key, không phân biệt hoa thường và dấu. */
function roleMatches(role: RoleDto, query: string): boolean {
  return [role.nameVi, role.nameEn, role.key.replaceAll('_', ' ')].some((text) => normalizeText(text).includes(query));
}

/**
 * Ô gõ tìm + danh sách gợi ý (combobox/listbox). Gõ chữ là bỏ role đang chọn và mở
 * gợi ý; chọn một gợi ý thì ô hiện tên role và đóng danh sách.
 */
function RolePicker({ roles, selected, onSelect }: RolePickerProps) {
  const inputId = useId();
  const listId = `${inputId}-options`;
  const [query, setQuery] = useState('');

  const normalised = normalizeText(query);
  const open = selected === null && normalised !== '';
  const matches = open ? roles.filter((role) => roleMatches(role, normalised)).slice(0, MAX_SUGGESTIONS) : [];

  const choose = (role: RoleDto) => {
    onSelect(role);
    setQuery(role.nameVi);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, role: RoleDto) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(role);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium">
        Role
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        placeholder="Gõ tên role, vd “kiem si”"
        className="field"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (selected) onSelect(null);
        }}
      />
      {open &&
        (matches.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Không có role nào khớp</p>
        ) : (
          <ul
            id={listId}
            role="listbox"
            aria-label="Kết quả tìm role"
            className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900"
          >
            {matches.map((role) => (
              <li
                key={role.id}
                role="option"
                aria-selected={false}
                tabIndex={0}
                className="cursor-pointer px-3 py-2 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"
                onClick={() => choose(role)}
                onKeyDown={(event) => onKeyDown(event, role)}
              >
                {role.icon} {role.nameVi} — {role.metricLabel}
              </li>
            ))}
          </ul>
        ))}
      {selected && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Đã chọn: {selected.icon} {selected.nameVi} ({selected.nameEn})
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Các ô dùng chung cho form khai và form sửa
// ---------------------------------------------------------------------------

interface DateFieldProps {
  id: string;
  today: string;
  value: string;
  onChange: (value: string) => void;
}

/** Ngày chơi, giới hạn [hôm nay − 3, hôm nay] giờ VN (server vẫn kiểm tra lại). */
function DateField({ id, today, value, onChange }: DateFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
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
    </div>
  );
}

interface SessionFieldProps {
  id: string;
  playedOn: string;
  value: string;
  onChange: (value: string) => void;
}

/** Buổi chơi của ngày đã chọn (bỏ buổi đã huỷ); không bắt buộc. */
function SessionField({ id, playedOn, value, onChange }: SessionFieldProps) {
  const valid = VN_DATE.test(playedOn);
  const sessions = useQuery({
    queryKey: ['sessions', 'date', playedOn],
    queryFn: () => apiGet<SessionDto[]>(`/api/sessions?date=${playedOn}`),
    enabled: valid,
  });
  const options = (sessions.data ?? []).filter((session) => session.status !== 'cancelled');

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
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
      {sessions.isError && <p className="text-xs text-duck">Không tải được danh sách buổi, bạn vẫn khai được không kèm buổi</p>}
      {valid && sessions.data && options.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">Ngày này không có buổi chơi nào</p>
      )}
    </div>
  );
}

interface NoteFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

function NoteField({ id, value, onChange }: NoteFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          Ghi chú
        </label>
        <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
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

// ---------------------------------------------------------------------------
// Lần khai của tôi
// ---------------------------------------------------------------------------

function ReportItem({ report }: { report: ReportDto }) {
  const [editing, setEditing] = useState(false);
  const chip = STATUS_CHIP[report.status];

  return (
    <li className="card flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">
          {report.role.icon} {report.role.nameVi}
        </span>
        <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', chip.className)}>{chip.text}</span>
        <time dateTime={report.playedOn} className="ml-auto text-sm text-slate-600 tabular-nums dark:text-slate-400">
          {formatDateLabel(report.playedOn)}
        </time>
      </div>

      {editing ? (
        <EditForm report={report} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className="text-slate-800 dark:text-slate-200">{`${report.value} ${report.role.metricLabel}`}</p>
          {report.sessionId !== null && <p className="text-sm text-slate-600 dark:text-slate-400">Buổi #{report.sessionId}</p>}
          {report.note && <p className="text-sm text-slate-700 dark:text-slate-300">{report.note}</p>}
          {report.status === 'rejected' && report.rejectReason && (
            <p className="text-sm text-duck">Lý do: {report.rejectReason}</p>
          )}
          {report.status === 'pending' && (
            <button type="button" className="btn-secondary self-start" onClick={() => setEditing(true)}>
              Sửa
            </button>
          )}
        </>
      )}
    </li>
  );
}

/** Sửa giá trị / ngày / ghi chú của lần khai còn chờ duyệt (PATCH); role và buổi giữ nguyên. */
function EditForm({ report, onDone }: { report: ReportDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const ids = useFieldIds();
  const today = vnTodayIso();
  const [value, setValue] = useState(String(report.value));
  const [playedOn, setPlayedOn] = useState(report.playedOn);
  const [note, setNote] = useState(report.note ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: ReportPatchBody) => apiSend<ReportDto>('PATCH', `/api/reports/${report.id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<ReportDto[]>(MY_REPORTS_KEY, (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)),
      );
      onDone();
    },
    // Lần khai có thể vừa được duyệt/từ chối: tải lại để thấy trạng thái thật.
    onError: () => void queryClient.invalidateQueries({ queryKey: MY_REPORTS_KEY }),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim() === '') {
      setLocalError(`Hãy nhập ${report.role.metricLabel}`);
      return;
    }
    setLocalError(null);
    const trimmedNote = note.trim();
    save.mutate({ value: Number(value), playedOn, note: trimmedNote === '' ? null : trimmedNote });
  };

  const error = localError ?? (save.isError ? errorMessage(save.error) : null);

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.value} className="text-sm font-medium">
          {report.role.metricLabel}
        </label>
        <input
          id={ids.value}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          className="field"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setLocalError(null);
          }}
        />
      </div>
      <DateField id={ids.date} today={today} value={playedOn} onChange={setPlayedOn} />
      <NoteField id={ids.note} value={note} onChange={setNote} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button type="button" className="btn-secondary" disabled={save.isPending} onClick={onDone}>
          Huỷ
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-duck">
          {error}
        </p>
      )}
    </form>
  );
}
