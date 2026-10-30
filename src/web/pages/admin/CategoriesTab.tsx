/**
 * Tab Hạng mục MVP (spec §4.5, chỉ admin): danh sách kể cả hạng mục đã ẩn, công tắc
 * bật/ẩn, form thêm và form sửa dùng chung. Phạm vi `mode` cần chế độ chơi; khi đổi
 * phạm vi khỏi `mode`, PATCH gửi kèm `modeId: null` trong cùng một yêu cầu (service
 * kiểm tra quy tắc phạm vi ⇔ chế độ trên dòng đã gộp). Ô "Tính cho danh hiệu" (spec huy
 * hiệu §4: Khen / Vui / Không tính) gửi `badgeGroup` ở cả thêm và sửa; hàng ghi nhóm đang
 * tính bằng chip (không ghi khi "Không tính").
 *
 * Giao diện Sảnh đêm (spec §6 Quản trị): form thêm trong `panel`; danh sách kiểu bảng
 * (một panel, hàng kẻ `night-700`, chữ 14px) với công tắc `Switch` ở cuối mỗi hàng.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { AwardCategoryDto, BadgeGroupDto, CategoryScope, ModeDto } from '../../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { QueryState } from '../../components/QueryState';
import { cx } from '../../lib/cx';
import { Chip } from './Chip';
import { Switch } from './Controls';

const CATEGORIES_KEY = ['admin', 'categories'] as const;
const MODES_KEY = ['modes'] as const;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 200;

const SCOPE_LABEL: Record<CategoryScope, string> = { always: 'Luôn có', mode: 'Theo chế độ', optional: 'Tuỳ chọn' };
const SCOPES: readonly CategoryScope[] = ['always', 'mode', 'optional'];

/** Nhóm danh hiệu của hạng mục: Khen → SMVP, Vui → Vua tấu hài, Không tính → không vào danh hiệu nào. */
const BADGE_GROUP_LABEL: Record<BadgeGroupDto, string> = { mvp: 'Khen', fun: 'Vui', none: 'Không tính' };
const BADGE_GROUPS: readonly BadgeGroupDto[] = ['mvp', 'fun', 'none'];
const BADGE_GROUP_HINT = 'Khen tính cho SMVP và các cột mốc MVP; Vui tính cho Vua tấu hài.';

const H2_CLASS = 'text-xl leading-tight font-extrabold text-white';
const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';

interface CategoryValues {
  name: string;
  description: string;
  scope: CategoryScope;
  /** Id chế độ dạng chuỗi của `<select>`; rỗng = chưa chọn. */
  modeId: string;
  badgeGroup: BadgeGroupDto;
}

interface CreateBody {
  scope: CategoryScope;
  modeId?: number;
  name: string;
  description?: string;
  badgeGroup: BadgeGroupDto;
}

interface PatchBody {
  scope: CategoryScope;
  modeId: number | null;
  name: string;
  description: string | null;
  badgeGroup: BadgeGroupDto;
}

function scopeText(category: AwardCategoryDto): string {
  return category.scope === 'mode' ? `${SCOPE_LABEL.mode}: ${category.mode?.nameVi ?? '?'}` : SCOPE_LABEL[category.scope];
}

