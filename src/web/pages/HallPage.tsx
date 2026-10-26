/**
 * Đại sảnh hoá thân (spec §4.7, §6): lưới thẻ role (`RoleCard`) của mọi role đang bật trong
 * một mùa, chia tab Phe Ngỗng / Phe Vịt / Phe thứ 3 (+ "Chế độ đặc biệt" khi có role riêng
 * của chế độ đang bật) vẽ thành chip màu phe. Trong mỗi tab, thẻ đang có người hoá thân
 * đứng trước thẻ trống (giữ thứ tự danh mục trong mỗi nhóm). Mỗi ô là link (nhích lên khi
 * rê chuột) tới bảng xếp hạng của role đó trong mùa đó; thẻ ghi người dẫn đầu trên bảng tên,
 * tên role, `{điểm} {chỉ số}`, ghi chú bản đồ, và "mùa trước" khi mùa này chưa ai hoá thân.
 * Dưới thẻ có người, tên người đó là một link riêng tới trang thành viên công khai (spec huy
 * hiệu §9) — tách khỏi link của thẻ để không lồng link trong link.
 *
 * Mùa trong `?mua=YYYY-MM`, tab trong `?phe=goose|duck|neutral|special` để chia sẻ
 * được; giá trị lạ thì về mặc định (mùa mới nhất, Phe Ngỗng) và không gửi lên API.
 */

import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import type { HallDto, HallRoleDto } from '../../shared/api-types';
import { apiGet } from '../api';
import type { CharacterVariant } from '../components/Character';
import { EmptyState } from '../components/EmptyState';
import { QueryState } from '../components/QueryState';
import { RoleCard } from '../components/RoleCard';
import { SeasonSelect } from '../components/SeasonSelect';
import { resolveSeason, SEASON_PARAM, useSeasons } from '../hooks/useSeasons';
import { cx } from '../lib/cx';
import { FACTION_LABEL, isFaction, isSpecialRole, SPECIAL_LABEL } from '../lib/factions';
import { formatSeasonLabel } from '../lib/format';
import { memberPath } from '../lib/links';

const TAB_PARAM = 'phe';

type HallTab = 'goose' | 'duck' | 'neutral' | 'special';

/** Chip đang chọn: nền phe (`-strong` để chữ trắng đủ tương phản); tab không thuộc phe nào thì vàng. */
const TABS: ReadonlyArray<{ key: HallTab; label: string; activeClass: string }> = [
  { key: 'goose', label: FACTION_LABEL.goose, activeClass: 'bg-goose-strong' },
  { key: 'duck', label: FACTION_LABEL.duck, activeClass: 'bg-duck-strong' },
  { key: 'neutral', label: FACTION_LABEL.neutral, activeClass: 'bg-third' },
  { key: 'special', label: SPECIAL_LABEL, activeClass: 'bg-gold text-gold-ink' },
];

