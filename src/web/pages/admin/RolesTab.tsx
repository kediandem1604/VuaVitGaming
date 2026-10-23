/**
 * Tab Role (spec §4.6, chỉ admin): form "Thêm role" (khi game cập nhật; `POST
 * /api/admin/roles`, lỗi của server như "Key đã tồn tại" hiện nguyên văn), rồi mọi role
 * kể cả đã tắt (`/api/roles?all=1`, khoá `['roles','all']` — khác `['roles']` của bảng
 * xếp hạng), nhóm theo phe và nhóm "Chế độ đặc biệt" như Đại sảnh. Mỗi role sửa được
 * phe, tên Việt, tên chỉ số, tối đa mỗi trận, biểu tượng, bật/tắt (PATCH chỉ các trường
 * đã đổi); tải ảnh PNG/JPG/WebP ≤ 1 MB (kiểm tra tại chỗ rồi `PUT` body thô) và xoá
 * ảnh. Thêm role, đổi phe hay đổi ảnh thì mọi nơi vẽ nhân vật (Đại sảnh, xếp hạng) được
 * tải lại.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Faction, ModeDto, RoleDto } from '../../../shared/api-types';
import { apiGet, apiPutBlob, apiSend, errorMessage } from '../../api';
import { QueryState } from '../../components/QueryState';
import { FACTIONS, FACTION_LABEL, isSpecialRole, SPECIAL_LABEL } from '../../lib/factions';
import { Chip } from './Chip';

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
                  <h2 className="text-lg font-semibold">
                    {group.label} ({group.roles.length})
                  </h2>
                  {group.roles.length === 0 ? (
                    <p className="text-slate-600 dark:text-slate-400">Chưa có role nào</p>
                  ) : (
                    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Thêm role</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Khi game ra role mới. Role mới bật ngay và đứng cuối phe của nó; ảnh tải lên sau khi tạo.
      </p>
      <form noValidate aria-label="Thêm role" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CREATE_TEXT_FIELDS.map(({ field, label, max, hint }) => (
          <div key={field} className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${id}-${field}`} className="text-sm font-medium">
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
              <p id={`${id}-${field}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
                {hint}
              </p>
            )}
          </div>
        ))}
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-faction`} className="text-sm font-medium">
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
          <label htmlFor={`${id}-max`} className="text-sm font-medium">
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
          <label htmlFor={`${id}-mode`} className="text-sm font-medium">
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
          <p id={`${id}-mode-hint`} className="text-xs text-slate-500 dark:text-slate-400">
            Chỉ chọn với role riêng của một chế độ chơi; role đó hiện trong nhóm “{SPECIAL_LABEL}”.
          </p>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <button type="submit" className="btn-primary self-start" disabled={create.isPending}>
            {create.isPending ? 'Đang thêm…' : 'Thêm role'}
          </button>
          {error && (
            <p role="alert" className="text-sm text-duck">
              {error}
            </p>
          )}
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-goose">
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
    <section aria-labelledby={`${id}-title`} className="card flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={`${id}-title`} className="font-semibold">
          {role.nameVi} ({role.nameEn})
        </h3>
        {!role.active && <Chip tone="duck">Đã tắt</Chip>}
        {role.modeKey && <Chip tone="third">{role.modeKey}</Chip>}
      </div>

      {/* Ảnh */}
      <div className="flex flex-wrap items-center gap-3">
        {role.hasImage ? (
          <img
            src={`/api/roles/${role.id}/image?v=${imageVersion}`}
            alt={`Ảnh ${role.nameVi}`}
            className="h-20 w-16 shrink-0 rounded-lg bg-slate-100 object-contain dark:bg-slate-800"
          />
        ) : (
          <span aria-hidden="true" className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-3xl dark:bg-slate-800">
            {role.icon}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-image`} className="text-sm font-medium">
            Tải ảnh (PNG, JPG hoặc WebP, tối đa 1 MB)
          </label>
          <input id={`${id}-image`} type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" disabled={busy} onChange={onFile} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {role.hasImage && (
              <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={onRemoveImage}>
                {remove.isPending ? 'Đang xoá…' : 'Xoá ảnh'}
              </button>
            )}
            {upload.isPending && <span className="text-slate-500">Đang tải ảnh…</span>}
            {upload.isSuccess && !imageMessage && <span className="text-goose">Đã tải ảnh</span>}
          </div>
          {imageMessage && (
            <p role="alert" className="text-sm text-duck">
              {imageMessage}
            </p>
          )}
        </div>
      </div>

      {/* Thuộc tính */}
      <form noValidate onSubmit={onSave} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor={`${id}-faction`} className="text-sm font-medium">
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
          <label htmlFor={`${id}-nameVi`} className="text-sm font-medium">
            Tên tiếng Việt
          </label>
          <input id={`${id}-nameVi`} type="text" className="field" value={nameVi} onChange={(e) => (setNameVi(e.target.value), touch())} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-metric`} className="text-sm font-medium">
            Tên chỉ số
          </label>
          <input id={`${id}-metric`} type="text" className="field" value={metricLabel} onChange={(e) => (setMetricLabel(e.target.value), touch())} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-max`} className="text-sm font-medium">
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
          <label htmlFor={`${id}-icon`} className="text-sm font-medium">
            Biểu tượng
          </label>
          <input id={`${id}-icon`} type="text" className="field" value={icon} onChange={(e) => (setIcon(e.target.value), touch())} />
        </div>
        <label htmlFor={`${id}-active`} className="flex items-center gap-2 text-sm sm:col-span-2">
          <input id={`${id}-active`} type="checkbox" className="size-4 accent-goose" checked={active} onChange={(e) => (setActive(e.target.checked), touch())} />
          Đang bật
        </label>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <button type="submit" className="btn-primary self-start" disabled={save.isPending}>
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          {error && (
            <p role="alert" className="text-sm text-duck">
              {error}
            </p>
          )}
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-goose">
            {save.isSuccess && 'Đã lưu'}
          </p>
        </div>
      </form>
    </section>
  );
}
