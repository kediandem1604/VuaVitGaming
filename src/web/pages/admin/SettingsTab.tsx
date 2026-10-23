/**
 * Tab Cài đặt (chỉ admin): ba ô số theo `Settings` — thời gian mở vote (giờ), tự kết
 * thúc buổi sau (giờ), nhắc trước (phút). Khoảng hợp lệ kiểm tra tại chỗ cho câu báo
 * rõ nghĩa; server kiểm tra lại và thông báo của nó được hiện nguyên văn.
 *
 * Mutation nằm ở tab (không ở form): form được dựng lại theo dữ liệu server (`key`)
 * để các ô luôn khớp cài đặt đã lưu, mà trạng thái "Đã lưu" / lỗi không bị mất theo.
 *
 * Cuối tab: mục "Chế độ chơi" — mọi chế độ kể cả đang tắt (`/api/admin/modes`), mỗi
 * chế độ sửa được tên tiếng Việt (spec §6.5: tên Việt chưa xác minh) và bật/tắt (chế độ
 * tắt không hiện trong form tạo buổi / hạng mục / role). Lưu xong thì danh sách chế độ
 * công khai (`['modes']`, các form đó dùng) được tải lại.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { AdminModeDto, SettingsDto } from '../../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../../api';
import { QueryState } from '../../components/QueryState';
import { Chip } from './Chip';

const SETTINGS_KEY = ['admin', 'settings'] as const;
const ADMIN_MODES_KEY = ['admin', 'modes'] as const;
/** Danh sách chế độ đang bật cho các form (tạo buổi, hạng mục, thêm role). */
const PUBLIC_MODES_KEY = ['modes'] as const;
const MODE_NAME_MAX = 60;

interface FieldDef {
  key: keyof SettingsDto;
  label: string;
  min: number;
  max: number;
  hint: string;
}

const FIELDS: readonly FieldDef[] = [
  { key: 'voteDurationHours', label: 'Thời gian mở vote (giờ)', min: 1, max: 72, hint: 'Vote MVP tự đóng sau bấy nhiêu giờ kể từ khi buổi kết thúc' },
  { key: 'autoEndHours', label: 'Tự kết thúc buổi sau (giờ)', min: 1, max: 24, hint: 'Buổi không được bấm Kết thúc thì tự kết thúc sau bấy nhiêu giờ kể từ giờ bắt đầu' },
  { key: 'reminderLeadMinutes', label: 'Nhắc trước (phút)', min: 5, max: 120, hint: 'Nhắc người tham gia trước giờ bắt đầu bấy nhiêu phút' },
];

export function SettingsTab() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => apiGet<SettingsDto>('/api/admin/settings') });

  const save = useMutation({
    mutationFn: (body: SettingsDto) => apiSend<SettingsDto>('PATCH', '/api/admin/settings', body),
    onSuccess: (saved) => queryClient.setQueryData(SETTINGS_KEY, saved),
  });

  return (
    <>
      <section className="card flex max-w-lg flex-col gap-3">
        <h2 className="text-lg font-semibold">Cài đặt</h2>
        <QueryState query={settings}>
          {(data) => (
            <SettingsForm
              key={JSON.stringify(data)}
              settings={data}
              pending={save.isPending}
              serverError={save.isError ? errorMessage(save.error) : null}
              saved={save.isSuccess}
              onChange={() => {
                if (save.isError || save.isSuccess) save.reset();
              }}
              onSubmit={(body) => save.mutate(body)}
            />
          )}
        </QueryState>
      </section>
      <ModesSection />
    </>
  );
}

interface SettingsFormProps {
  settings: SettingsDto;
  pending: boolean;
  serverError: string | null;
  saved: boolean;
  onChange: () => void;
  onSubmit: (body: SettingsDto) => void;
}

