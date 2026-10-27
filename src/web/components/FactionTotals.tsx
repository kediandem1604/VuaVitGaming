/**
 * Mục "Tổng điểm theo phe" cuối trang Bảng xếp hạng: bốn tab "Cả 3 phe" / "Ngỗng" / "Vịt" /
 * "Phe thứ 3" cho mùa đang chọn, mỗi tab một bảng top 20 người theo tổng điểm có hệ số của mọi
 * cặp (người, role) thuộc phe đó (server tính, `FactionTotalsDto`). Dòng của người đang xem
 * tô sáng (nền vàng nhạt, viền trái vàng) kèm chữ ẩn "(bạn)"; người xem ngoài top 20 nhưng có
 * điểm thấy thêm dòng "Hạng của bạn: #N · M điểm" cuối bảng; không có điểm ở tab đó thì không
 * thêm gì. Tab theo mẫu WAI-ARIA: chỉ tab đang chọn trong thứ tự Tab, ←/→ (vòng) và Home/End
 * đổi tab và dời focus theo. Tải riêng với các phần khác của trang để lỗi/chờ không che nhau.
 */

import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { FactionTotalRowDto, FactionTotalsDto, TotalsScope } from '../../shared/api-types';
import { apiGet } from '../api';
import { cx } from '../lib/cx';
import { FACTION_BAND, FACTION_SHORT_LABEL, FACTIONS } from '../lib/factions';
import { memberPath } from '../lib/links';
import { LEADERBOARD_TOTALS_KEY } from '../lib/queryKeys';
import { Avatar } from './Avatar';
import { QueryState } from './QueryState';
import { RankMedal } from './RankMedal';

const SCOPES: readonly TotalsScope[] = ['all', ...FACTIONS];

/** Nhãn tab — tên phe ngắn dùng chung, vì bốn tab phải nằm gọn trên một dòng ở 320px. */
const TAB_LABEL: Record<TotalsScope, string> = { all: 'Cả 3 phe', ...FACTION_SHORT_LABEL };

/** Một panel duy nhất đổi nội dung theo tab; mọi tab `aria-controls` trỏ về nó. */
const PANEL_ID = 'totals-panel';

/** Tab đang chọn: "Cả 3 phe" vàng như tab Quản trị, tab phe mang màu phe (bản `-strong`, chữ trắng). */
const SELECTED_TAB: Record<TotalsScope, string> = {
  all: 'bg-gold text-gold-ink',
  goose: cx(FACTION_BAND.goose, 'text-white'),
  duck: cx(FACTION_BAND.duck, 'text-white'),
  neutral: cx(FACTION_BAND.neutral, 'text-white'),
};

