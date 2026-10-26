/**
 * Hồ sơ của chính mình (spec §6 "Hồ sơ"): thẻ "hộ chiếu" (avatar, tên, mã thành viên
 * trong chip vàng kèm nút sao chép), các role đang hoá thân mùa này (`/api/me/titles`,
 * mỗi role một `RoleCard` mang tên mình), "Danh hiệu của tôi" (spec huy hiệu §9: cùng dữ
 * liệu `GET /api/members/{id của tôi}` với trang thành viên công khai, kèm link "Xem trang
 * công khai"), email (lưu bằng PATCH) và hai công tắc nhắc giờ (PATCH ngay khi bật/tắt).
 * Kết quả PATCH được ghi thẳng vào cache `['me']` nên cả trang cập nhật theo.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { HeldRoleDto, MeDto, PublicMemberDto } from '../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../api';
import { Avatar } from '../components/Avatar';
import { BadgeCard } from '../components/BadgeCard';
import { EmptyState } from '../components/EmptyState';
import { QueryState } from '../components/QueryState';
import { RoleCard } from '../components/RoleCard';
import { ME_QUERY_KEY, useCurrentMember } from '../hooks/useMe';
import { memberPath } from '../lib/links';

const TITLES_QUERY_KEY = ['me', 'titles'] as const;

interface ProfilePatch {
  email?: string | null;
  notifyEmail?: boolean;
  notifyDm?: boolean;
}

const NO_EMAIL_NOTE = 'Chưa có email — bạn chỉ nhận nhắc qua Discord';
const PASSPORT_BAND = 'Hộ chiếu thành viên';

const HEADING_CLASS = 'text-xl leading-tight font-extrabold text-white';
const LABEL_CLASS = 'text-sm font-bold text-night-200';

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
      {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
      <h1 className="text-raised text-3xl leading-none font-extrabold text-white">Hồ sơ</h1>

      <Passport me={me} />
      <HeldRolesSection me={me} />
      <MyBadgesSection me={me} />
      <EmailSection me={me} />
      <NotifySection me={me} />
    </div>
  );
}

/** Thẻ "hộ chiếu": băng vàng trên cùng như băng phe của thẻ role, rồi avatar, tên và mã thành viên. */
function Passport({ me }: { me: MeDto }) {
  return (
    <section className="panel overflow-hidden p-0">
      <p className="bg-gold px-4 py-1 text-xs font-extrabold tracking-wide text-gold-ink uppercase">{PASSPORT_BAND}</p>
      <div className="flex items-center gap-4 p-4">
        <Avatar name={me.displayName} url={me.avatarUrl} className="size-16 text-2xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-lg leading-tight font-extrabold text-white">{me.displayName}</p>
          <MemberCode code={me.memberCode} />
        </div>
      </div>
    </section>
  );
}

