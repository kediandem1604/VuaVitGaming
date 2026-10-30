/**
 * Tab Role (spec §4.6, chỉ admin): form "Thêm role" (khi game cập nhật; `POST
 * /api/admin/roles`, lỗi của server như "Key đã tồn tại" hiện nguyên văn), rồi mọi role
 * kể cả đã tắt (`/api/roles?all=1`, khoá `['roles','all']` — khác `['roles']` của bảng
 * xếp hạng), nhóm theo phe và nhóm "Chế độ đặc biệt" như Đại sảnh. Mỗi role sửa được
 * phe, tên Việt, tên chỉ số, tối đa mỗi trận, điểm mỗi lần, biểu tượng, bật/tắt (PATCH chỉ
 * các trường đã đổi); tải ảnh PNG/JPG/WebP ≤ 1 MB (kiểm tra tại chỗ rồi `PUT` body thô) và
 * xoá ảnh. Thêm role, đổi phe hay đổi ảnh thì mọi nơi vẽ nhân vật (Đại sảnh, xếp hạng) được
 * tải lại.
 *
 * Thanh "Tìm role…" (spec điểm role §5) trên đầu danh sách lọc theo tên Việt/Anh, không dấu,
 * không phân biệt hoa thường (`normalizeText` dùng chung với ô chọn role); nhóm không còn role
 * nào thì ẩn, không nhóm nào còn → "Không có role nào khớp".
 *
 * Chỉ số phụ (spec chỉ số phụ §5) và chỉ số phạt (spec điểm role §5) cùng một kiểu: cả form
 * thêm và form sửa có ô tick ("Có chỉ số phụ" / "Có điểm trừ"); tick thì hiện ba ô (tên, "Tối
 * đa mỗi trận", điểm — "Điểm mỗi lần" / "Điểm trừ mỗi lần"), kiểm tra tại chỗ như service. Gửi
 * đủ cả ba (tick) hoặc `null` cả ba (bỏ tick); form sửa chỉ gửi khi có gì đổi. Server không cho
 * tắt khi role đã có lần khai dùng chỉ số đó — lời từ chối hiện nguyên văn. Ô "Điểm mỗi lần" của
 * chỉ số chính (`points`, 1–100) luôn gửi khi thêm; khi sửa chỉ gửi nếu đổi.
 *
 * Giao diện Sảnh đêm (spec §6 Quản trị): mỗi role một `panel`; role chưa có ảnh hiện nhân
 * vật vẽ theo bộ đồ (`Character`, không bảng tên) đứng yên — lớp `goose-still` trên danh
 * sách tắt nhún/chớp vì bảng quản trị ưu tiên dễ đọc; Xoá ảnh là `btn-danger`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Faction, ModeDto, RoleDto } from '../../../shared/api-types';
import { normalizeText } from '../../../shared/text';
import { apiGet, apiPutBlob, apiSend, errorMessage } from '../../api';
import { Character } from '../../components/Character';
import { EmptyState } from '../../components/EmptyState';
import { QueryState } from '../../components/QueryState';
import { FACTIONS, FACTION_LABEL, isSpecialRole, SPECIAL_LABEL } from '../../lib/factions';
import { Chip } from './Chip';
import { Checkbox } from './Controls';

const ALL_ROLES_KEY = ['roles', 'all'] as const;
const MODES_KEY = ['modes'] as const;
/** Mọi khoá role (`['roles']`, `['roles','all']`) và Đại sảnh — nơi vẽ nhân vật/ảnh. */
const ROLES_PREFIX = ['roles'] as const;
const HALL_PREFIX = ['hall'] as const;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_MAX_BYTES = 1_048_576;
const INVALID_IMAGE = 'Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB';
const MAX_PER_GAME_MIN = 1;
const MAX_PER_GAME_MAX = 100;
/** Điểm mỗi đơn vị chỉ số chính (như service): 1–100. */
const POINTS_MIN = 1;
const POINTS_MAX = 100;
const POINTS_ERROR = `Điểm mỗi lần phải từ ${POINTS_MIN} đến ${POINTS_MAX}`;
/** Giới hạn ba ô của một bộ chỉ số tuỳ chọn (phụ/phạt, như service): tên 1–60 ký tự, tối đa và điểm 1–100. */
const METRIC_LABEL_MAX = 60;
const METRIC_MIN = 1;
const METRIC_MAX = 100;
const NO_MATCH_MESSAGE = 'Không có role nào khớp';

