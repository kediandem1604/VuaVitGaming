/**
 * Hồ sơ của chính mình: avatar, tên, mã thành viên (sao chép), email (lưu bằng
 * PATCH) và hai công tắc nhắc giờ (PATCH ngay khi bật/tắt). Kết quả PATCH được
 * ghi thẳng vào cache `['me']` nên cả trang cập nhật theo.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { MeDto } from '../../shared/api-types';
import { apiSend, errorMessage } from '../api';
import { Avatar } from '../components/Avatar';
import { ME_QUERY_KEY, useCurrentMember } from '../hooks/useMe';

interface ProfilePatch {
  email?: string | null;
  notifyEmail?: boolean;
  notifyDm?: boolean;
}

const NO_EMAIL_NOTE = 'Chưa có email — bạn chỉ nhận nhắc qua Discord';

function useProfilePatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => apiSend<MeDto>('PATCH', '/api/me', patch),
    onSuccess: (me) => queryClient.setQueryData(ME_QUERY_KEY, me),
  });
}

export function ProfilePage() {
  const me = useCurrentMember();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-bold">Hồ sơ</h1>

      <section className="card flex items-center gap-4">
        <Avatar name={me.displayName} url={me.avatarUrl} className="size-16 text-2xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-lg font-semibold">{me.displayName}</p>
          <MemberCode code={me.memberCode} />
        </div>
      </section>

      <EmailSection me={me} />
      <NotifySection me={me} />
    </div>
  );
}

function MemberCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Trình duyệt không cho chép (không HTTPS, bị chặn): người dùng vẫn bôi đen được.
    }
  };

  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
      <span>
        Mã thành viên:{' '}
        <code className="font-mono font-semibold text-slate-900 select-all dark:text-slate-100">{code}</code>
      </span>
      <button type="button" className="btn-secondary px-2 py-1 text-xs" aria-live="polite" onClick={() => void copy()}>
        {copied ? 'Đã chép' : 'Sao chép'}
      </button>
    </p>
  );
}

function EmailSection({ me }: { me: MeDto }) {
  const [email, setEmail] = useState(me.email ?? '');
  const patch = useProfilePatch();

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
    patch.reset();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim();
    patch.mutate(
      { email: trimmed === '' ? null : trimmed },
      // Server có thể chuẩn hoá (viết thường…): hiện đúng giá trị đã lưu.
      { onSuccess: (updated) => setEmail(updated.email ?? '') },
    );
  };

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Email</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">Dùng để nhận nhắc giờ chơi. Để trống nếu không muốn.</p>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">
          Địa chỉ email
        </label>
        <div className="flex gap-2">
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="ban@example.com"
            className="field min-w-0 flex-1"
            value={email}
            onChange={onChange}
          />
          <button type="submit" className="btn-primary" disabled={patch.isPending}>
            Lưu
          </button>
        </div>
        <p role="status" aria-live="polite" className="min-h-5 text-sm">
          {patch.isPending && <span className="text-slate-500">Đang lưu…</span>}
          {patch.isSuccess && <span className="text-goose">Đã lưu</span>}
          {patch.isError && <span className="text-duck">{errorMessage(patch.error)}</span>}
        </p>
      </form>
      {me.email === null && <p className="text-sm text-amber-700 dark:text-amber-400">{NO_EMAIL_NOTE}</p>}
    </section>
  );
}

function NotifySection({ me }: { me: MeDto }) {
  const patch = useProfilePatch();

  return (
    <section className="card flex flex-col gap-1">
      <h2 className="text-lg font-semibold">Nhắc giờ chơi</h2>
      <Switch
        id="notify-email"
        label="Nhận nhắc qua email"
        checked={me.notifyEmail}
        disabled={patch.isPending}
        onChange={(event) => patch.mutate({ notifyEmail: event.target.checked })}
      />
      <Switch
        id="notify-dm"
        label="Nhận nhắc qua Discord"
        checked={me.notifyDm}
        disabled={patch.isPending}
        onChange={(event) => patch.mutate({ notifyDm: event.target.checked })}
      />
      {me.email === null && <p className="pt-1 text-sm text-amber-700 dark:text-amber-400">{NO_EMAIL_NOTE}</p>}
      {patch.isError && (
        <p role="alert" className="pt-1 text-sm text-duck">
          {errorMessage(patch.error)}
        </p>
      )}
    </section>
  );
}

interface SwitchProps {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** Checkbox đóng vai công tắc: input ẩn (vẫn focus/đọc được), hình vẽ bằng `peer`. */
function Switch({ id, label, checked, disabled, onChange }: SwitchProps) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span className="font-medium">{label}</span>
      <span className="relative inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
        <span
          aria-hidden="true"
          className="relative h-7 w-12 rounded-full bg-slate-300 transition after:absolute after:top-0.5 after:left-0.5 after:size-6 after:rounded-full after:bg-white after:shadow after:transition peer-checked:bg-goose peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-goose/50 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 dark:bg-slate-600"
        />
      </span>
    </label>
  );
}
