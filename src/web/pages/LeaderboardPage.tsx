/**
 * Bảng xếp hạng (spec §8): chọn role (nhóm theo phe, role chế độ đặc biệt thành nhóm
 * riêng) và mùa, rồi top 50 của role đó trong mùa đó: nhân vật của người đứng đầu,
 * danh sách hạng (👑 cho hạng 1), avatar, tên, `{điểm} {chỉ số}`, số trận.
 *
 * Role trong `?role={id}`, mùa trong `?mua=YYYY-MM` (Đại sảnh dẫn tới đây với cả
 * hai); giá trị lạ về mặc định (role đầu danh mục, mùa mới nhất), không gửi lên API.
 */

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import type { LeaderboardRowDto, RoleDto } from '../../shared/api-types';
import { apiGet } from '../api';
import { Avatar } from '../components/Avatar';
import { Character } from '../components/Character';
import { QueryState } from '../components/QueryState';
import { SeasonSelect } from '../components/SeasonSelect';
import { resolveSeason, SEASON_PARAM, useSeasons } from '../hooks/useSeasons';
import { FACTION_LABEL, FACTIONS, isSpecialRole, SPECIAL_LABEL } from '../lib/factions';

const ROLE_PARAM = 'role';
const LIMIT = 50;
const ROLE_ID = /^\d+$/;

export function LeaderboardPage() {
  const [params, setParams] = useSearchParams();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => apiGet<RoleDto[]>('/api/roles') });
  const seasons = useSeasons();

  const role = resolveRole(params.get(ROLE_PARAM), roles.data);
  const season = resolveSeason(params.get(SEASON_PARAM), seasons.data);
  const roleId = role?.id ?? null;
  const seasonId = season?.id ?? null;

  const board = useQuery({
    queryKey: ['leaderboard', roleId, seasonId],
    queryFn: () => apiGet<LeaderboardRowDto[]>(`/api/leaderboard?roleId=${roleId}&season=${seasonId}&limit=${LIMIT}`),
    enabled: roleId !== null && seasonId !== null,
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Bảng xếp hạng</h1>

      <QueryState query={roles}>
        {(list) => (
          <QueryState query={seasons}>
            {(seasonList) =>
              role === null || season === null ? (
                <p className="text-slate-600 dark:text-slate-400">{role === null ? 'Chưa có role nào đang bật' : 'Chưa có mùa nào'}</p>
              ) : (
                <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <RoleSelect roles={list} value={role.id} onChange={(id) => setParam(ROLE_PARAM, String(id))} />
                    <SeasonSelect seasons={seasonList} value={season.id} onChange={(id) => setParam(SEASON_PARAM, id)} />
                    {season.closed && (
                      <span className="self-start rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 sm:self-center dark:bg-slate-700 dark:text-slate-200">
                        Mùa đã chốt
                      </span>
                    )}
                  </div>

                  <section className="flex flex-col gap-3">
                    <div className="flex flex-col gap-0.5">
                      <h2 className="text-lg font-semibold">
                        {role.icon} {role.nameVi}
                      </h2>
                      {role.description && <p className="text-sm text-slate-600 dark:text-slate-400">{role.description}</p>}
                      <p className="text-sm text-slate-500 dark:text-slate-400">Chỉ số: {role.metricLabel}</p>
                    </div>
                    <QueryState query={board}>{(rows) => <Board role={role} rows={rows} />}</QueryState>
                  </section>
                </>
              )
            }
          </QueryState>
        )}
      </QueryState>
    </div>
  );
}

/** `?role=` phải là số nguyên và là một role đang bật; không thì role đầu danh mục. */
function resolveRole(requested: string | null, roles: RoleDto[] | undefined): RoleDto | null {
  if (!roles) return null;
  const id = requested !== null && ROLE_ID.test(requested) ? Number(requested) : null;
  return roles.find((role) => role.id === id) ?? roles[0] ?? null;
}

interface RoleSelectProps {
  roles: RoleDto[];
  value: number;
  onChange: (roleId: number) => void;
}

function RoleSelect({ roles, value, onChange }: RoleSelectProps) {
  const groups = [
    ...FACTIONS.map((faction) => ({
      label: FACTION_LABEL[faction],
      items: roles.filter((role) => !isSpecialRole(role) && role.faction === faction),
    })),
    { label: SPECIAL_LABEL, items: roles.filter(isSpecialRole) },
  ].filter((group) => group.items.length > 0);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium">Role</span>
      <select className="field min-w-0 flex-1 sm:w-auto sm:flex-none" value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.items.map((role) => (
              <option key={role.id} value={role.id}>
                {role.icon} {role.nameVi}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function Board({ role, rows }: { role: RoleDto; rows: LeaderboardRowDto[] }) {
  const top = rows[0];
  if (!top) return <p className="text-slate-600 dark:text-slate-400">Chưa có ai khai điểm mùa này</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex items-center gap-4">
        <Character role={role} holderName={top.displayName} variant="current" size={96} className="shrink-0" />
        {/* `min-w-0 flex-1`: khối chữ chiếm phần còn lại và nằm sát nhân vật; chỉ số dài thì xuống dòng. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm text-slate-500 dark:text-slate-400">Đang hoá thân</p>
          <p className="truncate text-lg font-bold">{top.displayName}</p>
          <p className="text-sm break-words text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-900 tabular-nums dark:text-slate-100">{top.score}</span> {role.metricLabel} ·{' '}
            <span className="tabular-nums">{top.games}</span> trận
          </p>
        </div>
      </div>

      <ol className="card divide-y divide-slate-200 p-0 dark:divide-slate-800">
        {rows.map((row) => (
          <li key={row.memberId} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
            <span className="w-7 shrink-0 text-center text-base font-bold tabular-nums" title={`Hạng ${row.rank}`}>
              {row.rank === 1 ? '👑' : row.rank}
            </span>
            <Avatar name={row.displayName} url={row.avatarUrl} className="size-9 text-sm" />
            <span className="min-w-0 flex-1 truncate font-medium">{row.displayName}</span>
            {/* Chỉ số đã ghi một lần trên đầu danh sách ("Chỉ số: …"); dòng chỉ ghi số để không tràn ở 320px với nhãn dài. */}
            <span className="flex shrink-0 flex-col items-end leading-tight">
              <span className="font-semibold tabular-nums" title={role.metricLabel}>
                {row.score}
              </span>
              <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">{row.games} trận</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