const H2_CLASS = 'text-xl leading-tight font-extrabold text-white';
const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';
const STATUS_CLASS = 'min-h-5 text-sm font-bold text-ok';
/** Bề rộng nhân vật trong ô hình (px) — ô `w-18` trừ viền và đệm của `panel-inset`. */
const FIGURE_SIZE = 60;

// ---------------------------------------------------------------------------
// Bộ chỉ số tuỳ chọn (chỉ số phụ, chỉ số phạt): ô tick + ba ô
// ---------------------------------------------------------------------------

/** Ba ô của một bộ chỉ số tuỳ chọn đang gõ (chuỗi) và ô tick. */
interface MetricValues {
  enabled: boolean;
  label: string;
  max: string;
  points: string;
}

/** Ô tick tắt, ba ô về mặc định (như "Tối đa mỗi trận" của chỉ số chính mặc định 1). */
const METRIC_EMPTY: MetricValues = { enabled: false, label: '', max: '1', points: '1' };

/** Ba giá trị đã kiểm tra của một bộ chỉ số tuỳ chọn; `null` cả ba khi bỏ tick. */
interface MetricTriple {
  label: string | null;
  max: number | null;
  points: number | null;
}

/** Chữ hiện của một bộ chỉ số tuỳ chọn: tên ô tick, nhãn ba ô, gợi ý và câu lỗi (khớp service). */
interface MetricTexts {
  toggle: string;
  labelField: string;
  labelHint: string;
  pointsField: string;
  pointsHint: string;
  labelEmptyError: string;
  labelLengthError: string;
  maxError: string;
  pointsError: string;
}

const EXTRA_TEXTS: MetricTexts = {
  toggle: 'Có chỉ số phụ',
  labelField: 'Tên chỉ số phụ',
  labelHint: 'Vd “Số lần ám sát trong cuộc họp”.',
  pointsField: 'Điểm mỗi lần',
  pointsHint: 'Điểm cộng cho mỗi đơn vị chỉ số phụ.',
  labelEmptyError: 'Tên chỉ số phụ không được để trống',
  labelLengthError: `Tên chỉ số phụ phải từ 1 đến ${METRIC_LABEL_MAX} ký tự`,
  maxError: `Tối đa mỗi trận của chỉ số phụ phải từ ${METRIC_MIN} đến ${METRIC_MAX}`,
  pointsError: `Điểm mỗi lần của chỉ số phụ phải từ ${METRIC_MIN} đến ${METRIC_MAX}`,
};

const PENALTY_TEXTS: MetricTexts = {
  toggle: 'Có điểm trừ',
  labelField: 'Tên chỉ số phạt',
  labelHint: 'Vd “Số phát bắn sai”.',
  pointsField: 'Điểm trừ mỗi lần',
  pointsHint: 'Số dương; bị trừ khỏi điểm cho mỗi đơn vị chỉ số phạt.',
  labelEmptyError: 'Tên chỉ số phạt không được để trống',
  labelLengthError: `Tên chỉ số phạt phải từ 1 đến ${METRIC_LABEL_MAX} ký tự`,
  maxError: `Tối đa mỗi trận của chỉ số phạt phải từ ${METRIC_MIN} đến ${METRIC_MAX}`,
  pointsError: `Điểm trừ mỗi lần phải từ ${METRIC_MIN} đến ${METRIC_MAX}`,
};

/** Trạng thái ba ô theo bộ ba của role đang có (form sửa). */
function metricValuesOf(triple: MetricTriple): MetricValues {
  return triple.label === null ? METRIC_EMPTY : { enabled: true, label: triple.label, max: String(triple.max), points: String(triple.points) };
}

/**
 * Kiểm tra ba ô như service rồi ra bộ ba: bỏ tick → `null` cả ba; tick → đủ cả ba.
 * Lỗi đầu tiên gặp được trả về để hiện tại chỗ (không gửi).
 */
