/**
 * Tab Thành viên: ô tìm (tên, mã, Discord ID — gửi lên sau khi ngừng gõ ~300 ms) và
 * lọc trạng thái; danh sách kiểu bảng (một panel, hàng kẻ `night-700`, chữ 14px), mỗi
 * người một hàng xếp dọc nên không tràn ngang ở 320px. Email chỉ có khi server trả về —
 * tức người xem là admin (spec §9).
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

const LABEL_CLASS = 'text-sm font-bold text-night-200';

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
              <ul className="panel flex flex-col divide-y divide-night-700 p-0">
                {list.map((member) => (
                  <li key={member.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-base font-bold text-white">{member.displayName}</span>
                      <code className="font-mono text-night-300">{member.memberCode}</code>
                      <span className="ml-auto flex flex-wrap gap-1">
                        <Chip tone={ACCESS_TONE[member.accessLevel]}>{ACCESS_LABEL[member.accessLevel]}</Chip>
                        <Chip tone={member.status === 'left' ? 'duck' : 'neutral'}>{STATUS_LABEL[member.status]}</Chip>
                      </span>
                    </div>
                    <p className="flex flex-wrap gap-x-3 text-night-300">
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