function SettingsForm({ settings, pending, serverError, saved, onChange, onSubmit }: SettingsFormProps) {
  const id = useId();
  const [values, setValues] = useState<Record<keyof SettingsDto, string>>({
    voteDurationHours: String(settings.voteDurationHours),
    autoEndHours: String(settings.autoEndHours),
    reminderLeadMinutes: String(settings.reminderLeadMinutes),
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body: Partial<SettingsDto> = {};
    for (const field of FIELDS) {
      const value = Number(values[field.key]);
      if (values[field.key].trim() === '' || !Number.isInteger(value) || value < field.min || value > field.max) {
        setLocalError(`${field.label} phải từ ${field.min} đến ${field.max}`);
        return;
      }
      body[field.key] = value;
    }
    setLocalError(null);
    onSubmit(body as SettingsDto);
  };

  const error = localError ?? serverError;

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {FIELDS.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <label htmlFor={`${id}-${field.key}`} className="text-sm font-medium">
            {field.label}
          </label>
          <input
            id={`${id}-${field.key}`}
            type="number"
            inputMode="numeric"
            min={field.min}
            max={field.max}
            step={1}
            className="field"
            value={values[field.key]}
            onChange={(event) => {
              setValues((current) => ({ ...current, [field.key]: event.target.value }));
              setLocalError(null);
              onChange();
            }}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {field.hint} ({field.min}–{field.max}).
          </p>
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <button type="submit" className="btn-primary self-start" disabled={pending}>
          {pending ? 'Đang lưu…' : 'Lưu'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-duck">
            {error}
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-goose">
          {saved && 'Đã lưu'}
        </p>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Chế độ chơi
// ---------------------------------------------------------------------------

function ModesSection() {
  const titleId = useId();
  const modes = useQuery({ queryKey: ADMIN_MODES_KEY, queryFn: () => apiGet<AdminModeDto[]>('/api/admin/modes') });

  return (
    <section aria-labelledby={titleId} className="card flex max-w-lg flex-col gap-3">
      <h2 id={titleId} className="text-lg font-semibold">
        Chế độ chơi
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Tên tiếng Việt hiện ở buổi chơi, tin Discord và hạng mục. Chế độ tắt không còn trong form tạo buổi; buổi cũ giữ nguyên.
      </p>
      <QueryState query={modes}>
        {(list) => (
          <ul className="flex flex-col gap-3">
            {list.map((mode) => (
              <li key={mode.id}>
                <ModeRow mode={mode} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

function ModeRow({ mode }: { mode: AdminModeDto }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [nameVi, setNameVi] = useState(mode.nameVi);
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { nameVi?: string; active?: boolean }) => apiSend<AdminModeDto>('PATCH', `/api/admin/modes/${mode.id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<AdminModeDto[]>(ADMIN_MODES_KEY, (current) => current?.map((item) => (item.id === updated.id ? updated : item)));
      void queryClient.invalidateQueries({ queryKey: PUBLIC_MODES_KEY });
    },
  });

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = nameVi.trim();
    if (trimmed === '') return setLocalError('Tên tiếng Việt không được để trống');
    setLocalError(null);
    if (trimmed !== mode.nameVi) save.mutate({ nameVi: trimmed });
  };

  const error = localError ?? (save.isError ? errorMessage(save.error) : null);
  const renamed = save.isSuccess && save.variables?.nameVi !== undefined;

  return (
    <div role="group" aria-labelledby={`${id}-title`} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span id={`${id}-title`} className="font-semibold">
          {mode.nameEn}
        </span>
        {!mode.active && <Chip tone="duck">Đã tắt</Chip>}
        <label htmlFor={`${id}-active`} className="ml-auto flex items-center gap-2 text-sm">
          <input
            id={`${id}-active`}
            type="checkbox"
            role="switch"
            className="size-4 accent-goose"
            checked={mode.active}
            disabled={save.isPending}
            onChange={(event) => {
              setLocalError(null);
              save.mutate({ active: event.target.checked });
            }}
          />
          Đang bật
        </label>
      </div>
      <form noValidate onSubmit={rename} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Tên tiếng Việt
          </label>
          <input
            id={`${id}-name`}
            type="text"
            maxLength={MODE_NAME_MAX}
            className="field"
            value={nameVi}
            onChange={(event) => {
              setNameVi(event.target.value);
              setLocalError(null);
              if (save.isError || save.isSuccess) save.reset();
            }}
          />
        </div>
        <button type="submit" className="btn-secondary self-start sm:self-auto" disabled={save.isPending}>
          {save.isPending ? 'Đang lưu…' : 'Lưu tên'}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-duck">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-goose">
        {renamed && 'Đã lưu'}
      </p>
    </div>
  );
}