function parseMetric(values: MetricValues, texts: MetricTexts): { triple: MetricTriple; error: null } | { triple: null; error: string } {
  if (!values.enabled) return { triple: { label: null, max: null, points: null }, error: null };
  const label = values.label.trim();
  if (label === '') return { triple: null, error: texts.labelEmptyError };
  if (Array.from(label).length > METRIC_LABEL_MAX) return { triple: null, error: texts.labelLengthError };
  const max = parseBounded(values.max, METRIC_MIN, METRIC_MAX);
  if (max === null) return { triple: null, error: texts.maxError };
  const points = parseBounded(values.points, METRIC_MIN, METRIC_MAX);
  if (points === null) return { triple: null, error: texts.pointsError };
  return { triple: { label, max, points }, error: null };
}

/** Số nguyên trong `[min, max]` từ ô đang gõ; rỗng/không nguyên/ngoài khoảng → null. */
function parseBounded(raw: string, min: number, max: number): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function tripleChanged(a: MetricTriple, b: MetricTriple): boolean {
  return a.label !== b.label || a.max !== b.max || a.points !== b.points;
}

/** Ba trường chỉ số phụ như API nhận: cùng có hoặc cùng null. */
interface ExtraMetricBody {
  extraMetricLabel: string | null;
  extraMaxPerGame: number | null;
  extraPoints: number | null;
}

/** Ba trường chỉ số phạt như API nhận: cùng có hoặc cùng null. */
interface PenaltyMetricBody {
  penaltyMetricLabel: string | null;
  penaltyMaxPerGame: number | null;
  penaltyPoints: number | null;
}

const extraOf = (role: RoleDto): MetricTriple => ({ label: role.extraMetricLabel, max: role.extraMaxPerGame, points: role.extraPoints });
const penaltyOf = (role: RoleDto): MetricTriple => ({ label: role.penaltyMetricLabel, max: role.penaltyMaxPerGame, points: role.penaltyPoints });
const toExtraBody = (t: MetricTriple): ExtraMetricBody => ({ extraMetricLabel: t.label, extraMaxPerGame: t.max, extraPoints: t.points });
const toPenaltyBody = (t: MetricTriple): PenaltyMetricBody => ({ penaltyMetricLabel: t.label, penaltyMaxPerGame: t.max, penaltyPoints: t.points });

interface RolePatch extends Partial<ExtraMetricBody>, Partial<PenaltyMetricBody> {
  faction?: Faction;
  nameVi?: string;
  metricLabel?: string;
  maxPerGame?: number;
  points?: number;
  icon?: string;
  active?: boolean;
}

// ---------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------

/** Khớp theo tên Việt hoặc tên Anh, không phân biệt hoa thường và dấu (`query` đã chuẩn hoá). */
function roleMatches(role: RoleDto, query: string): boolean {
  return [role.nameVi, role.nameEn].some((text) => normalizeText(text).includes(query));
}

