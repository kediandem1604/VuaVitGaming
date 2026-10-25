/**
 * Trang Khai điểm (spec §4.6, §6): form khai một trận — tìm role (không phân biệt dấu,
 * `normalizeText` dùng chung với lệnh slash), giá trị có `max` = `maxPerGame` và nhãn
 * = `metricLabel` của role, ngày chơi trong [hôm nay − 3, hôm nay] giờ VN, buổi của
 * ngày đó (không bắt buộc), ghi chú ≤ 300 ký tự — rồi "Lần khai của tôi" với trạng
 * thái và ô sửa cho lần khai còn chờ duyệt.
 *
 * Giao diện Sảnh đêm: mỗi gợi ý role có nhân vật thu nhỏ (không bảng tên, chỉ trang trí) +
 * tên role + chip phe; role đã chọn hiện thành thẻ nhỏ có nhân vật; chip trạng thái lần khai: chờ
 * duyệt `gold`, đã duyệt `ok`, bị từ chối `duck-soft`.
 *
 * Form chỉ chặn tại chỗ hai lỗi hiển nhiên (chưa chọn role, chưa nhập giá trị) và file
 * highlight sai loại/quá cỡ; mọi quy tắc khác (giới hạn của role, cửa sổ 3 ngày, mùa đã
 * chốt…) do server báo và thông báo của server được hiện nguyên văn. Lần khai vừa tạo/sửa
 * được ghi thẳng vào cache danh sách (dùng DTO server trả về) thay vì tải lại.
 *
 * Highlight (spec highlight §3): ô file không bắt buộc, chỉ hiện khi tính năng dùng được;
 * gửi = tạo lần khai rồi mới tải file, lỗi tải file không huỷ lần khai. Danh sách có link
 * "Xem highlight" và nút Thêm/Đổi trên lần khai còn chờ duyệt (`ReportHighlight.tsx`).
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Faction, HighlightConfigDto, ReportDto, ReportStatus, RoleDto, SessionDto } from '../../shared/api-types';
import { normalizeText } from '../../shared/text';
import { apiGet, apiSend, errorMessage } from '../api';
import { Character } from '../components/Character';
import { EmptyState } from '../components/EmptyState';
import { HighlightLink } from '../components/HighlightLink';
import { QueryState } from '../components/QueryState';
import { cx } from '../lib/cx';
import { FACTION_LABEL } from '../lib/factions';
import { addDaysIso, formatDateLabel, formatTime, vnTodayIso } from '../lib/format';
import { HighlightButton, HighlightField, checkHighlight, uploadHighlight, type HighlightUpload } from './ReportHighlight';

export const MY_REPORTS_KEY = ['reports', 'mine'] as const;
const ROLES_KEY = ['roles'] as const;
const HIGHLIGHT_CONFIG_KEY = ['reports', 'highlight-config'] as const;

const NOTE_MAX = 300;
/** Khai được trận từ hôm nay lùi tối đa bấy nhiêu ngày (server kiểm tra lại). */
const WINDOW_DAYS = 3;
/** Số gợi ý role tối đa khi gõ tìm. */
const MAX_SUGGESTIONS = 10;
const VN_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SUCCESS_MESSAGE = 'Đã gửi, chờ mod duyệt';
/** Lần khai đã tạo nhưng bước tải highlight lỗi: báo riêng kèm lời của server; người dùng thêm lại ở danh sách. */
const highlightNotUploaded = (reason: string) => `Đã gửi khai điểm, nhưng highlight chưa tải lên được: ${reason}`;

/** Chip trạng thái: nền màu trạng thái, chữ mực tối (`gold-ink` trên vàng, `night-950` trên `ok`/`duck-soft`). */
const STATUS_CHIP: Record<ReportStatus, { text: string; className: string }> = {
  pending: { text: 'Chờ duyệt', className: 'bg-gold text-gold-ink' },
  approved: { text: 'Đã duyệt', className: 'bg-ok text-night-950' },
  rejected: { text: 'Bị từ chối', className: 'bg-duck-soft text-night-950' },
};

