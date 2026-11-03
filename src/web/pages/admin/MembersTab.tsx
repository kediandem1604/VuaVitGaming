/**
 * Tab Thành viên: ô tìm (tên, mã, Discord ID — gửi lên sau khi ngừng gõ ~300 ms) và
 * lọc trạng thái; danh sách kiểu bảng (một panel, hàng kẻ `night-700`, chữ 14px), mỗi
 * người một hàng xếp dọc nên không tràn ngang ở 320px. Mỗi hàng ghi số ngày trong server
 * (từ ngày vào server hiệu lực) và số buổi đã đi — kèm ghi chú `(đã chỉnh ±n)` khi admin đã
 * sửa. Email chỉ có khi server trả về — tức người xem là admin (spec §9). Chỉ admin thấy nút
 * **Sửa số buổi**: form tại chỗ đặt tổng số buổi (`PUT /api/admin/members/:id/games`), lưu
 * xong sửa dòng đó trong MỌI danh sách đã cache (mọi bộ lọc) và làm mới trang thành viên công
 * khai của người đó.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import type { AccessLevel, AdminMemberDto, MemberStatus } from '../../../shared/api-types';
import { GAMES_INVALID_MESSAGE, GAMES_MAX, GAMES_MIN, isValidGamesTotal } from '../../../shared/games';
import { apiGet, apiSend, errorMessage } from '../../api';
import { QueryState } from '../../components/QueryState';
import { cx } from '../../lib/cx';
import { useStaggerOnce } from '../../lib/motion';
import { useCurrentMember } from '../../hooks/useMe';
import { formatDateLabel } from '../../lib/format';
import { MEMBER_QUERY_KEY } from '../../lib/queryKeys';
import { Chip } from './Chip';

const DEBOUNCE_MS = 300;

const ACCESS_LABEL: Record<AccessLevel, string> = { member: 'Thành viên', mod: 'Mod', admin: 'Admin' };
const ACCESS_TONE: Record<AccessLevel, 'neutral' | 'goose' | 'third'> = { member: 'neutral', mod: 'goose', admin: 'third' };
const STATUS_LABEL: Record<MemberStatus, string> = { active: 'Đang hoạt động', left: 'Đã rời' };

const LABEL_CLASS = 'text-sm font-bold text-night-200';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';

/** Tiền tố khoá mọi danh sách thành viên quản trị (`['admin', 'members', q, status]`). */
const ADMIN_MEMBERS_KEY = ['admin', 'members'] as const;

/** Dấu trừ thật (U+2212) cho ghi chú chỉnh âm, không phải gạch nối. */
const MINUS = '−';

function membersUrl(q: string, status: string): string {
  const params = new URLSearchParams();
  if (q !== '') params.set('q', q);
  if (status !== '') params.set('status', status);
  const query = params.toString();
  return query === '' ? '/api/admin/members' : `/api/admin/members?${query}`;
}