export function RolesTab() {
  const id = useId();
  const roles = useQuery({ queryKey: ALL_ROLES_KEY, queryFn: () => apiGet<RoleDto[]>('/api/roles?all=1') });
  const modes = useQuery({ queryKey: MODES_KEY, queryFn: () => apiGet<ModeDto[]>('/api/modes') });
  const [search, setSearch] = useState('');
  const query = normalizeText(search);

  return (
    <>
      <QueryState query={modes}>{(modeList) => <CreateRole modes={modeList} />}</QueryState>
      <QueryState query={roles}>
        {(list) => {
          const matching = query === '' ? list : list.filter((r) => roleMatches(r, query));
          const groups = [
            ...FACTIONS.map((faction) => ({ key: faction, label: FACTION_LABEL[faction], roles: matching.filter((r) => !isSpecialRole(r) && r.faction === faction) })),
            { key: 'special', label: SPECIAL_LABEL, roles: matching.filter(isSpecialRole) },
          ];
          // Đang tìm: chỉ hiện nhóm còn role; không tìm: hiện mọi nhóm, nhóm trống báo "Chưa có role nào".
          const shown = query === '' ? groups : groups.filter((group) => group.roles.length > 0);
          return (
            <>
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${id}-search`} className={LABEL_CLASS}>
                  Tìm role
                </label>
                <input
                  id={`${id}-search`}
                  type="search"
                  className="field"
                  placeholder="Tìm role…"
                  autoComplete="off"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {shown.length === 0 && (
                <EmptyState>
                  <p>{NO_MATCH_MESSAGE}</p>
                </EmptyState>
              )}
              {shown.map((group) => (
                <section key={group.key} className="flex flex-col gap-3">
                  <h2 className={H2_CLASS}>
                    {group.label} ({group.roles.length})
                  </h2>
                  {group.roles.length === 0 ? (
                    <EmptyState>
                      <p>Chưa có role nào</p>
                    </EmptyState>
                  ) : (
                    <ul className="goose-still grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {group.roles.map((role) => (
                        <li key={role.id} className="flex">
                          <RoleEditor role={role} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </>
          );
        }}
      </QueryState>
    </>
  );
}

// ---------------------------------------------------------------------------
// Thêm role
// ---------------------------------------------------------------------------

/** Thân `POST /api/admin/roles`; ba trường chỉ số phụ/phạt chỉ gửi khi có tick (bỏ = không có). */
interface CreateRoleBody extends Partial<ExtraMetricBody>, Partial<PenaltyMetricBody> {
  key: string;
  faction: Faction;
  nameVi: string;
  nameEn: string;
  metricLabel: string;
  maxPerGame: number;
  points: number;
  icon: string;
  description?: string;
  mapNote?: string;
  modeKey?: string;
}

interface CreateValues {
  key: string;
  faction: Faction;
  nameVi: string;
  nameEn: string;
  metricLabel: string;
  maxPerGame: string;
  points: string;
  icon: string;
  description: string;
  mapNote: string;
  /** Key chế độ chơi; rỗng = role thường của ba phe. */
  modeKey: string;
  extra: MetricValues;
  penalty: MetricValues;
}

type CreateTextField = Exclude<keyof CreateValues, 'faction' | 'maxPerGame' | 'points' | 'modeKey' | 'extra' | 'penalty'>;

const EMPTY_ROLE: CreateValues = {
  key: '',
  faction: 'goose',
  nameVi: '',
  nameEn: '',
  metricLabel: '',
  maxPerGame: '1',
  points: '1',
  icon: '',
  description: '',
  mapNote: '',
  modeKey: '',
  extra: METRIC_EMPTY,
  penalty: METRIC_EMPTY,
};

/** Các ô chữ của form thêm role: nhãn, bắt buộc hay không, độ dài tối đa (như service kiểm tra). */
const CREATE_TEXT_FIELDS: readonly { field: CreateTextField; label: string; required: boolean; max: number; hint?: string }[] = [
  { field: 'key', label: 'Key', required: true, max: 40, hint: 'Chữ thường, số và gạch dưới, bắt đầu bằng chữ (vd hunter_duck). Không đổi được sau khi tạo.' },
  { field: 'nameVi', label: 'Tên tiếng Việt', required: true, max: 60 },
  { field: 'nameEn', label: 'Tên tiếng Anh', required: true, max: 60 },
  { field: 'metricLabel', label: 'Tên chỉ số', required: true, max: 60, hint: 'Chỉ số người chơi khai, vd “Số mạng đã giết”.' },
  { field: 'icon', label: 'Biểu tượng', required: true, max: 8, hint: 'Một emoji.' },
  { field: 'description', label: 'Mô tả (không bắt buộc)', required: false, max: 300 },
  { field: 'mapNote', label: 'Ghi chú bản đồ (không bắt buộc)', required: false, max: 80 },
];

function CreateRole({ modes }: { modes: ModeDto[] }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [values, setValues] = useState<CreateValues>(EMPTY_ROLE);
  const [localError, setLocalError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: CreateRoleBody) => apiSend<RoleDto>('POST', '/api/admin/roles', body),
    onSuccess: () => {
      setValues(EMPTY_ROLE);
      void queryClient.invalidateQueries({ queryKey: ROLES_PREFIX });
      void queryClient.invalidateQueries({ queryKey: HALL_PREFIX });
    },
  });

  const update = (patch: Partial<CreateValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setLocalError(null);
    if (create.isError || create.isSuccess) create.reset();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    for (const { field, label, required } of CREATE_TEXT_FIELDS) {
      if (required && values[field].trim() === '') return setLocalError(`${label} không được để trống`);
    }
    const max = parseBounded(values.maxPerGame, MAX_PER_GAME_MIN, MAX_PER_GAME_MAX);
    if (max === null) return setLocalError(`Tối đa mỗi trận phải từ ${MAX_PER_GAME_MIN} đến ${MAX_PER_GAME_MAX}`);
    const points = parseBounded(values.points, POINTS_MIN, POINTS_MAX);
    if (points === null) return setLocalError(POINTS_ERROR);
    const extra = parseMetric(values.extra, EXTRA_TEXTS);
    if (extra.error !== null) return setLocalError(extra.error);
    const penalty = parseMetric(values.penalty, PENALTY_TEXTS);
    if (penalty.error !== null) return setLocalError(penalty.error);
    setLocalError(null);
    const description = values.description.trim();
    const mapNote = values.mapNote.trim();
    create.mutate({
      key: values.key.trim(),
      faction: values.faction,
      nameVi: values.nameVi.trim(),
      nameEn: values.nameEn.trim(),
      metricLabel: values.metricLabel.trim(),
      maxPerGame: max,
      points,
      icon: values.icon.trim(),
      ...(description !== '' ? { description } : {}),
      ...(mapNote !== '' ? { mapNote } : {}),
      ...(values.modeKey !== '' ? { modeKey: values.modeKey } : {}),
      // Role mới không tick thì không gửi ba trường (server hiểu là không có chỉ số phụ/phạt).
      ...(values.extra.enabled ? toExtraBody(extra.triple) : {}),
      ...(values.penalty.enabled ? toPenaltyBody(penalty.triple) : {}),
    });
  };

  const error = localError ?? (create.isError ? errorMessage(create.error) : null);

  return (
    <section className="panel flex flex-col gap-3">
      <h2 className={H2_CLASS}>Thêm role</h2>
      <p className={HINT_CLASS}>Khi game ra role mới. Role mới bật ngay và đứng cuối phe của nó; ảnh tải lên sau khi tạo.</p>
      <form noValidate aria-label="Thêm role" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CREATE_TEXT_FIELDS.map(({ field, label, max, hint }) => (
          <div key={field} className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${id}-${field}`} className={LABEL_CLASS}>
              {label}
            </label>
            <input
              id={`${id}-${field}`}
              type="text"
              maxLength={max}
              className="field"
              value={values[field]}
              aria-describedby={hint ? `${id}-${field}-hint` : undefined}
              onChange={(e) => update({ [field]: e.target.value })}
            />
            {hint && (
              <p id={`${id}-${field}-hint`} className={HINT_CLASS}>
                {hint}
              </p>
            )}
          </div>
        ))}
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-faction`} className={LABEL_CLASS}>
            Phe
          </label>
          <select id={`${id}-faction`} className="field" value={values.faction} onChange={(e) => update({ faction: e.target.value as Faction })}>
            {FACTIONS.map((faction) => (
              <option key={faction} value={faction}>
                {FACTION_LABEL[faction]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-max`} className={LABEL_CLASS}>
            Tối đa mỗi trận
          </label>
          <input
            id={`${id}-max`}
            type="number"
            inputMode="numeric"
            min={MAX_PER_GAME_MIN}
            max={MAX_PER_GAME_MAX}
            step={1}
            className="field"
            value={values.maxPerGame}
            onChange={(e) => update({ maxPerGame: e.target.value })}
          />
        </div>
        <PointsField id={`${id}-points`} value={values.points} onChange={(points) => update({ points })} />
        <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
          <label htmlFor={`${id}-mode`} className={LABEL_CLASS}>
            Chế độ đặc biệt (không bắt buộc)
          </label>
          <select
            id={`${id}-mode`}
            className="field"
            value={values.modeKey}
            aria-describedby={`${id}-mode-hint`}
            onChange={(e) => update({ modeKey: e.target.value })}
          >
            <option value="">— Không —</option>
            {modes.map((mode) => (
              <option key={mode.id} value={mode.key}>
                {mode.nameVi}
              </option>
            ))}
          </select>
          <p id={`${id}-mode-hint`} className={HINT_CLASS}>
            Chỉ chọn với role riêng của một chế độ chơi; role đó hiện trong nhóm “{SPECIAL_LABEL}”.
          </p>
        </div>
        <MetricFields id={`${id}-extra`} texts={EXTRA_TEXTS} values={values.extra} onChange={(extra) => update({ extra })} />
        <MetricFields id={`${id}-penalty`} texts={PENALTY_TEXTS} values={values.penalty} onChange={(penalty) => update({ penalty })} />
        <div className="flex flex-col gap-1 sm:col-span-2">
          <button type="submit" className="btn-primary self-start" disabled={create.isPending}>
            {create.isPending ? 'Đang thêm…' : 'Thêm role'}
          </button>
          {error && (
            <p role="alert" className={ERROR_CLASS}>
              {error}
            </p>
          )}
          <p role="status" aria-live="polite" className={STATUS_CLASS}>
            {create.isSuccess && `Đã thêm “${create.data.nameVi}”`}
          </p>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ô dùng chung cho form thêm và form sửa
