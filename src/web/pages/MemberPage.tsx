/**
 * Trang thành viên công khai `/thanh-vien/:id` (spec huy hiệu §9): thẻ "hộ chiếu" như ở Hồ sơ
 * (avatar, tên, "Vào server {ngày VN}", nhãn "Đã rời server" khi đã rời) rồi danh sách danh hiệu
 * của người đó (`GET /api/members/:id`, mới nhất trước), không có thì "Chưa có danh hiệu nào".
 * Id không phải số nguyên thì không gọi API; id không có (404) → cùng trang "Không tìm thấy"
 * của router; lỗi khác hiện như mọi truy vấn (`QueryState`).
 */

import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useParams } from 'react-router';
import type { PublicMemberDto } from '../../shared/api-types';
import { ApiError, apiGet } from '../api';
import { Avatar } from '../components/Avatar';
import { BadgeCard } from '../components/BadgeCard';
import { EmptyState } from '../components/EmptyState';
import { QueryState } from '../components/QueryState';
import { formatDateLabel } from '../lib/format';
import { NotFoundPage } from './PlaceholderPage';

const MEMBER_ID = /^\d+$/;

export function MemberPage() {
  const { id = '' } = useParams();
  const valid = MEMBER_ID.test(id);

  const member = useQuery({
    queryKey: ['member', id],
    queryFn: () => apiGet<PublicMemberDto>(`/api/members/${id}`),
    enabled: valid,
  });

  if (!valid || isNotFound(member.error)) return <NotFoundPage />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <QueryState query={member}>{(data) => <MemberView member={data} />}</QueryState>
    </div>
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function MemberView({ member }: { member: PublicMemberDto }) {
  const badgesHeadingId = useId();
  return (
    <>
      {/* Thẻ "hộ chiếu" cùng kiểu trang Hồ sơ: băng vàng trên cùng, rồi avatar, tên, ngày vào. */}
      <section className="panel overflow-hidden p-0">
        <p className="bg-gold px-4 py-1 text-xs font-extrabold tracking-wide text-gold-ink uppercase">Thành viên</p>
        <div className="flex items-center gap-4 p-4">
          <Avatar name={member.displayName} url={member.avatarUrl} className="size-16 text-2xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* Tên 24px ≥ 18px nên dùng được chữ nổi; tên dài xuống dòng, không tràn ở 320px. */}
            <h1 className="text-raised text-2xl leading-tight font-extrabold break-words text-white">{member.displayName}</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-night-300">
              <span>
                Vào server <time dateTime={member.joinedAt}>{formatDateLabel(new Date(member.joinedAt))}</time>
              </span>
              {member.left && <span className="chip">Đã rời server</span>}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby={badgesHeadingId} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={badgesHeadingId} className="text-xl leading-tight font-extrabold text-white">
            Danh hiệu
          </h2>
          {member.badges.length > 0 && <span className="chip tabular-nums">{member.badges.length}</span>}
        </div>
        {member.badges.length === 0 ? (
          <EmptyState>
            <p>Chưa có danh hiệu nào</p>
          </EmptyState>
        ) : (
          <ul aria-labelledby={badgesHeadingId} className="grid gap-3 sm:grid-cols-2">
            {member.badges.map((badge) => (
              <li key={badge.id} className="flex">
                <BadgeCard badge={badge} showDate className="w-full" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
