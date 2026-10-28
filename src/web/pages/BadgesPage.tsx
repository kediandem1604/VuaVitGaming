/**
 * Trang Huy hiệu (spec huy hiệu §9): tường vinh danh mọi danh hiệu đã trao (`GET /api/badges`,
 * mới nhất trước), nhóm theo tháng Việt Nam của `awardedAt` với tiêu đề "Trao trong tháng
 * 11/2026" — danh hiệu tháng 10 được trao rạng sáng 4/11 nên nằm ở nhóm tháng 11; tên danh
 * hiệu đã ghi rõ tháng của nó. Mỗi thẻ: icon, tên, `detail`, avatar + tên người (link tới trang
 * thành viên). Nút "Xem thêm" tải trang kế bằng `before = id dòng cuối`; trang trả về ít hơn
 * `PAGE_SIZE` dòng là hết. Bên dưới là mục "Cách nhận": cả danh mục `BADGES`, tách "Mỗi tháng"
 * và "Cột mốc".
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { useId } from 'react';
import type { BadgeDto } from '../../shared/api-types';
import { BADGES, type BadgeDef } from '../../shared/badges';
import { apiGet, errorMessage } from '../api';
import { BadgeCard } from '../components/BadgeCard';
import { EmptyState } from '../components/EmptyState';
import { QueryState } from '../components/QueryState';
import { SkeletonCards } from '../components/Skeleton';
import { vnMonthOf } from '../lib/format';

/** Cỡ trang cố định ở client: cũng là mốc để biết trang vừa tải là trang cuối (ít dòng hơn). */
const PAGE_SIZE = 50;

const HEADING_CLASS = 'text-xl leading-tight font-extrabold text-white';

export function BadgesPage() {
  const wall = useInfiniteQuery({
    queryKey: ['badges'],
    // Trang đầu không có `before`; trang sau lấy từ id dòng cuối của trang trước.
    queryFn: ({ pageParam }) =>
      apiGet<BadgeDto[]>(pageParam === null ? `/api/badges?limit=${PAGE_SIZE}` : `/api/badges?before=${pageParam}&limit=${PAGE_SIZE}`),
    initialPageParam: null as number | null,
    // Trang ngắn hơn cỡ trang là trang cuối; không thì trang sau bắt đầu sau id dòng cuối.
    getNextPageParam: (lastPage) => (lastPage.length < PAGE_SIZE ? undefined : lastPage.at(-1)?.id),
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
        <h1 className="text-raised text-3xl leading-none font-extrabold text-white">Huy hiệu</h1>
        <p className="text-night-300">Danh hiệu trao một lần, giữ mãi. Mới nhất ở trên.</p>
      </header>

      <QueryState query={wall} skeleton={<SkeletonCards count={6} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" />}>
        {(data) => {
          const badges = data.pages.flat();
          if (badges.length === 0) {
            return (
              <EmptyState>
                <p>Chưa có danh hiệu nào — đầu tháng sau sẽ có SMVP đầu tiên!</p>
              </EmptyState>
            );
          }
          return (
            <div className="flex flex-col gap-6">
              {groupByVnMonth(badges).map(([monthId, items]) => (
                <MonthGroup key={monthId} monthId={monthId} badges={items} />
              ))}
              {wall.hasNextPage && (
                <div className="flex flex-col items-start gap-2">
                  {wall.isFetchNextPageError && (
                    <p role="alert" className="font-bold text-duck-soft">
                      {errorMessage(wall.error)}
                    </p>
                  )}
                  <button type="button" className="btn-secondary" disabled={wall.isFetchingNextPage} onClick={() => void wall.fetchNextPage()}>
                    {wall.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm'}
                  </button>
                </div>
              )}
            </div>
          );
        }}
      </QueryState>

      <HowToSection />
    </div>
  );
}

/**
 * Nhóm theo tháng Việt Nam của `awardedAt`, giữ thứ tự gặp đầu tiên: API trả mới nhất trước nên
 * nhóm mới nhất đứng đầu, và dòng của trang sau cùng tháng nhập vào nhóm đang có.
 */
function groupByVnMonth(badges: BadgeDto[]): Array<[string, BadgeDto[]]> {
  const groups = new Map<string, BadgeDto[]>();
  for (const badge of badges) {
    const monthId = vnMonthOf(badge.awardedAt);
    const group = groups.get(monthId);
    if (group) group.push(badge);
    else groups.set(monthId, [badge]);
  }
  return [...groups.entries()];
}

/** `2026-11` → `Trao trong tháng 11/2026` (tháng không đệm số 0, như `formatSeasonLabel`). */
function monthHeading(monthId: string): string {
  const [year = '', month = ''] = monthId.split('-');
  return `Trao trong tháng ${Number(month)}/${year}`;
}

function MonthGroup({ monthId, badges }: { monthId: string; badges: BadgeDto[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className={HEADING_CLASS}>
        {monthHeading(monthId)}
      </h2>
      {/* Một cột ở điện thoại (`grid-cols-1` = `minmax(0,1fr)`: cột không nở theo tên dài trong thẻ, để `truncate` cắt được), hai từ `sm`, ba từ `lg`. */}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {badges.map((badge) => (
          <li key={badge.id} className="flex">
            <BadgeCard badge={badge} showMember className="w-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cách nhận
// ---------------------------------------------------------------------------

function HowToSection() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className={HEADING_CLASS}>
        Cách nhận
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <HowToGroup
          title="Mỗi tháng"
          note="Trao sau khi tháng chốt (rạng sáng ngày 4 tháng sau), theo số liệu của tháng đó."
          items={BADGES.filter((def) => def.kind === 'monthly')}
        />
        <HowToGroup title="Cột mốc" note="Trao ngay khi đạt, một lần trong đời." items={BADGES.filter((def) => def.kind === 'milestone')} />
      </div>
    </section>
  );
}

function HowToGroup({ title, note, items }: { title: string; note: string; items: BadgeDef[] }) {
  const headingId = useId();
  return (
    <div className="panel flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 id={headingId} className="text-lg leading-tight font-extrabold text-white">
          {title}
        </h3>
        <p className="text-sm text-night-300">{note}</p>
      </div>
      <ul aria-labelledby={headingId} className="divide-y divide-night-700">
        {items.map((def) => (
          <li key={def.key} className="flex items-start gap-3 py-2">
            {/* Emoji chỉ trang trí: tên danh hiệu viết ngay bên cạnh. */}
            <span aria-hidden="true" className="w-8 shrink-0 text-center text-2xl leading-none">
              {def.icon}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
              <p className="font-bold text-white">{def.name}</p>
              <p className="text-sm break-words text-night-300">{def.howTo}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
