/**
 * Trang buổi `/buoi/:id` (spec ván §4 phần web, §5): tiêu đề buổi; lưới ảnh ván (Ván 1, 2, …; bấm
 * ảnh phóng to trong Modal); dưới mỗi ảnh chip phe thắng, danh sách lần khai công khai của ván
 * (avatar, tên, `{icon} {role}`, trạng thái nhỏ cho lần khai của chính mình) và nút "Khai role ván
 * này" (chưa khai và còn hạn) mở form ngay trong thẻ; đã khai mà còn chờ duyệt → "Sửa".
 *
 * Mod/admin quản lý ván ngay trên trang: "+ Thêm ván" (ảnh + phe thắng), mỗi ván đổi ảnh, chọn phe
 * thắng ("Chưa chọn" / Ngỗng / Vịt / Phe thứ 3 — Phe thứ 3 thì tick người thắng trong số người đã
 * khai role phe thứ 3 ở ván đó) và Xoá ván (hỏi lại). Đổi phe thắng/người thắng → điểm mọi lần khai
 * của ván tính lại, nên làm mới các bảng điểm (`ROUND_SCORE_QUERY_KEYS`).
 *
 * Ảnh gửi dạng body thô (không multipart), thu nhỏ trong trình duyệt trước (`lib/imageResize`): ảnh
 * chính up qua route thêm ván / đổi ảnh, rồi ảnh nhỏ qua `PUT /api/admin/rounds/:id/thumbnail` (lỗi ảnh
 * nhỏ không chặn — server trả ảnh gốc thay). Lưới dùng `thumbUrl`, phóng to dùng `imageUrl`. Web chặn
 * tại chỗ ảnh sai loại, ảnh không đọc được và ảnh (sau khi thu nhỏ) quá 5 MB với đúng câu của server;
 * mọi quy tắc khác (buổi huỷ, ván đã có lần khai…) do server báo nguyên văn. Mở trang với `#van-{n}` thì
 * cuộn tới ván đó khi dữ liệu về.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type ChangeEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import type { Faction, RoleDto, RoundDto, RoundReportDto, SessionRoundsDto } from '../../shared/api-types';
import { ApiError, apiSend, apiSendFile, errorMessage } from '../api';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { Presence } from '../components/Presence';
import { QueryState } from '../components/QueryState';
import { RoundImageModal } from '../components/RoundImageModal';
import { Select, type SelectGroup } from '../components/Select';
import { WinnerChip } from '../components/WinnerChip';
import { useMe } from '../hooks/useMe';
import { cx } from '../lib/cx';
import { formatDayLabel, formatTime } from '../lib/format';
import { IMAGE_DECODE_MESSAGE, prepareRoundImage } from '../lib/imageResize';
import { rolesQuery } from '../lib/queries';
import { APPROVED_REPORTS_KEY, PENDING_REPORTS_KEY } from '../lib/queryKeys';
import { ROUND_SCORE_QUERY_KEYS, roundAnchor, sessionRoundsQuery, sessionTakesRoundReports, sessionVnDate } from '../lib/rounds';
import { Checkbox } from './admin/Controls';
import { HINT_CLASS, LABEL_CLASS } from './reportFields';
import { RoundReportForm } from './RoundReportForm';

/** Ảnh ván: PNG/JPG/WebP ≤ 5 MB sau khi thu nhỏ (server kiểm tra lại theo nội dung, cùng câu báo). */
export const ROUND_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const ROUND_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ROUND_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPE_MESSAGE = 'Chỉ nhận ảnh PNG, JPG hoặc WebP';
const IMAGE_SIZE_MESSAGE = 'Ảnh tối đa 5 MB';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';

/** Lỗi tại chỗ của một file ảnh ván (sai loại), hoặc `null` khi thu nhỏ rồi gửi được. */
export function roundImageProblem(file: File): string | null {
  return ROUND_IMAGE_TYPES.has(file.type) ? null : IMAGE_TYPE_MESSAGE;
}

/** Tiền tố khoá danh sách buổi (`['sessions', …]`) — "Ván đấu ({n})" ở Quản trị → Buổi chơi. */
const SESSIONS_KEY = ['sessions'] as const;

/**
 * Thu nhỏ ảnh ván (ảnh chính + ảnh nhỏ). Không đọc được ảnh → "Không đọc được ảnh"; ảnh chính vẫn quá
 * 5 MB → "Ảnh tối đa 5 MB" — cả hai ném `ApiError` để `errorMessage` hiện đúng câu.
 */
