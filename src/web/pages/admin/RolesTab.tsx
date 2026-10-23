/**
 * Tab Role (spec §4.6, chỉ admin): mọi role kể cả đã tắt (`/api/roles?all=1`, khoá
 * `['roles','all']` — khác `['roles']` của bảng xếp hạng), nhóm theo phe và nhóm
 * "Chế độ đặc biệt" như Đại sảnh. Mỗi role sửa được tên Việt, tên chỉ số, tối đa mỗi
 * trận, biểu tượng, bật/tắt (PATCH chỉ các trường đã đổi); tải ảnh PNG/JPG/WebP ≤ 1 MB
 * (kiểm tra tại chỗ rồi `PUT` body thô) và xoá ảnh. Ảnh đổi thì mọi nơi vẽ nhân vật
 * (Đại sảnh, xếp hạng) được tải lại.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import type { RoleDto } from '../../../shared/api-types';
import { apiGet, apiPutBlob, apiSend, errorMessage } from '../../api';
import { QueryState } from '../../components/QueryState';
import { FACTIONS, FACTION_LABEL, isSpecialRole, SPECIAL_LABEL } from '../../lib/factions';
import { Chip } from './Chip';

const ALL_ROLES_KEY = ['roles', 'all'] as const;
/** Mọi khoá role (`['roles']`, `['roles','all']`) và Đại sảnh — nơi vẽ nhân vật/ảnh. */
const ROLES_PREFIX = ['roles'] as const;
const HALL_PREFIX = ['hall'] as const;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_MAX_BYTES = 1_048_576;
const INVALID_IMAGE = 'Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB';
const MAX_PER_GAME_MIN = 1;
const MAX_PER_GAME_MAX = 100;

interface RolePatch {
  nameVi?: string;
  metricLabel?: string;
  maxPerGame?: number;
  icon?: string;
  active?: boolean;
}

export function RolesTab() {
  const roles = useQuery({ queryKey: ALL_ROLES_KEY, queryFn: () => apiGet<RoleDto[]>('/api/roles?all=1') });

  return (
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
  );
}

// ---------------------------------------------------------------------------
// Một role
// ---------------------------------------------------------------------------

function RoleEditor({ role }: { role: RoleDto }) {
  const queryClient = useQueryClient();
  const id = useId();
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
