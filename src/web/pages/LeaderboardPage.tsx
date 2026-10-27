/**
 * Bảng xếp hạng (spec §8, §6): chọn mùa ở đầu trang, rồi ba phần cho mùa đó.
 *
 * "Top 3 mỗi phe": ba khối Phe Ngỗng / Phe Vịt / Phe thứ 3 (cạnh nhau từ `md`, xếp dọc ở
 * điện thoại), mỗi dòng là một cặp (người, role) với điểm = giá trị thô × hệ số của role
 * (server tính, `FactionTopDto`); cùng một người có thể có nhiều dòng. Phe trống → "Chưa có ai".
 *
 * Bên dưới: chọn role (ô chọn tự làm `Select` có ô tìm, nhóm theo phe, role chế độ đặc biệt
 * thành nhóm riêng) rồi top 50 của role đó trong mùa đó: bục vinh danh 1-2-3 (`Podium`) và
 * bảng đầy đủ mọi hạng (👑 cho hạng 1), avatar, tên, điểm, số trận. Tên người ở mọi chỗ (dòng
 * phe, bục, bảng) là link tới trang thành viên công khai (spec huy hiệu §9).
 *
 * Role có chỉ số phụ (spec chỉ số phụ §7): dòng "Chỉ số:" ghi cả hai chỉ số kèm điểm mỗi đơn
 * vị; điểm mùa trên bục, trong bảng và ở "Top 3 mỗi phe" đọc "N điểm" thay cho `{N} {nhãn}`.
 *
 * Cuối trang: "Tổng điểm theo phe" (`FactionTotals`) — bốn tab, mỗi tab top 20 người theo tổng
 * điểm có hệ số của phe đó (hoặc cả ba phe), kèm dòng của chính người xem.
 *
 * Role trong `?role={id}`, mùa trong `?mua=YYYY-MM` (Đại sảnh và dòng "Top 3 mỗi phe" dẫn
 * tới đây với cả hai); giá trị lạ về mặc định (role đầu danh mục, mùa mới nhất), không gửi lên API.
 */

import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import type { Faction, FactionTopDto, FactionTopRowDto, LeaderboardRowDto, RoleDto } from '../../shared/api-types';
import { formatSeasonScore, hasExtraMetric } from '../../shared/metric';
import { apiGet } from '../api';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { FactionTotals } from '../components/FactionTotals';
import { Podium } from '../components/Podium';
import { QueryState } from '../components/QueryState';
import { RankMedal } from '../components/RankMedal';
import { SeasonSelect } from '../components/SeasonSelect';
import { Select, type SelectGroup } from '../components/Select';
import { resolveSeason, SEASON_PARAM, useSeasons } from '../hooks/useSeasons';
import { cx } from '../lib/cx';
import { FACTION_BAND, FACTION_LABEL, FACTION_SHORT_LABEL, FACTION_TEXT, FACTIONS, isSpecialRole, SPECIAL_LABEL } from '../lib/factions';
import { formatSeasonLabel } from '../lib/format';
import { memberPath } from '../lib/links';

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
      {/* Ô chọn mùa ở đầu trang vì cả "Top 3 mỗi phe" và bảng theo role bên dưới đều theo mùa này (như Đại sảnh). */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
          <h1 className="text-raised text-3xl leading-none font-extrabold text-white">Bảng xếp hạng</h1>
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
          season === null ? (
            <EmptyState>
              <p>Chưa có mùa nào</p>
            </EmptyState>
          ) : (
            <>
              <FactionTop seasonId={season.id} />

              <QueryState query={roles}>
                {(list) =>
                  role === null ? (
                    <EmptyState>
                      <p>Chưa có role nào đang bật</p>
                    </EmptyState>
                  ) : (
                    <section className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                        <RoleSelect roles={list} value={role.id} onChange={(id) => setParam(ROLE_PARAM, String(id))} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {/* Emoji role chỉ trang trí: tiêu đề đọc là tên role. */}
                        <h2 className="text-xl leading-tight font-extrabold text-white">
                          <span aria-hidden="true">{role.icon}</span> {role.nameVi}
                        </h2>
                        {role.description && <p className="text-sm text-night-200">{role.description}</p>}
                        <p className="text-sm text-night-300">Chỉ số: {metricsLine(role)}</p>
                      </div>
                      <QueryState query={board}>{(rows) => <Board role={role} rows={rows} />}</QueryState>
                    </section>
                  )
                }
              </QueryState>

              <FactionTotals seasonId={season.id} />
            </>
          )
        }
      </QueryState>
    </div>
  );
}

