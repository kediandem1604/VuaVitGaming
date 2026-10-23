/**
 * Tab Hạng mục MVP (spec §4.5, chỉ admin): danh sách kể cả hạng mục đã ẩn, công tắc
 * bật/ẩn, form thêm và form sửa dùng chung. Phạm vi `mode` cần chế độ chơi; khi đổi
 * phạm vi khỏi `mode`, PATCH gửi kèm `modeId: null` trong cùng một yêu cầu (service
 * kiểm tra quy tắc phạm vi ⇔ chế độ trên dòng đã gộp).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { AwardCategoryDto, CategoryScope, ModeDto } from '../../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../../api';
import { QueryState } from '../../components/QueryState';
import { Chip } from './Chip';

const CATEGORIES_KEY = ['admin', 'categories'] as const;
const MODES_KEY = ['modes'] as const;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 200;

const SCOPE_LABEL: Record<CategoryScope, string> = { always: 'Luôn có', mode: 'Theo chế độ', optional: 'Tuỳ chọn' };
const SCOPES: readonly CategoryScope[] = ['always', 'mode', 'optional'];

interface CategoryValues {
  name: string;
  description: string;
  scope: CategoryScope;
  /** Id chế độ dạng chuỗi của `<select>`; rỗng = chưa chọn. */
  modeId: string;
}

interface CreateBody {
  scope: CategoryScope;
  modeId?: number;
  name: string;
  description?: string;
}

interface PatchBody {
  scope: CategoryScope;
  modeId: number | null;
  name: string;
  description: string | null;
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
        <h2 className="text-lg font-semibold">Hạng mục</h2>
        <QueryState query={categories}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400">Chưa có hạng mục nào</p>
            ) : (
              <ul className="flex flex-col gap-3">
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
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Thêm hạng mục</h2>
      {/* `key` theo hạng mục vừa tạo: thêm xong thì form dựng lại trống. */}
      <CategoryForm
        key={create.data?.id ?? 'new'}
        formLabel="Thêm hạng mục"
        modes={modes}
        initial={{ name: '', description: '', scope: 'always', modeId: '' }}
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
    <li className="card flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{category.name}</span>
        <Chip tone={category.scope === 'mode' ? 'goose' : category.scope === 'optional' ? 'third' : 'neutral'}>{scopeText(category)}</Chip>
        {!category.active && <Chip tone="duck">Đã ẩn</Chip>}
        <label htmlFor={switchId} className="ml-auto flex items-center gap-2 text-sm">
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            className="size-4 accent-goose"
            checked={category.active}
            disabled={patch.isPending}
            onChange={(event) => patch.mutate({ active: event.target.checked })}
          />
          Đang bật
        </label>
      </div>
      {category.description && !editing && <p className="text-sm text-slate-700 dark:text-slate-300">{category.description}</p>}

      {editing ? (
        <CategoryForm
          formLabel={`Sửa hạng mục ${category.name}`}
          modes={modes}
          initial={{
            name: category.name,
            description: category.description ?? '',
            scope: category.scope,
            modeId: category.mode ? String(category.mode.id) : '',
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
            });
          }}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <button type="button" className="btn-secondary self-start" onClick={() => setEditing(true)}>
            Sửa
          </button>
          {patch.isError && (
            <p role="alert" className="text-sm text-duck">
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
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Tên hạng mục
        </label>
        <input id={`${id}-name`} type="text" maxLength={NAME_MAX} className="field" value={values.name} onChange={(e) => update({ name: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${id}-description`} className="text-sm font-medium">
            Mô tả
          </label>
          <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
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
        <label htmlFor={`${id}-scope`} className="text-sm font-medium">
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
          <label htmlFor={`${id}-mode`} className="text-sm font-medium">
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
          <p role="alert" className="text-sm text-duck">
            {shownError}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm text-goose">
            {success}
          </p>
        )}
      </div>
    </form>
  );
}