export function MembersTab() {
  const id = useId();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState('');
  const isAdmin = useCurrentMember().accessLevel === 'admin';

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const url = membersUrl(debouncedQ, status);
  const queryKey = [...ADMIN_MEMBERS_KEY, debouncedQ, status];
  // Gõ tìm/đổi trạng thái: giữ danh sách cũ mờ tới khi kết quả mới về (spec §4.4).
  const members = useQuery({ queryKey, queryFn: () => apiGet<AdminMemberDto[]>(url), placeholderData: keepPreviousData });
  // Lần hiện đầu: 8 dòng đầu mờ + trượt so le (spec §5.4); gõ tìm sau đó không chạy lại. Đồng hồ
  // chỉ chạy khi đã có dòng — tải chậm thì lượt so le vẫn trọn vẹn.
  const stagger = useStaggerOnce((members.data?.length ?? 0) > 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-q`} className={LABEL_CLASS}>
            Tìm thành viên
          </label>
          <input
            id={`${id}-q`}
            type="search"
            className="field"
            placeholder="Tên, mã GGD- hoặc Discord ID"
            autoComplete="off"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-status`} className={LABEL_CLASS}>
            Trạng thái
          </label>
          <select id={`${id}-status`} className="field sm:w-auto" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tất cả</option>
            <option value="active">{STATUS_LABEL.active}</option>
            <option value="left">{STATUS_LABEL.left}</option>
          </select>
        </div>
      </div>

      <QueryState query={members}>
        {(list) => (
          <>
            <p className="text-sm text-night-300">{list.length} thành viên</p>
            {list.length > 0 && (
              <ul className={cx('panel flex flex-col divide-y divide-night-700 p-0', stagger)}>
                {list.map((member) => (
                  <MemberRow key={member.id} member={member} canEdit={isAdmin} />
                ))}
              </ul>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}

interface MemberRowProps {
  member: AdminMemberDto;
  /** Người xem là admin: hiện nút Sửa số buổi. */
  canEdit: boolean;
}

function MemberRow({ member, canEdit }: MemberRowProps) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex flex-col gap-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-bold text-white">{member.displayName}</span>
        <code className="font-mono text-night-300">{member.memberCode}</code>
        <span className="ml-auto flex flex-wrap gap-1">
          <Chip tone={ACCESS_TONE[member.accessLevel]}>{ACCESS_LABEL[member.accessLevel]}</Chip>
          {member.status === 'left' && <Chip tone="duck">{STATUS_LABEL.left}</Chip>}
        </span>
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-night-300">
        {member.email !== null && <span className="break-all">{member.email}</span>}
        <span>
          Trong server {member.daysInServer} ngày · từ {formatDateLabel(new Date(member.serverJoinedAt))}
        </span>
        <span>
          {member.games} buổi
          {member.gamesAdjustment !== 0 && <span className="text-xs"> (đã chỉnh {formatAdjustment(member.gamesAdjustment)})</span>}
        </span>
      </p>
      {canEdit &&
        (editing ? (
          <GamesForm member={member} onClose={() => setEditing(false)} />
        ) : (
          <div>
            <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
              Sửa số buổi
            </button>
          </div>
        ))}
    </li>
  );
}

/** `+12` / `−3` (dấu trừ U+2212). */
function formatAdjustment(n: number): string {
  return n < 0 ? `${MINUS}${-n}` : `+${n}`;
}

/** Chuỗi ô số → tổng hợp lệ (số nguyên 0..10000), không hợp lệ → null. */
function parseGames(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return isValidGamesTotal(n) ? n : null;
}

interface GamesFormProps {
  member: AdminMemberDto;
  onClose: () => void;
}

/**
 * Form tại chỗ đặt tổng số buổi: kiểm tra trước khi gửi (rỗng/không nguyên/ngoài khoảng → cùng câu
 * với server), lưu xong thay dòng đó trong mọi danh sách thành viên đã cache (không tải lại; bộ lọc
 * khác mở lại cũng không còn thấy tổng cũ) và làm mới `['member']` (trang thành viên công khai).
 * Lỗi server hiện dưới ô, form vẫn mở; gõ tiếp thì lời nhắn cũ biến mất.
 */
function GamesForm({ member, onClose }: GamesFormProps) {
  const inputId = useId();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(member.games));
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (games: number) => apiSend<AdminMemberDto>('PUT', `/api/admin/members/${member.id}/games`, { games }),
    onSuccess: (updated) => {
      queryClient.setQueriesData<AdminMemberDto[]>({ queryKey: ADMIN_MEMBERS_KEY }, (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)),
      );
      void queryClient.invalidateQueries({ queryKey: MEMBER_QUERY_KEY });
      onClose();
    },
  });

  const error = localError ?? (save.error ? errorMessage(save.error) : null);

  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const games = parseGames(value);
        if (games === null) {
          setLocalError(GAMES_INVALID_MESSAGE);
          return;
        }
        setLocalError(null);
        save.mutate(games);
      }}
    >
      <div className="flex flex-col gap-1 sm:max-w-xs">
        <label htmlFor={inputId} className={LABEL_CLASS}>
          Tổng số buổi
        </label>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={GAMES_MIN}
          max={GAMES_MAX}
          step={1}
          className="field"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setLocalError(null);
            // Lỗi server của lần lưu trước không còn đúng với giá trị đang gõ.
            save.reset();
          }}
        />
      </div>
      {error && (
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button type="button" className="btn-secondary" disabled={save.isPending} onClick={onClose}>
          Thôi
        </button>
      </div>
    </form>
  );
}