/** Chip phe cạnh tên role: chữ trắng trên bản `-strong` (`goose`/`duck` gốc không đủ tương phản). */
const FACTION_CHIP: Record<Faction, string> = {
  goose: 'bg-goose-strong',
  duck: 'bg-duck-strong',
  neutral: 'bg-third',
};

/** Nhân vật thu nhỏ trong gợi ý và trong thẻ role đã chọn (px, kèm lớp bề rộng tương ứng). */
const SUGGESTION_FIGURE = { size: 40, className: 'w-10' };
const CHOSEN_FIGURE = { size: 64, className: 'w-16' };

const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';

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

/** Gửi khai điểm: thân JSON và file highlight đã kiểm tra (nếu có chọn). */
interface SubmitInput {
  body: ReportBody;
  highlight: HighlightUpload | null;
}

/** Lần khai đã tạo (có `highlightUrl` nếu tải được) và lỗi riêng của bước tải file, nếu có. */
interface SubmitResult {
  report: ReportDto;
  highlightError: string | null;
}

/** Thay một lần khai trong cache "Lần khai của tôi" bằng DTO server vừa trả. */
function replaceInMine(queryClient: QueryClient, updated: ReportDto) {
  queryClient.setQueryData<ReportDto[]>(MY_REPORTS_KEY, (current) => current?.map((item) => (item.id === updated.id ? updated : item)));
}

