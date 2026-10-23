/**
 * Tab Cài đặt (chỉ admin): ba ô số theo `Settings` — thời gian mở vote (giờ), tự kết
 * thúc buổi sau (giờ), nhắc trước (phút). Khoảng hợp lệ kiểm tra tại chỗ cho câu báo
 * rõ nghĩa; server kiểm tra lại và thông báo của nó được hiện nguyên văn.
 *
 * Mutation nằm ở tab (không ở form): form được dựng lại theo dữ liệu server (`key`)
 * để các ô luôn khớp cài đặt đã lưu, mà trạng thái "Đã lưu" / lỗi không bị mất theo.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { SettingsDto } from '../../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../../api';
import { QueryState } from '../../components/QueryState';

const SETTINGS_KEY = ['admin', 'settings'] as const;

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