/**
 * Phần sau "Chỉ số:" — role thường chỉ có nhãn; role có chỉ số phụ ghi cả hai kèm điểm mỗi đơn vị
 * (chỉ số chính luôn +1): "Số mạng đã giết (+1 điểm) · Số lần ám sát trong cuộc họp (+3 điểm)".
 */
function metricsLine(role: RoleDto): string {
  if (!hasExtraMetric(role)) return role.metricLabel;
  return `${role.metricLabel} (+1 điểm) · ${role.extraMetricLabel} (+${role.extraPoints} điểm)`;
}

/** `?role=` phải là số nguyên và là một role đang bật; không thì role đầu danh mục. */
function resolveRole(requested: string | null, roles: RoleDto[] | undefined): RoleDto | null {
  if (!roles) return null;
  const id = requested !== null && ROLE_ID.test(requested) ? Number(requested) : null;
  return roles.find((role) => role.id === id) ?? roles[0] ?? null;
}

// ---------------------------------------------------------------------------
// Top 3 mỗi phe
// ---------------------------------------------------------------------------

/** Ba khối phe cho mùa đang xem; tải riêng với bảng theo role để lỗi/chờ của phần này không che phần kia. */
function FactionTop({ seasonId }: { seasonId: string }) {
  const top = useQuery({
    queryKey: ['leaderboard-factions', seasonId],
    queryFn: () => apiGet<FactionTopDto>(`/api/leaderboard/factions?season=${seasonId}`),
  });

  return (
    <section aria-labelledby="faction-top-heading" className="flex flex-col gap-3">
      <h2 id="faction-top-heading" className="text-xl leading-tight font-extrabold text-white">
        Top 3 mỗi phe
      </h2>
      <QueryState query={top}>
        {(data) => (
          // Xếp dọc ở điện thoại, ba cột từ `md` (768px).
          <div className="grid gap-3 md:grid-cols-3">
            {FACTIONS.map((faction) => (
              <FactionBlock key={faction} faction={faction} rows={data.factions[faction]} seasonId={seasonId} />
            ))}
          </div>
        )}
      </QueryState>
    </section>
  );
}

interface FactionBlockProps {
  faction: Faction;
  rows: FactionTopRowDto[];
  seasonId: string;
}