// ---------------------------------------------------------------------------

/** Ô "Điểm mỗi lần" của chỉ số chính (`points`, 1–100), kèm gợi ý. */
function PointsField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        Điểm mỗi lần
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={POINTS_MIN}
        max={POINTS_MAX}
        step={1}
        className="field"
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-hint`} className={HINT_CLASS}>
        Điểm cộng cho mỗi đơn vị chỉ số chính.
      </p>
    </div>
  );
}

interface MetricFieldsProps {
  id: string;
  texts: MetricTexts;
  values: MetricValues;
  onChange: (values: MetricValues) => void;
}

/**
 * Ô tick ("Có chỉ số phụ" / "Có điểm trừ") và, khi tick, ba ô: tên, "Tối đa mỗi trận", điểm.
 * Là một `fieldset` mà legend chính là ô tick: "Tối đa mỗi trận" ở đây trùng chữ với ô của chỉ số
 * chính (và "Điểm mỗi lần" của chỉ số phụ trùng với ô `points`), nên nhóm mang tên ô tick để trình
 * đọc màn hình (và test) phân biệt được. `min-w-0` vì `fieldset` mặc định không co dưới
 * `min-content`, dễ tràn ngang ở 320px.
 */
function MetricFields({ id, texts, values, onChange }: MetricFieldsProps) {
  const set = (patch: Partial<MetricValues>) => onChange({ ...values, ...patch });
  return (
    <fieldset className="flex min-w-0 flex-col sm:col-span-2">
      <legend className="flex">
        <Checkbox id={`${id}-toggle`} checked={values.enabled} onChange={(e) => set({ enabled: e.target.checked })}>
          <span className={LABEL_CLASS}>{texts.toggle}</span>
        </Checkbox>
      </legend>
      {values.enabled && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${id}-label`} className={LABEL_CLASS}>
              {texts.labelField}
            </label>
            <input
              id={`${id}-label`}
              type="text"
              maxLength={METRIC_LABEL_MAX}
              className="field"
              value={values.label}
              aria-describedby={`${id}-label-hint`}
              onChange={(e) => set({ label: e.target.value })}
            />
            <p id={`${id}-label-hint`} className={HINT_CLASS}>
              {texts.labelHint}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${id}-max`} className={LABEL_CLASS}>
              Tối đa mỗi trận
            </label>
            <input
              id={`${id}-max`}
              type="number"
              inputMode="numeric"
              min={METRIC_MIN}
              max={METRIC_MAX}
              step={1}
              className="field"
              value={values.max}
              onChange={(e) => set({ max: e.target.value })}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${id}-points`} className={LABEL_CLASS}>
              {texts.pointsField}
            </label>
            <input
              id={`${id}-points`}
              type="number"
              inputMode="numeric"
              min={METRIC_MIN}
              max={METRIC_MAX}
              step={1}
              className="field"
              value={values.points}
              aria-describedby={`${id}-points-hint`}
              onChange={(e) => set({ points: e.target.value })}
            />
            <p id={`${id}-points-hint`} className={HINT_CLASS}>
              {texts.pointsHint}
            </p>
          </div>
        </div>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Một role
