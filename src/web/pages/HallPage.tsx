/**
 * Đại sảnh hoá thân (spec §4.7): lưới nhân vật của mọi role đang bật trong một mùa,
 * chia tab Phe Ngỗng / Phe Vịt / Phe thứ 3 (+ "Chế độ đặc biệt" khi có role riêng
 * của chế độ đang bật). Mỗi ô: nhân vật với tên người dẫn đầu trên đầu, tên role,
 * `{điểm} {chỉ số}`, ghi chú bản đồ; bấm ô → bảng xếp hạng của role đó trong mùa đó.
 *
 * Mùa trong `?mua=YYYY-MM`, tab trong `?phe=goose|duck|neutral|special` để chia sẻ
 * được; giá trị lạ thì về mặc định (mùa mới nhất, Phe Ngỗng) và không gửi lên API.
 */

import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import type { HallDto, HallRoleDto } from '../../shared/api-types';
import { apiGet } from '../api';
import { Character, type CharacterVariant } from '../components/Character';
import { QueryState } from '../components/QueryState';
import { SeasonSelect } from '../components/SeasonSelect';
import { resolveSeason, SEASON_PARAM, useSeasons } from '../hooks/useSeasons';
import { cx } from '../lib/cx';
import { FACTION_LABEL, isFaction, isSpecialRole, SPECIAL_LABEL } from '../lib/factions';
import { formatSeasonLabel } from '../lib/format';

const TAB_PARAM = 'phe';

type HallTab = 'goose' | 'duck' | 'neutral' | 'special';

const TABS: ReadonlyArray<{ key: HallTab; label: string; activeClass: string }> = [
  { key: 'goose', label: FACTION_LABEL.goose, activeClass: 'border-goose bg-goose text-white' },
  { key: 'duck', label: FACTION_LABEL.duck, activeClass: 'border-duck bg-duck text-white' },
  { key: 'neutral', label: FACTION_LABEL.neutral, activeClass: 'border-third bg-third text-white' },
  {
    key: 'special',
    label: SPECIAL_LABEL,
    activeClass: 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900',
  },
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
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Đại sảnh hoá thân</h1>
          {season && (
            <p className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400">
              <span>{formatSeasonLabel(season.id)}</span>
              {season.closed && (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  Mùa đã chốt
                </span>
              )}
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
            <p className="text-slate-600 dark:text-slate-400">Chưa có mùa nào</p>
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
  const shown = data.roles.filter((entry) =>
    tab === 'special' ? isSpecialRole(entry.role) : !isSpecialRole(entry.role) && entry.role.faction === tab,
  );

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
              className={cx(
                'btn border whitespace-nowrap',
                active
                  ? item.activeClass
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
              )}
              onClick={() => onTab(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-400">Chưa có role nào ở phe này</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {shown.map((entry) => (
            <li key={entry.role.id} className="flex">
              <HallCard entry={entry} seasonId={data.seasonId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function resolveTab(requested: string | null, hasSpecial: boolean): HallTab {
  if (requested === 'special') return hasSpecial ? 'special' : 'goose';
  return isFaction(requested) ? requested : 'goose';
}

function HallCard({ entry, seasonId }: { entry: HallRoleDto; seasonId: string }) {
  const { role, holder, previous } = entry;
  const variant: CharacterVariant = holder ? 'current' : previous ? 'previous' : 'empty';
  const name = holder?.displayName ?? previous?.displayName ?? null;
  const score = holder?.score ?? previous?.score ?? null;

  return (
    <Link
      to={`/bang-xep-hang?role=${role.id}&${SEASON_PARAM}=${seasonId}`}
      className="card flex w-full flex-col items-center gap-2 p-3 text-center transition hover:border-slate-300 hover:shadow-md dark:hover:border-slate-600"
    >
      <Character role={role} holderName={name} variant={variant} />
      <span className="leading-tight font-semibold">
        {role.icon} {role.nameVi}
      </span>
      {score !== null && (
        <span className="text-sm leading-tight text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-900 tabular-nums dark:text-slate-100">{score}</span> {role.metricLabel}
          {holder === null && <span className="block text-xs text-slate-500 dark:text-slate-400">mùa trước</span>}
        </span>
      )}
      {role.mapNote && <span className="text-xs leading-tight text-slate-500 dark:text-slate-400">{role.mapNote}</span>}
    </Link>
  );
}
