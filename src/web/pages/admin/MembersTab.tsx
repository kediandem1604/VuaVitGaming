/**
 * Tab Thành viên: ô tìm (tên, mã, Discord ID — gửi lên sau khi ngừng gõ ~300 ms) và
 * lọc trạng thái; mỗi người một thẻ (xếp dọc nên không tràn ngang ở 320px). Email chỉ
 * có khi server trả về — tức người xem là admin (spec §9).
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import type { AccessLevel, AdminMemberDto, MemberStatus } from '../../../shared/api-types';
import { apiGet } from '../../api';
import { QueryState } from '../../components/QueryState';
import { formatDateLabel } from '../../lib/format';
import { Chip } from './Chip';

const DEBOUNCE_MS = 300;

const ACCESS_LABEL: Record<AccessLevel, string> = { member: 'Thành viên', mod: 'Mod', admin: 'Admin' };
const ACCESS_TONE: Record<AccessLevel, 'neutral' | 'goose' | 'third'> = { member: 'neutral', mod: 'goose', admin: 'third' };
const STATUS_LABEL: Record<MemberStatus, string> = { active: 'Đang hoạt động', left: 'Đã rời' };

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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const url = membersUrl(debouncedQ, status);
  const members = useQuery({ queryKey: ['admin', 'members', debouncedQ, status], queryFn: () => apiGet<AdminMemberDto[]>(url) });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-q`} className="text-sm font-medium">
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
          <label htmlFor={`${id}-status`} className="text-sm font-medium">
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
            <p className="text-sm text-slate-600 dark:text-slate-400">{list.length} thành viên</p>
            {list.length > 0 && (
              <ul className="flex flex-col gap-2">
                {list.map((member) => (
                  <li key={member.id} className="card flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{member.displayName}</span>
                      <code className="font-mono text-sm text-slate-600 dark:text-slate-400">{member.memberCode}</code>
                      <span className="ml-auto flex gap-1">
                        <Chip tone={ACCESS_TONE[member.accessLevel]}>{ACCESS_LABEL[member.accessLevel]}</Chip>
                        <Chip tone={member.status === 'left' ? 'duck' : 'neutral'}>{STATUS_LABEL[member.status]}</Chip>
                      </span>
                    </div>
                    <p className="flex flex-wrap gap-x-3 text-sm text-slate-600 dark:text-slate-400">
                      {member.email !== null && <span className="break-all">{member.email}</span>}
                      <span>Vào hội {formatDateLabel(new Date(member.joinedAt))}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