// ---------------------------------------------------------------------------

function RoleEditor({ role }: { role: RoleDto }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [faction, setFaction] = useState<Faction>(role.faction);
  const [nameVi, setNameVi] = useState(role.nameVi);
  const [metricLabel, setMetricLabel] = useState(role.metricLabel);
  const [maxPerGame, setMaxPerGame] = useState(String(role.maxPerGame));
  const [points, setPoints] = useState(String(role.points));
  const [icon, setIcon] = useState(role.icon);
  const [extra, setExtra] = useState<MetricValues>(() => metricValuesOf(extraOf(role)));
  const [penalty, setPenalty] = useState<MetricValues>(() => metricValuesOf(penaltyOf(role)));
  const [active, setActive] = useState(role.active);
  const [localError, setLocalError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  /** Đổi sau mỗi lần tải ảnh để trình duyệt không dùng bản cache (max-age 5 phút). */
  const [imageVersion, setImageVersion] = useState(0);

  const refreshRoleViews = () => {
    void queryClient.invalidateQueries({ queryKey: ROLES_PREFIX });
    void queryClient.invalidateQueries({ queryKey: HALL_PREFIX });
  };

  const save = useMutation({
    mutationFn: (patch: RolePatch) => apiSend<RoleDto>('PATCH', `/api/admin/roles/${role.id}`, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<RoleDto[]>(ALL_ROLES_KEY, (current) => current?.map((item) => (item.id === updated.id ? updated : item)));
      void queryClient.invalidateQueries({ queryKey: ROLES_PREFIX, exact: true });
      void queryClient.invalidateQueries({ queryKey: HALL_PREFIX });
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => apiPutBlob(`/api/admin/roles/${role.id}/image`, file),
    onSuccess: () => {
      setImageVersion((v) => v + 1);
      refreshRoleViews();
    },
  });

  const remove = useMutation({
    mutationFn: () => apiSend<undefined>('DELETE', `/api/admin/roles/${role.id}/image`),
    onSuccess: refreshRoleViews,
  });

  const touch = () => {
    setLocalError(null);
    if (save.isError || save.isSuccess) save.reset();
  };

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (nameVi.trim() === '') return setLocalError('Tên tiếng Việt không được để trống');
    if (metricLabel.trim() === '') return setLocalError('Tên chỉ số không được để trống');
    if (icon.trim() === '') return setLocalError('Biểu tượng không được để trống');
    const max = parseBounded(maxPerGame, MAX_PER_GAME_MIN, MAX_PER_GAME_MAX);
    if (max === null) return setLocalError(`Tối đa mỗi trận phải từ ${MAX_PER_GAME_MIN} đến ${MAX_PER_GAME_MAX}`);
    const pointsValue = parseBounded(points, POINTS_MIN, POINTS_MAX);
    if (pointsValue === null) return setLocalError(POINTS_ERROR);
    const extraParsed = parseMetric(extra, EXTRA_TEXTS);
    if (extraParsed.error !== null) return setLocalError(extraParsed.error);
    const penaltyParsed = parseMetric(penalty, PENALTY_TEXTS);
    if (penaltyParsed.error !== null) return setLocalError(penaltyParsed.error);
    setLocalError(null);

    const patch: RolePatch = {};
    if (faction !== role.faction) patch.faction = faction;
    if (nameVi.trim() !== role.nameVi) patch.nameVi = nameVi.trim();
    if (metricLabel.trim() !== role.metricLabel) patch.metricLabel = metricLabel.trim();
    if (max !== role.maxPerGame) patch.maxPerGame = max;
    if (pointsValue !== role.points) patch.points = pointsValue;
    if (icon.trim() !== role.icon) patch.icon = icon.trim();
    // Server cần đủ cả ba trường phụ/phạt (hoặc null cả ba): đổi một là gửi cả ba.
    if (tripleChanged(extraParsed.triple, extraOf(role))) Object.assign(patch, toExtraBody(extraParsed.triple));
    if (tripleChanged(penaltyParsed.triple, penaltyOf(role))) Object.assign(patch, toPenaltyBody(penaltyParsed.triple));
    if (active !== role.active) patch.active = active;
    save.mutate(patch);
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // chọn lại cùng tệp vẫn kích hoạt onChange
    if (!file) return;
    if (!IMAGE_TYPES.has(file.type) || file.size > IMAGE_MAX_BYTES) {
      setImageError(INVALID_IMAGE);
      return;
    }
    setImageError(null);
    upload.mutate(file);
  };

  const onRemoveImage = () => {
    if (window.confirm(`Xoá ảnh của ${role.nameVi}? Nhân vật sẽ về dáng vẽ mặc định.`)) {
      setImageError(null);
      remove.mutate();
    }
  };

  const busy = upload.isPending || remove.isPending;
  const imageMessage = imageError ?? (upload.isError ? errorMessage(upload.error) : remove.isError ? errorMessage(remove.error) : null);
  const error = localError ?? (save.isError ? errorMessage(save.error) : null);

  return (
    <section aria-labelledby={`${id}-title`} className="panel flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={`${id}-title`} className="text-lg leading-tight font-extrabold text-white">
          {role.nameVi} ({role.nameEn})
        </h3>
        {!role.active && <Chip tone="duck">Đã tắt</Chip>}
        {role.modeKey && <Chip tone="third">{role.modeKey}</Chip>}
      </div>

      {/*
       * Hình: ảnh đã tải (giữ `<img>` riêng vì cần `?v=` chống cache và alt "Ảnh …") hoặc nhân
       * vật vẽ theo bộ đồ của role — không bảng tên, đứng yên nhờ `goose-still` ở danh sách.
       */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="panel-inset flex h-24 w-18 shrink-0 items-center justify-center p-1">
          {role.hasImage ? (
            <img src={`/api/roles/${role.id}/image?v=${imageVersion}`} alt={`Ảnh ${role.nameVi}`} className="h-full w-full object-contain object-bottom" />
          ) : (
            <Character role={role} holderName="" variant="current" size={FIGURE_SIZE} nameplate={false} />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-image`} className={LABEL_CLASS}>
            Tải ảnh (PNG, JPG hoặc WebP, tối đa 1 MB)
          </label>
          <input
            id={`${id}-image`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="text-sm text-night-300 file:mr-3 file:rounded-lg file:border-2 file:border-night-950 file:bg-night-700 file:px-3 file:py-1 file:font-bold file:text-white"
            disabled={busy}
            onChange={onFile}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {role.hasImage && (
              <button type="button" className="btn-danger px-3 py-1 text-sm" disabled={busy} onClick={onRemoveImage}>
                {remove.isPending ? 'Đang xoá…' : 'Xoá ảnh'}
              </button>
            )}
            {upload.isPending && <span className="text-night-300">Đang tải ảnh…</span>}
            {upload.isSuccess && !imageMessage && <span className="font-bold text-ok">Đã tải ảnh</span>}
          </div>
          {imageMessage && (
            <p role="alert" className={ERROR_CLASS}>
              {imageMessage}
            </p>
          )}
        </div>
      </div>

      {/* Thuộc tính */}
      <form noValidate onSubmit={onSave} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor={`${id}-faction`} className={LABEL_CLASS}>
            Phe
          </label>
          <select id={`${id}-faction`} className="field" value={faction} onChange={(e) => (setFaction(e.target.value as Faction), touch())}>
            {FACTIONS.map((value) => (
              <option key={value} value={value}>
                {FACTION_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-nameVi`} className={LABEL_CLASS}>
            Tên tiếng Việt
          </label>
          <input id={`${id}-nameVi`} type="text" className="field" value={nameVi} onChange={(e) => (setNameVi(e.target.value), touch())} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-metric`} className={LABEL_CLASS}>
            Tên chỉ số
          </label>
          <input id={`${id}-metric`} type="text" className="field" value={metricLabel} onChange={(e) => (setMetricLabel(e.target.value), touch())} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-max`} className={LABEL_CLASS}>
            Tối đa mỗi trận
          </label>
          <input
            id={`${id}-max`}
            type="number"
            inputMode="numeric"
            min={MAX_PER_GAME_MIN}
            max={MAX_PER_GAME_MAX}
            step={1}
            className="field"
            value={maxPerGame}
            onChange={(e) => (setMaxPerGame(e.target.value), touch())}
          />
        </div>
        <PointsField id={`${id}-points`} value={points} onChange={(next) => (setPoints(next), touch())} />
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-icon`} className={LABEL_CLASS}>
            Biểu tượng
          </label>
          <input id={`${id}-icon`} type="text" className="field" value={icon} onChange={(e) => (setIcon(e.target.value), touch())} />
        </div>
        <MetricFields id={`${id}-extra`} texts={EXTRA_TEXTS} values={extra} onChange={(next) => (setExtra(next), touch())} />
        <MetricFields id={`${id}-penalty`} texts={PENALTY_TEXTS} values={penalty} onChange={(next) => (setPenalty(next), touch())} />
        <Checkbox id={`${id}-active`} checked={active} onChange={(e) => (setActive(e.target.checked), touch())} className="sm:col-span-2">
          <span className={LABEL_CLASS}>Đang bật</span>
        </Checkbox>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <button type="submit" className="btn-primary self-start" disabled={save.isPending}>
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          {error && (
            <p role="alert" className={ERROR_CLASS}>
              {error}
            </p>
          )}
          <p role="status" aria-live="polite" className={STATUS_CLASS}>
            {save.isSuccess && 'Đã lưu'}
          </p>
        </div>
      </form>
    </section>
  );
}