async function shrinkRoundImage(file: File): Promise<{ main: Blob; thumb: Blob }> {
  let prepared: { main: Blob; thumb: Blob };
  try {
    prepared = await prepareRoundImage(file);
  } catch {
    throw new ApiError('INVALID_IMAGE', IMAGE_DECODE_MESSAGE, 400);
  }
  if (prepared.main.size > ROUND_IMAGE_MAX_BYTES) throw new ApiError('INVALID_IMAGE', IMAGE_SIZE_MESSAGE, 400);
  return prepared;
}

/** Up ảnh nhỏ cho ván; lỗi thì bỏ qua (server trả ảnh gốc khi chưa có ảnh nhỏ) và giữ DTO cũ. */
async function uploadThumb(round: RoundDto, thumb: Blob): Promise<RoundDto> {
  try {
    return await apiSendFile<RoundDto>('PUT', `/api/admin/rounds/${round.id}/thumbnail`, thumb);
  } catch {
    return round;
  }
}

/** Ô chọn phe thắng: `''` = chưa chọn. */
type WinnerChoice = Faction | '';
const WINNER_GROUPS: SelectGroup<WinnerChoice>[] = [
  {
    options: [
      { value: '', label: 'Chưa chọn' },
      { value: 'goose', label: 'Ngỗng' },
      { value: 'duck', label: 'Vịt' },
      { value: 'neutral', label: 'Phe thứ 3' },
    ],
  },
];

/** Chip trạng thái nhỏ cạnh lần khai của chính mình. */
/** Phe thứ 3 thắng mà chưa tick ai → không ai được điểm (mod cần biết để tick). */
const missingNeutralWinner = (round: RoundDto) => round.winnerFaction === 'neutral' && round.winnerIds.length === 0;

/** Người khai role phe thứ 3 ở ván (chờ duyệt hoặc đã duyệt), mỗi người một dòng. */
const neutralDeclarers = (round: RoundDto) =>
  round.reports.filter((report, index, list) => report.role.faction === 'neutral' && list.findIndex((other) => other.member.id === report.member.id) === index);

const WARNING_CLASS = 'rounded-xl border-2 border-gold bg-gold/10 px-3 py-2 text-sm font-bold text-gold';

const MY_STATUS: Record<RoundReportDto['status'], { text: string; className: string }> = {
  pending: { text: 'Chờ duyệt', className: 'bg-gold text-gold-ink' },
  approved: { text: 'Đã duyệt', className: 'bg-ok text-night-950' },
};

export function SessionPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const valid = Number.isInteger(sessionId) && sessionId > 0;
  const rounds = useQuery({ ...sessionRoundsQuery(sessionId), enabled: valid });

  if (!valid) {
    return (
      <div className="mx-auto max-w-lg">
        <EmptyState>
          <p>Không tìm thấy buổi chơi</p>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <QueryState query={rounds}>{(data) => <SessionRounds data={data} />}</QueryState>
    </div>
  );
}