export function CategoriesTab() {
  const categories = useQuery({ queryKey: CATEGORIES_KEY, queryFn: () => apiGet<AwardCategoryDto[]>('/api/admin/categories?all=1') });
  const modes = useQuery({ queryKey: MODES_KEY, queryFn: () => apiGet<ModeDto[]>('/api/modes') });

  return (
    <>
      <QueryState query={modes}>{(modeList) => <CreateCategory modes={modeList} />}</QueryState>
      <section className="flex flex-col gap-3">
        <h2 className={H2_CLASS}>Hạng mục</h2>
        <QueryState query={categories}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>
                <p>Chưa có hạng mục nào</p>
              </EmptyState>
            ) : (
              <ul className="panel flex flex-col divide-y divide-night-700 p-0">
                {list.map((category) => (
                  <CategoryRow key={category.id} category={category} modes={modes.data ?? []} />
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

function CreateCategory({ modes }: { modes: ModeDto[] }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (body: CreateBody) => apiSend<AwardCategoryDto>('POST', '/api/admin/categories', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  });

  return (
    <section className="panel flex flex-col gap-3">
      <h2 className={H2_CLASS}>Thêm hạng mục</h2>
      {/* `key` theo hạng mục vừa tạo: thêm xong thì form dựng lại trống. */}
      <CategoryForm
        key={create.data?.id ?? 'new'}
        formLabel="Thêm hạng mục"
        modes={modes}
        initial={{ name: '', description: '', scope: 'always', modeId: '', badgeGroup: 'none' }}
        submitLabel="Thêm hạng mục"
        pending={create.isPending}
        error={create.isError ? errorMessage(create.error) : null}
        success={create.isSuccess ? `Đã thêm “${create.data.name}”` : null}
        onChange={() => {
          if (create.isError || create.isSuccess) create.reset();
        }}
        onSubmit={(values) => {
          const description = values.description.trim();
          create.mutate({
            scope: values.scope,
            ...(values.scope === 'mode' ? { modeId: Number(values.modeId) } : {}),
            name: values.name.trim(),
            ...(description !== '' ? { description } : {}),
            badgeGroup: values.badgeGroup,
          });
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Một hạng mục: công tắc bật/ẩn, sửa
// ---------------------------------------------------------------------------

function CategoryRow({ category, modes }: { category: AwardCategoryDto; modes: ModeDto[] }) {
  const queryClient = useQueryClient();
  const switchId = useId();
  const [editing, setEditing] = useState(false);

  const patch = useMutation({
    mutationFn: (body: PatchBody | { active: boolean }) => apiSend<AwardCategoryDto>('PATCH', `/api/admin/categories/${category.id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<AwardCategoryDto[]>(CATEGORIES_KEY, (current) => current?.map((item) => (item.id === updated.id ? updated : item)));
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      setEditing(false);
    },
  });

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-bold text-white">{category.name}</span>
        <Chip tone={category.scope === 'mode' ? 'goose' : category.scope === 'optional' ? 'third' : 'neutral'}>{scopeText(category)}</Chip>
        {category.badgeGroup !== 'none' && <Chip>Danh hiệu: {BADGE_GROUP_LABEL[category.badgeGroup]}</Chip>}
        {!category.active && <Chip tone="duck">Đã ẩn</Chip>}
        <Switch
          id={switchId}
          checked={category.active}
          disabled={patch.isPending}
          onChange={(event) => patch.mutate({ active: event.target.checked })}
          className="ml-auto"
        >
          Đang bật
        </Switch>
      </div>
      {category.description && !editing && <p className="text-night-200">{category.description}</p>}

      {editing ? (
        <CategoryForm
          formLabel={`Sửa hạng mục ${category.name}`}
          modes={modes}
          initial={{
            name: category.name,
            description: category.description ?? '',
            scope: category.scope,
            modeId: category.mode ? String(category.mode.id) : '',
            badgeGroup: category.badgeGroup,
          }}
          submitLabel="Lưu"
          pending={patch.isPending}
          error={patch.isError ? errorMessage(patch.error) : null}
          success={null}
          onCancel={() => setEditing(false)}
          onChange={() => {
            if (patch.isError) patch.reset();
          }}
          onSubmit={(values) => {
            const description = values.description.trim();
            patch.mutate({
              scope: values.scope,
              // Khác `mode` thì phải gửi `modeId: null` cùng lúc, nếu không service từ chối dòng đã gộp.
              modeId: values.scope === 'mode' ? Number(values.modeId) : null,
              name: values.name.trim(),
              description: description === '' ? null : description,
              badgeGroup: values.badgeGroup,
            });
          }}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <button type="button" className="btn-secondary self-start" onClick={() => setEditing(true)}>
            Sửa
          </button>
          {patch.isError && (
            <p role="alert" className={ERROR_CLASS}>
              {errorMessage(patch.error)}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Form dùng chung cho thêm và sửa
// ---------------------------------------------------------------------------

interface CategoryFormProps {
  formLabel: string;
  modes: ModeDto[];
  initial: CategoryValues;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  success: string | null;
  onChange: () => void;
  onSubmit: (values: CategoryValues) => void;
  onCancel?: () => void;
}

function CategoryForm({ formLabel, modes, initial, submitLabel, pending, error, success, onChange, onSubmit, onCancel }: CategoryFormProps) {
  const id = useId();
  const [values, setValues] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);

  const update = (patch: Partial<CategoryValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setLocalError(null);
    onChange();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (values.name.trim() === '') return setLocalError('Tên hạng mục không được để trống');
    if (values.scope === 'mode' && values.modeId === '') return setLocalError('Hãy chọn chế độ chơi');
    setLocalError(null);
    onSubmit(values);
  };

  const shownError = localError ?? error;

  return (
    <form noValidate aria-label={formLabel} onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={`${id}-name`} className={LABEL_CLASS}>
          Tên hạng mục
        </label>
        <input id={`${id}-name`} type="text" maxLength={NAME_MAX} className="field" value={values.name} onChange={(e) => update({ name: e.target.value })} />
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
        <input
          id={`${id}-description`}
          type="text"
          maxLength={DESCRIPTION_MAX}
          className="field"
          value={values.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-scope`} className={LABEL_CLASS}>
          Phạm vi
        </label>
        <select id={`${id}-scope`} className="field" value={values.scope} onChange={(e) => update({ scope: e.target.value as CategoryScope })}>
          {SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {SCOPE_LABEL[scope]}
            </option>
          ))}
        </select>
      </div>
      {values.scope === 'mode' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-mode`} className={LABEL_CLASS}>
            Chế độ chơi
          </label>
          <select id={`${id}-mode`} className="field" value={values.modeId} onChange={(e) => update({ modeId: e.target.value })}>
            <option value="">— Chọn chế độ —</option>
            {modes.map((mode) => (
              <option key={mode.id} value={String(mode.id)}>
                {mode.nameVi}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-badge-group`} className={LABEL_CLASS}>
          Tính cho danh hiệu
        </label>
        <select
          id={`${id}-badge-group`}
          className="field"
          value={values.badgeGroup}
          onChange={(e) => update({ badgeGroup: e.target.value as BadgeGroupDto })}
        >
          {BADGE_GROUPS.map((group) => (
            <option key={group} value={group}>
              {BADGE_GROUP_LABEL[group]}
            </option>
          ))}
        </select>
        <p className={HINT_CLASS}>{BADGE_GROUP_HINT}</p>
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