export function FactionTotals({ seasonId }: { seasonId: string }) {
  const [scope, setScope] = useState<TotalsScope>('all');
  const tabRefs = useRef<Partial<Record<TotalsScope, HTMLButtonElement | null>>>({});
  const totals = useQuery({
    queryKey: [...LEADERBOARD_TOTALS_KEY, seasonId],
    queryFn: () => apiGet<FactionTotalsDto>(`/api/leaderboard/totals?season=${seasonId}`),
  });

  /** Chọn tab và dời focus tới nó (phím mũi tên theo mẫu "automatic activation"). */
  const focusScope = (next: TotalsScope) => {
    setScope(next);
    tabRefs.current[next]?.focus();
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const i = SCOPES.indexOf(scope);
    const n = SCOPES.length;
    const target =
      event.key === 'ArrowRight' ? SCOPES[(i + 1) % n]
      : event.key === 'ArrowLeft' ? SCOPES[(i - 1 + n) % n]
      : event.key === 'Home' ? SCOPES[0]
      : event.key === 'End' ? SCOPES[n - 1]
      : undefined;
    if (!target) return;
    event.preventDefault();
    focusScope(target);
  };

  return (
    <section aria-labelledby="faction-totals-heading" className="flex flex-col gap-3">
      <h2 id="faction-totals-heading" className="text-xl leading-tight font-extrabold text-white">
        Tổng điểm theo phe
      </h2>
      {/* Dải tab cuộn ngang trong chính nó ở màn hình hẹp; `-my-1.5 py-1.5` chừa chỗ cho viền focus không bị cắt. */}
      <div role="tablist" aria-label="Phe" className="-my-1.5 flex gap-2 overflow-x-auto py-1.5 [scrollbar-width:thin]">
        {SCOPES.map((s) => {
          const selected = s === scope;
          return (
            <button
              key={s}
              ref={(el) => {
                tabRefs.current[s] = el;
              }}
              type="button"
              role="tab"
              id={`totals-tab-${s}`}
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? undefined : -1}
              className={cx('chip shrink-0 px-4 py-1.5 text-base hover:brightness-110', selected && SELECTED_TAB[s])}
              onClick={() => setScope(s)}
              onKeyDown={onTabKeyDown}
            >
              {TAB_LABEL[s]}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={`totals-tab-${scope}`}>
        <QueryState query={totals}>{(data) => <TotalsBoard scope={scope} board={data.boards[scope]} />}</QueryState>
      </div>
    </section>
  );
}

interface TotalsBoardProps {
  scope: TotalsScope;
  board: FactionTotalsDto['boards'][TotalsScope];
}

/** Một bảng: top 20 (dòng của tôi tô sáng) rồi dòng "Hạng của bạn" khi tôi có điểm nhưng không nằm trong top. */
function TotalsBoard({ scope, board }: TotalsBoardProps) {
  const { top, me } = board;
  if (top.length === 0) {
    return <p className="panel py-3 text-sm text-night-300">Chưa có ai có điểm trong mùa này</p>;
  }
  const meOutsideTop = me !== null && !top.some((row) => row.memberId === me.memberId);
  return (
    <div className="panel flex flex-col overflow-hidden p-0">
      <ol aria-label={`Tổng điểm ${TAB_LABEL[scope]}`} className="divide-y divide-night-700">
        {top.map((row) => (
          <TotalsRow key={row.memberId} row={row} isMe={me?.memberId === row.memberId} />
        ))}
      </ol>
      {meOutsideTop && (
        <p className="border-t-2 border-night-950 bg-gold/10 px-3 py-2 text-sm font-bold text-gold tabular-nums">
          Hạng của bạn: #{me.rank} · {me.points} điểm
        </p>
      )}
    </div>
  );
}

/**
 * Một dòng: hạng (huy chương 1-3), avatar trang trí, tên là link tới trang thành viên (dài thì
 * xuống dòng, không tràn ở 320px), `{điểm} điểm` bên phải. Dòng của tôi: `aria-current`, nền
 * vàng nhạt, viền trái vàng (dòng khác viền trong suốt để chữ thẳng hàng) và chữ ẩn "(bạn)".
 */
function TotalsRow({ row, isMe }: { row: FactionTotalRowDto; isMe: boolean }) {
  return (
    <li
      aria-current={isMe ? 'true' : undefined}
      className={cx('flex items-center gap-2 border-l-4 px-3 py-2', isMe ? 'border-gold bg-gold/10' : 'border-transparent')}
    >
      <RankMedal rank={row.rank} />
      {/* Avatar chỉ trang trí: tên viết ngay bên cạnh. */}
      <Avatar name={row.displayName} url={row.avatarUrl} className="size-8 text-sm" />
      <span className="min-w-0 flex-1 leading-tight">
        <Link to={memberPath(row.memberId)} className="font-bold break-words text-white hover:underline">
          {row.displayName}
        </Link>
        {isMe && <span className="sr-only">(bạn)</span>}
      </span>
      <span className="shrink-0 font-bold text-gold tabular-nums">{row.points} điểm</span>
    </li>
  );
}