/** Một khối phe: panel có băng phe trên cùng (như thẻ role), rồi các dòng hoặc "Chưa có ai". */
function FactionBlock({ faction, rows, seasonId }: FactionBlockProps) {
  const label = FACTION_LABEL[faction];
  return (
    // `p-0 overflow-hidden` để băng phe chạm sát mép và bị cắt theo góc bo.
    <div className="panel flex flex-col overflow-hidden p-0">
      <h3 className={cx('px-3 py-1.5 text-sm font-extrabold tracking-wide text-white', FACTION_BAND[faction])}>{label}</h3>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-night-300">Chưa có ai</p>
      ) : (
        <ol aria-label={`Top 3 ${label}`} className="divide-y divide-night-700">
          {rows.map((row) => (
            <FactionRow key={`${row.memberId}-${row.role.id}`} row={row} seasonId={seasonId} />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Một dòng: huy chương, avatar, rồi hai dòng chữ — tên người (link tới trang thành viên) với
 * `{điểm} điểm` bên phải (role có hệ số ghi thêm `{giá trị} × {hệ số}` nhỏ bên dưới), và
 * `{icon} {role} · {điểm mùa} {chỉ số}` (role có chỉ số phụ: `{điểm mùa} điểm`) với tên role là
 * link tới bảng của role đó trong mùa đang xem. Hai link tách dòng, không lồng nhau. Hai dòng
 * để nhãn chỉ số dài (tới 40 ký tự) xuống dòng thay vì tràn ngang ở 320px.
 */
function FactionRow({ row, seasonId }: { row: FactionTopRowDto; seasonId: string }) {
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      {/* Huy chương 1-2-3 (server trả tối đa 3 dòng mỗi phe; nhiều hơn thì ghi số). */}
      <RankMedal rank={row.rank} className="pt-0.5" />
      {/* Avatar chỉ trang trí: tên viết ngay bên cạnh. */}
      <Avatar name={row.displayName} url={row.avatarUrl} className="size-8 text-sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
        <div className="flex items-baseline justify-between gap-2">
          <Link to={memberPath(row.memberId)} className="min-w-0 truncate font-bold text-white hover:underline">
            {row.displayName}
          </Link>
          <span className="shrink-0 text-right">
            <span className="font-bold text-gold tabular-nums">{row.points} điểm</span>
            {row.weight !== 1 && (
              <span className="block text-xs text-night-300 tabular-nums" title="Role tối đa 1 mỗi trận: nhân hệ số">
                {row.value} × {row.weight}
              </span>
            )}
          </span>
        </div>
        <p className="text-sm break-words text-night-300">
          <Link to={`/bang-xep-hang?${ROLE_PARAM}=${row.role.id}&${SEASON_PARAM}=${seasonId}`} className="font-bold text-night-200 hover:underline">
            <span aria-hidden="true">{row.role.icon}</span> {row.role.nameVi}
          </Link>
          {' · '}
          <span className="tabular-nums">{formatSeasonScore(row.value, row.role)}</span>
        </p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Bảng theo role
// ---------------------------------------------------------------------------

interface RoleSelectProps {
  roles: RoleDto[];
  value: number;
  onChange: (roleId: number) => void;
}

/**
 * Ô chọn role (nhãn "Role") trên ô chọn tự làm `Select`: nhóm theo phe với tiêu đề màu phe
 * ("Ngỗng" / "Vịt" / "Phe thứ 3"), role chế độ đặc biệt thành nhóm riêng; mỗi dòng
 * `{icon} {tên}`; ô tìm khớp tên Việt, tên Anh và key không phân biệt dấu (như `RolePicker`
 * ở trang Khai điểm).
 */
function RoleSelect({ roles, value, onChange }: RoleSelectProps) {
  const toOption = (role: RoleDto) => ({
    value: role.id,
    label: `${role.icon} ${role.nameVi}`,
    searchText: [role.nameVi, role.nameEn, role.key.replaceAll('_', ' ')],
  });
  const groups: SelectGroup<number>[] = [
    ...FACTIONS.map((faction) => ({
      label: FACTION_SHORT_LABEL[faction],
      labelClassName: FACTION_TEXT[faction],
      options: roles.filter((role) => !isSpecialRole(role) && role.faction === faction).map(toOption),
    })),
    { label: SPECIAL_LABEL, options: roles.filter(isSpecialRole).map(toOption) },
  ].filter((group) => group.options.length > 0);

  return (
    <Select
      label="Role"
      value={value}
      onChange={onChange}
      groups={groups}
      search={{ label: 'Tìm role', placeholder: 'Tìm role…', empty: 'Không có role nào khớp' }}
    />
  );
}

/** Bục vinh danh rồi bảng đầy đủ mọi hạng (kể cả top 3), hàng kẻ `night-700`; tên mỗi hàng là link tới trang thành viên. */
function Board({ role, rows }: { role: RoleDto; rows: LeaderboardRowDto[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        <p>Chưa có ai khai điểm mùa này</p>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Podium role={role} rows={rows} />

      <ol aria-label="Mọi hạng" className="panel divide-y divide-night-700 p-0">
        {rows.map((row) => (
          <li key={row.memberId} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
            <span className="w-7 shrink-0 text-center text-base font-bold text-white tabular-nums" title={`Hạng ${row.rank}`}>
              {row.rank === 1 ? '👑' : row.rank}
            </span>
            <Avatar name={row.displayName} url={row.avatarUrl} className="size-9 text-sm" />
            <Link to={memberPath(row.memberId)} className="min-w-0 flex-1 truncate font-bold text-white hover:underline">
              {row.displayName}
            </Link>
            {/*
             * Chỉ số đã ghi một lần trên đầu ("Chỉ số: …") và trên bục; dòng chỉ ghi số (title = tên chỉ
             * số) để không tràn ở 320px với nhãn dài. Role có chỉ số phụ không có đơn vị dài: ghi "N điểm".
             */}
            <span className="flex shrink-0 flex-col items-end leading-tight">
              {hasExtraMetric(role) ? (
                <span className="font-bold text-gold tabular-nums">{formatSeasonScore(row.score, role)}</span>
              ) : (
                <span className="font-bold text-gold tabular-nums" title={role.metricLabel}>
                  {row.score}
                </span>
              )}
              <span className="text-sm text-night-300 tabular-nums">{row.games} trận</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