export function ReportPage() {
  const roles = useQuery({ queryKey: ROLES_KEY, queryFn: () => apiGet<RoleDto[]>('/api/roles') });
  const mine = useQuery({ queryKey: MY_REPORTS_KEY, queryFn: () => apiGet<ReportDto[]>('/api/reports/mine?limit=50') });
  const config = useQuery({ queryKey: HIGHLIGHT_CONFIG_KEY, queryFn: () => apiGet<HighlightConfigDto>('/api/reports/highlight-config') });
  /**
   * Highlight dùng được = tính năng bật và hỏi được giới hạn. Hỏi lỗi (vd bot Discord đang rớt)
   * coi như không có: ẩn ô file và nút Thêm/Đổi, không báo gì — khai điểm vẫn bình thường.
   */
  const highlight = config.data?.enabled ? config.data : null;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
      <h1 className="text-raised text-3xl leading-none font-extrabold text-white">Khai điểm</h1>

      <section className="panel flex flex-col gap-3">
        <h2 className="text-xl leading-tight font-extrabold text-white">Khai một trận</h2>
        <QueryState query={roles}>{(list) => <ReportForm roles={list} highlight={highlight} />}</QueryState>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl leading-tight font-extrabold text-white">Lần khai của tôi</h2>
        <QueryState query={mine}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>
                <p>Bạn chưa khai điểm lần nào</p>
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {list.map((report) => (
                  <ReportItem key={report.id} report={report} highlight={highlight} />
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

interface ReportFormProps {
  roles: RoleDto[];
  /** `null` = highlight không dùng được (tắt hoặc hỏi không được): không có ô file. */
  highlight: HighlightConfigDto | null;
}

function ReportForm({ roles, highlight }: ReportFormProps) {
  const queryClient = useQueryClient();
  const ids = useFieldIds();
  const today = vnTodayIso();

  const [role, setRole] = useState<RoleDto | null>(null);
  const [value, setValue] = useState('');
  const [playedOn, setPlayedOn] = useState(today);
  const [sessionId, setSessionId] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  /** Đang ở bước tải file (sau khi lần khai đã tạo xong) — để nút gửi nói đúng việc đang làm. */
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** File đang chọn đã kiểm tra loại và dung lượng; `null` khi không chọn (hoặc ô file không hiện). */
  const chosen = file && highlight ? checkHighlight(file, highlight.maxBytes) : null;

  const submit = useMutation({
    mutationFn: async ({ body, highlight: upload }: SubmitInput): Promise<SubmitResult> => {
      const created = await apiSend<ReportDto>('POST', '/api/reports', body);
      if (!upload) return { report: created, highlightError: null };
      // Lỗi tải file không huỷ lần khai vừa tạo: vẫn là "gửi xong", kèm lời báo riêng.
      setUploading(true);
      try {
        return { report: await uploadHighlight(created.id, upload), highlightError: null };
      } catch (error) {
        return { report: created, highlightError: errorMessage(error) };
      } finally {
        setUploading(false);
      }
    },
    onSuccess: ({ report }) => {
      queryClient.setQueryData<ReportDto[]>(MY_REPORTS_KEY, (current) => [report, ...(current ?? [])]);
      setValue('');
      setNote('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
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
    // File sai loại/quá cỡ: lời báo đã hiện sẵn dưới form, không gửi gì cả.
    if (chosen?.problem) return;
    setLocalError(null);
    const trimmedNote = note.trim();
    submit.mutate({
      body: {
        roleId: role.id,
        value: Number(value),
        playedOn,
        ...(sessionId !== '' ? { sessionId: Number(sessionId) } : {}),
        ...(trimmedNote !== '' ? { note: trimmedNote } : {}),
      },
      highlight: chosen?.upload ?? null,
    });
  };

  const highlightError = submit.data?.highlightError ?? null;
  const error =
    localError ??
    chosen?.problem ??
    (submit.isError ? errorMessage(submit.error) : null) ??
    (highlightError !== null ? highlightNotUploaded(highlightError) : null);

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
        <label htmlFor={ids.value} className={LABEL_CLASS}>
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
        <p className={HINT_CLASS}>{role ? `Tối đa ${role.maxPerGame} mỗi trận` : 'Chọn role để biết chỉ số cần khai'}</p>
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

      {highlight && (
        <HighlightField
          id={ids.highlight}
          ref={fileInput}
          maxBytes={highlight.maxBytes}
          onChange={(next) => {
            setFile(next);
            touch();
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        <button type="submit" className="btn-primary w-full sm:w-auto sm:self-start" disabled={submit.isPending}>
          {uploading ? 'Đang tải highlight…' : submit.isPending ? 'Đang gửi…' : 'Gửi khai điểm'}
        </button>
        {error && (
          <p role="alert" className="text-sm font-bold text-duck-soft">
            {error}
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-5 text-sm font-bold text-ok">
          {submit.isSuccess && highlightError === null && SUCCESS_MESSAGE}
        </p>
      </div>
    </form>
  );
}

/** Id duy nhất cho các ô của một form (trang có nhiều form: khai mới và sửa từng lần khai). */
function useFieldIds() {
  const base = useId();
  return {
    value: `${base}-value`,
    date: `${base}-date`,
    session: `${base}-session`,
    note: `${base}-note`,
    highlight: `${base}-highlight`,
  };
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
 * gợi ý; chọn một gợi ý thì ô hiện tên role, đóng danh sách và hiện thẻ role đã chọn.
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
      <label htmlFor={inputId} className={LABEL_CLASS}>
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
          <p className={HINT_CLASS}>Không có role nào khớp</p>
        ) : (
          <ul
            id={listId}
            role="listbox"
            aria-label="Kết quả tìm role"
            className="panel-inset flex max-h-80 flex-col gap-0.5 overflow-y-auto p-1"
          >
            {matches.map((role) => (
              // Viền focus lùi vào trong (-outline-offset) để không bị khung cuộn cắt mất.
              <li
                key={role.id}
                role="option"
                aria-selected={false}
                tabIndex={0}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-night-700 focus-visible:-outline-offset-3 focus-visible:bg-night-700"
                onClick={() => choose(role)}
                onKeyDown={(event) => onKeyDown(event, role)}
              >
                <RoleFigure role={role} {...SUGGESTION_FIGURE} />
                {/* Chip phe xuống dòng dưới tên khi hàng hẹp (320px với tên role dài). */}
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words">
                    <span className="font-bold text-white">
                      <span aria-hidden="true">{role.icon}</span> {role.nameVi}
                    </span>
                    <span className="text-night-300"> — {role.metricLabel}</span>
                  </span>
                  <FactionChip faction={role.faction} />
                </span>
              </li>
            ))}
          </ul>
        ))}
      {selected && (
        <div className="panel-inset flex items-center gap-3">
          <RoleFigure role={selected} {...CHOSEN_FIGURE} />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <p className="text-sm text-night-300">
              Đã chọn:{' '}
              <span className="font-bold text-white">
                <span aria-hidden="true">{selected.icon}</span> {selected.nameVi}
              </span>{' '}
              ({selected.nameEn})
            </p>
            <FactionChip faction={selected.faction} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Nhân vật thu nhỏ không bảng tên, chỉ để nhận ra role bằng bộ đồ; tên người giữ để
 * trống (null sẽ ra hình bóng "chưa ai hoá thân"). Bọc trong ô bề rộng cố định vì
 * `Character` tự rộng hết ô chứa. Ô bọc `aria-hidden`: tên role đã viết ngay bên cạnh,
 * nếu để `role="img"` của nhân vật thì trình đọc màn hình đọc tên role hai lần.
 */
function RoleFigure({ role, size, className }: { role: RoleDto; size: number; className: string }) {
  return (
    <div aria-hidden="true" className={cx('shrink-0', className)}>
      <Character role={role} holderName="" variant="current" size={size} nameplate={false} />
    </div>
  );
}

function FactionChip({ faction }: { faction: Faction }) {
  return <span className={cx('chip px-2 py-0.5 text-xs', FACTION_CHIP[faction])}>{FACTION_LABEL[faction]}</span>;
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
      {sessions.isError && (
        <p className="text-sm text-duck-soft">Không tải được danh sách buổi, bạn vẫn khai được không kèm buổi</p>
      )}
      {valid && sessions.data && options.length === 0 && <p className={HINT_CLASS}>Ngày này không có buổi chơi nào</p>}
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

// ---------------------------------------------------------------------------
// Lần khai của tôi
// ---------------------------------------------------------------------------

interface ReportItemProps {
  report: ReportDto;
  /** `null` = highlight không dùng được: không có nút Thêm/Đổi (link "Xem highlight" vẫn hiện nếu đã có). */
  highlight: HighlightConfigDto | null;
}

function ReportItem({ report, highlight }: ReportItemProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const chip = STATUS_CHIP[report.status];

  return (
    <li className="panel flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold text-white">
          {report.role.icon} {report.role.nameVi}
        </span>
        <span className={cx('chip', chip.className)}>{chip.text}</span>
        <time dateTime={report.playedOn} className="ml-auto text-sm text-night-300 tabular-nums">
          {formatDateLabel(report.playedOn)}
        </time>
      </div>

      {editing ? (
        <EditForm report={report} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className="font-bold text-white">{`${report.value} ${report.role.metricLabel}`}</p>
          {report.sessionId !== null && <p className={HINT_CLASS}>Buổi #{report.sessionId}</p>}
          {report.note && <p className="text-sm text-night-200">{report.note}</p>}
          {report.status === 'rejected' && report.rejectReason && (
            <p className="text-sm text-duck-soft">Lý do: {report.rejectReason}</p>
          )}
          {report.highlightUrl && <HighlightLink href={report.highlightUrl} />}
          {report.status === 'pending' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                Sửa
              </button>
              {highlight && (
                <HighlightButton
                  report={report}
                  maxBytes={highlight.maxBytes}
                  onUploaded={(updated) => replaceInMine(queryClient, updated)}
                  // Lần khai có thể vừa được duyệt/từ chối: tải lại để thấy trạng thái thật.
                  onFailed={() => void queryClient.invalidateQueries({ queryKey: MY_REPORTS_KEY })}
                />
              )}
            </div>
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
      replaceInMine(queryClient, updated);
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
        <label htmlFor={ids.value} className={LABEL_CLASS}>
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
        <p role="alert" className="text-sm font-bold text-duck-soft">
          {error}
        </p>
      )}
    </form>
  );
}