export function HallPage() {
  const [params, setParams] = useSearchParams();
  const seasons = useSeasons();
  const season = resolveSeason(params.get(SEASON_PARAM), seasons.data);
  const seasonId = season?.id ?? null;

  const hall = useQuery({
    queryKey: ['hall', seasonId],
    queryFn: () => apiGet<HallDto>(`/api/hall?season=${seasonId}`),
    enabled: seasonId !== null,
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
          <h1 className="text-raised text-3xl leading-none font-extrabold text-white">Đại sảnh hoá thân</h1>
          {season && (
            <p className="flex flex-wrap items-center gap-2 text-night-300">
              <span>{formatSeasonLabel(season.id)}</span>
              {season.closed && <span className="chip">Mùa đã chốt</span>}
            </p>
          )}
        </div>
        {seasons.data && season && (
          <SeasonSelect seasons={seasons.data} value={season.id} onChange={(id) => setParam(SEASON_PARAM, id)} />
        )}
      </header>

      <QueryState query={seasons}>
        {() =>
          seasonId === null ? (
            <EmptyState>
              <p>Chưa có mùa nào</p>
            </EmptyState>
          ) : (
            <QueryState query={hall}>
              {(data) => (
                <HallGrid data={data} requestedTab={params.get(TAB_PARAM)} onTab={(tab) => setParam(TAB_PARAM, tab)} />
              )}
            </QueryState>
          )
        }
      </QueryState>
    </div>
  );
}

interface HallGridProps {
  data: HallDto;
  requestedTab: string | null;
  onTab: (tab: HallTab) => void;
}

function HallGrid({ data, requestedTab, onTab }: HallGridProps) {
  const hasSpecial = data.roles.some((entry) => isSpecialRole(entry.role));
  const tab = resolveTab(requestedTab, hasSpecial);
  const tabs = TABS.filter((item) => item.key !== 'special' || hasSpecial);
  const inTab = data.roles.filter((entry) =>
    tab === 'special' ? isSpecialRole(entry.role) : !isSpecialRole(entry.role) && entry.role.faction === tab,
  );
  const shown = heldFirst(inTab);

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Chọn phe" className="flex flex-wrap gap-2">
        {tabs.map((item) => {
          const active = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              className={cx('chip px-4 py-1.5 text-base', active ? item.activeClass : 'hover:brightness-110')}
              onClick={() => onTab(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState>
          <p>Chưa có role nào ở phe này</p>
        </EmptyState>
      ) : (
        // 2 cột ở 320px, 3 từ `sm` (768px có 3), 4 từ `lg`, 5 từ `xl` (1280px) — spec §6.
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((entry) => (
            // Mỗi ô chiếm hai hàng lưới theo subgrid — hàng thẻ rồi hàng link tên người giữ — nên thẻ
            // cùng hàng luôn cao bằng nhau dù ô bên cạnh không có link tên (ô trống) hay tên dài hai dòng.
            <li key={entry.role.id} className="row-span-2 grid grid-rows-subgrid gap-1">
              <HallTile entry={entry} seasonId={data.seasonId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Thẻ đang có người hoá thân lên đầu, thẻ trống xuống sau; trong mỗi nhóm giữ nguyên thứ
 * tự danh mục của API (chia nhóm ổn định, không xếp lại theo điểm). Chỉ có người giữ mùa
 * trước (`previous`) mà chưa ai hoá thân mùa này thì vẫn là thẻ trống.
 */
function heldFirst(entries: HallRoleDto[]): HallRoleDto[] {
  return [...entries.filter((entry) => entry.holder !== null), ...entries.filter((entry) => entry.holder === null)];
}

function resolveTab(requested: string | null, hasSpecial: boolean): HallTab {
  if (requested === 'special') return hasSpecial ? 'special' : 'goose';
  return isFaction(requested) ? requested : 'goose';
}

/**
 * Một ô lưới: link tới bảng xếp hạng của role trong mùa đang xem, bọc `RoleCard` (thẻ không
 * tự là link, spec §5.3). Chưa ai hoá thân mùa này thì hiện người giữ mùa đã chốt trước đó
 * (mờ, kèm dòng "mùa trước"); không có cả hai thì `variant = 'empty'` để thẻ vẽ ô trống.
 *
 * Người đang hiện trên thẻ (mùa này hoặc mùa trước) có thêm link tên bên dưới thẻ tới trang
 * thành viên. Link này nằm ngoài link của thẻ (lồng `a` trong `a` là sai HTML) nên ô trả về hai
 * phần tử anh em cho hai hàng subgrid của `li` bọc ngoài (xem `HallGrid`).
 */
function HallTile({ entry, seasonId }: { entry: HallRoleDto; seasonId: string }) {
  const { role, holder, previous } = entry;
  const shown = holder ?? previous;
  const variant: CharacterVariant = holder ? 'current' : previous ? 'previous' : 'empty';
  const name = shown?.displayName ?? null;
  const score = shown?.score ?? null;
  const fromPrevious = holder === null && previous !== null;

  const extra =
    fromPrevious || role.mapNote ? (
      <div className="flex flex-col gap-0.5 px-3 text-sm leading-tight text-night-300">
        {fromPrevious && <p>mùa trước</p>}
        {role.mapNote && <p>{role.mapNote}</p>}
      </div>
    ) : undefined;

  return (
    <>
      {/* `flex` để `lift` (transform) có tác dụng — thẻ `a` inline không nhận transform; bo góc theo panel cho viền focus. */}
      <Link to={`/bang-xep-hang?role=${role.id}&${SEASON_PARAM}=${seasonId}`} className="lift flex w-full rounded-2xl">
        <RoleCard role={role} holderName={name} variant={variant} score={score} extra={extra} className="w-full" />
      </Link>
      {shown && (
        // Giữa cột, sát dưới thẻ; tên dài xuống dòng (cột chỉ ~140px ở 320px), `max-w-full` để không kéo ô lưới rộng ra.
        <Link
          to={memberPath(shown.memberId)}
          className="max-w-full justify-self-center self-start px-1 text-center text-sm leading-tight font-bold break-words text-gold hover:underline"
        >
          {shown.displayName}
        </Link>
      )}
    </>
  );
}
