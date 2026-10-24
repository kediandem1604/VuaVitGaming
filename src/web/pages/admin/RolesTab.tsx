/**
 * Tab Role (spec §4.6, chỉ admin): form "Thêm role" (khi game cập nhật; `POST
 * /api/admin/roles`, lỗi của server như "Key đã tồn tại" hiện nguyên văn), rồi mọi role
 * kể cả đã tắt (`/api/roles?all=1`, khoá `['roles','all']` — khác `['roles']` của bảng
 * xếp hạng), nhóm theo phe và nhóm "Chế độ đặc biệt" như Đại sảnh. Mỗi role sửa được
 * phe, tên Việt, tên chỉ số, tối đa mỗi trận, biểu tượng, bật/tắt (PATCH chỉ các trường
 * đã đổi); tải ảnh PNG/JPG/WebP ≤ 1 MB (kiểm tra tại chỗ rồi `PUT` body thô) và xoá
 * ảnh. Thêm role, đổi phe hay đổi ảnh thì mọi nơi vẽ nhân vật (Đại sảnh, xếp hạng) được
 * tải lại.
 *
 * Giao diện Sảnh đêm (spec §6 Quản trị): mỗi role một `panel`; role chưa có ảnh hiện nhân
 * vật vẽ theo bộ đồ (`Character`, không bảng tên) đứng yên — lớp `goose-still` trên danh
 * sách tắt nhún/chớp vì bảng quản trị ưu tiên dễ đọc; Xoá ảnh là `btn-danger`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Faction, ModeDto, RoleDto } from '../../../shared/api-types';
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

const H2_CLASS = 'text-xl leading-tight font-extrabold text-white';
const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';
const STATUS_CLASS = 'min-h-5 text-sm font-bold text-ok';
/** Bề rộng nhân vật trong ô hình (px) — ô `w-18` trừ viền và đệm của `panel-inset`. */
const FIGURE_SIZE = 60;

interface RolePatch {
  faction?: Faction;
  nameVi?: string;
  metricLabel?: string;
  maxPerGame?: number;
  icon?: string;
  active?: boolean;
}

export function RolesTab() {
  const roles = useQuery({ queryKey: ALL_ROLES_KEY, queryFn: () => apiGet<RoleDto[]>('/api/roles?all=1') });
  const modes = useQuery({ queryKey: MODES_KEY, queryFn: () => apiGet<ModeDto[]>('/api/modes') });

  return (
    <>
      <QueryState query={modes}>{(modeList) => <CreateRole modes={modeList} />}</QueryState>
      <QueryState query={roles}>
        {(list) => {
          const groups = [
            ...FACTIONS.map((faction) => ({ key: faction, label: FACTION_LABEL[faction], roles: list.filter((r) => !isSpecialRole(r) && r.faction === faction) })),
            { key: 'special', label: SPECIAL_LABEL, roles: list.filter(isSpecialRole) },
          ];
          return (
            <>
              {groups.map((group) => (
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

interface CreateRoleBody {
  key: string;
  faction: Faction;
  nameVi: string;
  nameEn: string;
  metricLabel: string;
  maxPerGame: number;
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
  icon: string;
  description: string;
  mapNote: string;
  /** Key chế độ chơi; rỗng = role thường của ba phe. */
  modeKey: string;
}

type CreateTextField = Exclude<keyof CreateValues, 'faction' | 'maxPerGame' | 'modeKey'>;

const EMPTY_ROLE: CreateValues = {
  key: '',
  faction: 'goose',
  nameVi: '',
  nameEn: '',
  metricLabel: '',
  maxPerGame: '1',
  icon: '',
  description: '',
  mapNote: '',
  modeKey: '',
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
    const max = Number(values.maxPerGame);
    if (values.maxPerGame.trim() === '' || !Number.isInteger(max) || max < MAX_PER_GAME_MIN || max > MAX_PER_GAME_MAX) {
      return setLocalError(`Tối đa mỗi trận phải từ ${MAX_PER_GAME_MIN} đến ${MAX_PER_GAME_MAX}`);
    }
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
      icon: values.icon.trim(),
      ...(description !== '' ? { description } : {}),
      ...(mapNote !== '' ? { mapNote } : {}),
      ...(values.modeKey !== '' ? { modeKey: values.modeKey } : {}),
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
// Một role
// ---------------------------------------------------------------------------

function RoleEditor({ role }: { role: RoleDto }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [faction, setFaction] = useState<Faction>(role.faction);
  const [nameVi, setNameVi] = useState(role.nameVi);
  const [metricLabel, setMetricLabel] = useState(role.metricLabel);
  const [maxPerGame, setMaxPerGame] = useState(String(role.maxPerGame));
  const [icon, setIcon] = useState(role.icon);
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
    const max = Number(maxPerGame);
    if (nameVi.trim() === '') return setLocalError('Tên tiếng Việt không được để trống');
    if (metricLabel.trim() === '') return setLocalError('Tên chỉ số không được để trống');
    if (icon.trim() === '') return setLocalError('Biểu tượng không được để trống');
    if (!Number.isInteger(max) || max < MAX_PER_GAME_MIN || max > MAX_PER_GAME_MAX) {
      return setLocalError(`Tối đa mỗi trận phải từ ${MAX_PER_GAME_MIN} đến ${MAX_PER_GAME_MAX}`);
    }
    setLocalError(null);

    const patch: RolePatch = {};
    if (faction !== role.faction) patch.faction = faction;
    if (nameVi.trim() !== role.nameVi) patch.nameVi = nameVi.trim();
    if (metricLabel.trim() !== role.metricLabel) patch.metricLabel = metricLabel.trim();
    if (max !== role.maxPerGame) patch.maxPerGame = max;
    if (icon.trim() !== role.icon) patch.icon = icon.trim();
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
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-icon`} className={LABEL_CLASS}>
            Biểu tượng
          </label>
          <input id={`${id}-icon`} type="text" className="field" value={icon} onChange={(e) => (setIcon(e.target.value), touch())} />
        </div>
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