function SessionRounds({ data }: { data: SessionRoundsDto }) {
  const me = useMe();
  const roles = useQuery(rolesQuery);
  const staff = me.data !== undefined && me.data.accessLevel !== 'member';
  const { session, rounds } = data;
  const canReport = sessionTakesRoundReports(session);
  const { hash } = useLocation();

  // `#van-{n}`: cuộn tới ván đó khi thẻ đã vẽ (dữ liệu vừa về).
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [hash, rounds.length]);

  return (
    <>
      <header className="flex flex-col gap-2">
        {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
        <h1 className="text-raised text-3xl leading-tight font-extrabold text-white">
          Buổi <span className="tabular-nums">{formatTime(session.startsAt)}</span> · {formatDayLabel(sessionVnDate(session.startsAt))}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold text-night-200">{session.modeName}</span>
          {session.status === 'cancelled' && <span className="chip bg-duck-strong">Đã huỷ</span>}
        </div>
      </header>

      {staff && session.status !== 'cancelled' && <AddRound sessionId={session.id} />}

      {rounds.length === 0 ? (
        <EmptyState>
          <p>Buổi này chưa có ảnh ván, chờ mod up</p>
        </EmptyState>
      ) : (
        <ul aria-label="Các ván" className="grid items-start gap-4 md:grid-cols-2">
          {rounds.map((round) => (
            <li key={round.id} className="min-w-0">
              <RoundCard round={round} staff={staff} roles={roles.data} canReport={canReport} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Một ván
// ---------------------------------------------------------------------------

interface RoundCardProps {
  round: RoundDto;
  staff: boolean;
  /** Role đang bật (chưa tải xong → chưa mở được form). */
  roles: RoleDto[] | undefined;
  canReport: boolean;
}

function RoundCard({ round, staff, roles, canReport }: RoundCardProps) {
  const headingId = useId();
  const [zoom, setZoom] = useState(false);

  return (
    <article id={roundAnchor(round.number)} aria-labelledby={headingId} className="panel flex scroll-mt-20 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-xl leading-tight font-extrabold text-white">
          Ván {round.number}
        </h2>
        <WinnerChip faction={round.winnerFaction} />
        {/* Chỉ mod/admin thấy: nhắc tick người thắng phe thứ 3. */}
        {staff && missingNeutralWinner(round) && <span className="chip bg-gold px-2 py-0.5 text-xs text-gold-ink">Chưa chọn người thắng</span>}
      </div>

      <button
        type="button"
        aria-label={`Phóng to ảnh ván ${round.number}`}
        className="overflow-hidden rounded-xl border-2 border-night-700 bg-night-900 hover:border-gold"
        onClick={() => setZoom(true)}
      >
        <img src={round.thumbUrl} alt="" loading="lazy" className="aspect-video w-full object-cover" />
      </button>
      <Presence present={zoom}>
        <RoundImageModal title={`Ảnh ván ${round.number}`} src={round.imageUrl} onClose={() => setZoom(false)} />
      </Presence>

      {staff && <RoundAdmin round={round} />}

      <Declarations round={round} />
      <MyRoundReport round={round} roles={roles} canReport={canReport} />
    </article>
  );
}

/** Danh sách lần khai công khai của ván (cũ trước): avatar, tên, role; lần khai của mình có chip trạng thái. */
function Declarations({ round }: { round: RoundDto }) {
  if (round.reports.length === 0) return <p className={HINT_CLASS}>Chưa ai khai ván này</p>;
  return (
    <ul aria-label={`Lần khai ván ${round.number}`} className="flex flex-col gap-1.5">
      {round.reports.map((report) => (
        <li key={report.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Avatar name={report.member.displayName} url={report.member.avatarUrl} className="size-7 text-xs" />
          <span className="min-w-0 font-bold break-words text-white">{report.member.displayName}</span>
          <span className="min-w-0 break-words text-night-200">
            {report.role.icon} {report.role.nameVi}
          </span>
          {report.mine && <span className={cx('chip px-2 py-0.5 text-xs', MY_STATUS[report.status].className)}>{MY_STATUS[report.status].text}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Phần của người xem: nút "Khai role ván này" / "Bạn đã khai: …" + "Sửa" (còn chờ duyệt), mở form trong thẻ. */
function MyRoundReport({ round, roles, canReport }: { round: RoundDto; roles: RoleDto[] | undefined; canReport: boolean }) {
  const [open, setOpen] = useState(false);
  const mine = round.reports.find((report) => report.mine !== null)?.mine ?? null;

  if (open && roles) return <RoundReportForm round={round} roles={roles} existing={mine} onDone={() => setOpen(false)} />;
  if (mine) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-night-200">
          Bạn đã khai:{' '}
          <span className="font-bold text-white">
            {mine.role.icon} {mine.role.nameVi}
          </span>
        </p>
        {mine.status === 'pending' && canReport && (
          <button type="button" className="btn-secondary" disabled={!roles} onClick={() => setOpen(true)}>
            Sửa
          </button>
        )}
      </div>
    );
  }
  if (!canReport) return null;
  return (
    <button type="button" className="btn-primary self-start" disabled={!roles} onClick={() => setOpen(true)}>
      Khai role ván này
    </button>
  );
}

// ---------------------------------------------------------------------------
// Quản lý ván (mod/admin)
// ---------------------------------------------------------------------------

/** Thay một ván trong cache trang buổi bằng DTO server vừa trả (hoặc bỏ ván khi `round = null`). */
function useRoundCache(sessionId: number) {
  const queryClient = useQueryClient();
  const key = sessionRoundsQuery(sessionId).queryKey;
  return {
    queryClient,
    key,
    put(round: RoundDto) {
      queryClient.setQueryData<SessionRoundsDto>(key, (current) => {
        if (!current) return current;
        const exists = current.rounds.some((item) => item.id === round.id);
        const rounds = exists ? current.rounds.map((item) => (item.id === round.id ? round : item)) : [...current.rounds, round];
        return { ...current, rounds: [...rounds].sort((a, b) => a.number - b.number) };
      });
    },
    remove(roundId: number) {
      queryClient.setQueryData<SessionRoundsDto>(key, (current) => (current ? { ...current, rounds: current.rounds.filter((item) => item.id !== roundId) } : current));
    },
  };
}

/** "+ Thêm ván": ảnh kết quả (bắt buộc) + phe thắng (không bắt buộc) → ván số tiếp theo. */
function AddRound({ sessionId }: { sessionId: number }) {
  const base = useId();
  const cache = useRoundCache(sessionId);
  const [file, setFile] = useState<File | null>(null);
  const [winner, setWinner] = useState<WinnerChoice>('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const add = useMutation({
    mutationFn: async ({ image, faction }: { image: File; faction: WinnerChoice }) => {
      const { main, thumb } = await shrinkRoundImage(image);
      const round = await apiSendFile<RoundDto>('POST', `/api/admin/sessions/${sessionId}/rounds${faction ? `?winnerFaction=${faction}` : ''}`, main);
      return uploadThumb(round, thumb);
    },
    onSuccess: (round) => {
      cache.put(round);
      void cache.queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      if (round.winnerFaction !== null) for (const queryKey of ROUND_SCORE_QUERY_KEYS) void cache.queryClient.invalidateQueries({ queryKey });
      setFile(null);
      setWinner('');
      // Ô file không điều khiển được qua `value`: dựng lại để xoá tên file đã chọn.
      setInputKey((n) => n + 1);
    },
  });

  const onAdd = () => {
    if (!file) {
      setLocalError('Hãy chọn ảnh kết quả ván');
      return;
    }
    const problem = roundImageProblem(file);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    add.mutate({ image: file, faction: winner });
  };

  const error = localError ?? (add.isError ? errorMessage(add.error) : null);

  return (
    <section aria-labelledby={`${base}-title`} className="panel flex flex-col gap-3">
      <h2 id={`${base}-title`} className="text-lg font-extrabold text-white">
        Thêm ván
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${base}-image`} className={LABEL_CLASS}>
            Ảnh kết quả
          </label>
          <input
            key={inputKey}
            id={`${base}-image`}
            type="file"
            accept={ROUND_IMAGE_ACCEPT}
            className="field min-w-0"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setLocalError(null);
              add.reset();
            }}
          />
          <p className={HINT_CLASS}>PNG, JPG hoặc WebP — ảnh lớn được tự thu nhỏ</p>
        </div>
        <Select stacked label="Phe thắng" value={winner} onChange={setWinner} groups={WINNER_GROUPS} />
      </div>
      <button type="button" className="btn-primary self-start" disabled={add.isPending} onClick={onAdd}>
        {add.isPending ? 'Đang tải ảnh…' : '+ Thêm ván'}
      </button>
      {error && (
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
    </section>
  );
}

/** Quản lý một ván: phe thắng, người thắng (Phe thứ 3), đổi ảnh, xoá. */
function RoundAdmin({ round }: { round: RoundDto }) {
  const base = useId();
  const cache = useRoundCache(round.sessionId);
  const [imageError, setImageError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const refreshScores = () => {
    for (const queryKey of ROUND_SCORE_QUERY_KEYS) void cache.queryClient.invalidateQueries({ queryKey });
  };

  const patch = useMutation({
    mutationFn: (body: { winnerFaction?: Faction | null; winnerIds?: number[] }) => apiSend<RoundDto>('PATCH', `/api/admin/rounds/${round.id}`, body),
    onSuccess: (updated) => {
      cache.put(updated);
      refreshScores();
    },
    // Ván có thể vừa đổi ở nơi khác (người khai vừa đổi role, ván bị xoá…): tải lại cho đúng.
    onError: () => void cache.queryClient.invalidateQueries({ queryKey: cache.key }),
  });
  const replace = useMutation({
    mutationFn: async (file: File) => {
      const { main, thumb } = await shrinkRoundImage(file);
      const updated = await apiSendFile<RoundDto>('PUT', `/api/admin/rounds/${round.id}/image`, main);
      return uploadThumb(updated, thumb);
    },
    onSuccess: (updated) => {
      cache.put(updated);
      // Ảnh nhỏ ở Duyệt điểm lấy URL theo ván → hai danh sách lấy lại URL mới.
      void cache.queryClient.invalidateQueries({ queryKey: PENDING_REPORTS_KEY });
      void cache.queryClient.invalidateQueries({ queryKey: APPROVED_REPORTS_KEY });
    },
    onSettled: () => setInputKey((n) => n + 1),
  });
  const remove = useMutation({
    mutationFn: () => apiSend<undefined>('DELETE', `/api/admin/rounds/${round.id}`),
    onSuccess: () => {
      cache.remove(round.id);
      void cache.queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  const onImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const problem = roundImageProblem(file);
    setImageError(problem);
    replace.reset();
    if (problem) {
      setInputKey((n) => n + 1);
      return;
    }
    replace.mutate(file);
  };

  const onDelete = () => {
    if (window.confirm(`Xoá ván ${round.number}? Không hoàn tác được.`)) remove.mutate();
  };

  // Người có thể tick thắng: đã khai role phe thứ 3 ở ván này (mỗi người một dòng).
  const neutral = neutralDeclarers(round);
  const toggleWinner = (memberId: number, checked: boolean) => {
    const next = checked ? [...round.winnerIds, memberId] : round.winnerIds.filter((item) => item !== memberId);
    patch.mutate({ winnerIds: next });
  };

  const busy = patch.isPending || replace.isPending || remove.isPending;
  const error =
    imageError ?? (patch.isError ? errorMessage(patch.error) : replace.isError ? errorMessage(replace.error) : remove.isError ? errorMessage(remove.error) : null);

  return (
    <div role="group" aria-label={`Quản lý ván ${round.number}`} className="panel-inset flex flex-col gap-3">
      <Select
        stacked
        label="Phe thắng"
        value={round.winnerFaction ?? ''}
        onChange={(next) => {
          if (next === (round.winnerFaction ?? '')) return;
          // Đổi sang Phe thứ 3 mà chỉ một người khai role phe thứ 3 → tick sẵn người đó (hay bị quên).
          const only = next === 'neutral' && neutral.length === 1 ? neutral[0] : undefined;
          patch.mutate(only ? { winnerFaction: 'neutral', winnerIds: [only.member.id] } : { winnerFaction: next === '' ? null : next });
        }}
        groups={WINNER_GROUPS}
        disabled={patch.isPending}
      />
      {missingNeutralWinner(round) && (
        <p role="status" className={WARNING_CLASS}>
          {neutral.length === 0 ? 'Chưa ai khai role phe thứ 3 ở ván này.' : 'Chưa chọn người thắng — phe thứ 3 chưa ai được điểm. Tick người thắng bên dưới.'}
        </p>
      )}
      {round.winnerFaction === 'neutral' && neutral.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className={cx(LABEL_CLASS, 'mb-1')}>Người thắng (Phe thứ 3)</legend>
          {neutral.map((report) => (
            <Checkbox
              key={report.member.id}
              id={`${base}-winner-${report.member.id}`}
              checked={round.winnerIds.includes(report.member.id)}
              disabled={busy}
              onChange={(event) => toggleWinner(report.member.id, event.target.checked)}
            >
              <span className="text-sm text-white">
                {report.member.displayName} ({report.role.icon} {report.role.nameVi})
              </span>
            </Checkbox>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        {/* Nút "Đổi ảnh" là nhãn của ô file ẩn: bấm (hay Enter/Space trên ô) mở bộ chọn tệp. */}
        <label className={cx('btn-secondary cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-gold', busy && 'pointer-events-none opacity-60')}>
          {replace.isPending ? 'Đang tải ảnh…' : 'Đổi ảnh'}
          <input key={inputKey} type="file" accept={ROUND_IMAGE_ACCEPT} className="sr-only" disabled={busy} onChange={onImage} />
        </label>
        <button type="button" className="btn-danger" disabled={busy} onClick={onDelete}>
          {remove.isPending ? 'Đang xoá…' : 'Xoá ván'}
        </button>
      </div>
      {error && (
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
    </div>
  );
}