/** Các role tôi đang dẫn đầu mùa này, mỗi role một thẻ role mang tên tôi (không phải link: hồ sơ không dẫn đi đâu). */
function HeldRolesSection({ me }: { me: MeDto }) {
  const titles = useQuery({ queryKey: TITLES_QUERY_KEY, queryFn: () => apiGet<HeldRoleDto[]>('/api/me/titles') });

  return (
    <section className="flex flex-col gap-3">
      <h2 className={HEADING_CLASS}>Role đang giữ mùa này</h2>
      <QueryState query={titles}>
        {(held) =>
          held.length === 0 ? (
            <EmptyState>
              <p>Chưa giữ role nào mùa này</p>
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {held.map(({ role, score }) => (
                <li key={role.id} className="flex">
                  <RoleCard role={role} holderName={me.displayName} variant="current" score={score} className="w-full" />
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      <Link to="/khai-diem" className="btn-secondary self-start">
        Xem lịch sử khai điểm
      </Link>
    </section>
  );
}

/**
 * Danh hiệu của tôi: đúng dữ liệu trang thành viên công khai của chính mình (`GET /api/members/{id}`,
 * mới nhất trước), thẻ ghi ngày trao (không ghi tên: cả mục đã là của tôi). Khoá cache trùng với
 * `MemberPage` (`['member', id dạng chuỗi]`) nên bấm "Xem trang công khai" không tải lại.
 */
function MyBadgesSection({ me }: { me: MeDto }) {
  const headingId = useId();
  const member = useQuery({
    queryKey: ['member', String(me.id)],
    queryFn: () => apiGet<PublicMemberDto>(`/api/members/${me.id}`),
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className={HEADING_CLASS}>
          Danh hiệu của tôi
        </h2>
        {member.data && member.data.badges.length > 0 && <span className="chip tabular-nums">{member.data.badges.length}</span>}
      </div>
      <QueryState query={member}>
        {(data) =>
          data.badges.length === 0 ? (
            <EmptyState>
              <p>Chưa có danh hiệu nào</p>
            </EmptyState>
          ) : (
            <ul aria-labelledby={headingId} className="grid gap-3 sm:grid-cols-2">
              {data.badges.map((badge) => (
                <li key={badge.id} className="flex">
                  <BadgeCard badge={badge} showDate className="w-full" />
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      <Link to={memberPath(me.id)} className="btn-secondary self-start">
        Xem trang công khai
      </Link>
    </section>
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
    <div className="flex flex-col gap-1">
      <p className="text-sm text-night-300">Mã thành viên</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip bg-gold text-gold-ink">
          <code className="font-mono tracking-wide select-all">{code}</code>
        </span>
        {/* Icon chỉ trang trí: tên nút vẫn là "Sao chép" / "Đã chép". */}
        <button type="button" className="btn-secondary px-2 py-1 text-xs" aria-live="polite" onClick={() => void copy()}>
          {copied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
          {copied ? 'Đã chép' : 'Sao chép'}
        </button>
      </div>
    </div>
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
    <section className="panel flex flex-col gap-3">
      <h2 className={HEADING_CLASS}>Email</h2>
      <p className="text-sm text-night-300">Dùng để nhận nhắc giờ chơi. Để trống nếu không muốn.</p>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor="email" className={LABEL_CLASS}>
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
        <p role="status" aria-live="polite" className="min-h-5 text-sm font-bold">
          {patch.isPending && <span className="text-night-300">Đang lưu…</span>}
          {patch.isSuccess && <span className="text-ok">Đã lưu</span>}
          {patch.isError && <span className="text-duck-soft">{errorMessage(patch.error)}</span>}
        </p>
      </form>
      {me.email === null && <p className="text-sm font-bold text-gold">{NO_EMAIL_NOTE}</p>}
    </section>
  );
}

function NotifySection({ me }: { me: MeDto }) {
  const patch = useProfilePatch();

  return (
    <section className="panel flex flex-col gap-1">
      <h2 className={HEADING_CLASS}>Nhắc giờ chơi</h2>
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
      {me.email === null && <p className="pt-1 text-sm font-bold text-gold">{NO_EMAIL_NOTE}</p>}
      {patch.isError && (
        <p role="alert" className="pt-1 text-sm font-bold text-duck-soft">
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

/**
 * Checkbox đóng vai công tắc: input ẩn (vẫn focus/đọc được), hình vẽ bằng `peer`. Máng tắt
 * `night-700` có vòng `ring-2 ring-night-600` (3,31:1 trên panel `night-800`, đạt ≥ 3:1 nên
 * thấy được máng khi tắt), bật `gold` với vòng cũng vàng; vòng là box-shadow nên không đẩy núm
 * định vị tuyệt đối. Núm trắng viền `night-950`; focus bàn phím viền `gold` 3px như mọi phần tử
 * bấm được. Chuyển động trượt chỉ khi máy không giảm chuyển động (`motion-safe`).
 */
function Switch({ id, label, checked, disabled, onChange }: SwitchProps) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span className="font-bold text-white">{label}</span>
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
          className="relative h-7 w-12 rounded-full bg-night-700 ring-2 ring-night-600 after:absolute after:top-0.5 after:left-0.5 after:size-6 after:rounded-full after:border-2 after:border-night-950 after:bg-white peer-checked:bg-gold peer-checked:ring-gold peer-checked:after:translate-x-5 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold peer-disabled:opacity-50 motion-safe:transition motion-safe:after:transition"
        />
      </span>
    </label>
  );
}
