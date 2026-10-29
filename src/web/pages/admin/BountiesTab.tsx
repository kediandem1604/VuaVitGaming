/**
 * Tab Treo thưởng (spec treo thưởng §5, mod và admin): form thêm mục và danh sách mục — đang bật
 * trước, rồi đã tắt. Mỗi dòng: `{icon role} {tên}` hoặc "Mọi role", `+{điểm}`, phạm vi ("Mọi buổi" /
 * "Buổi {giờ} {ngày} — {chế độ}"), số lần nhận đã duyệt, nút Sửa, Tắt/Bật và — chỉ khi chưa có lần
 * nhận đã duyệt — Xoá (hỏi lại trước khi gửi; mục còn lần nhận chờ/bị từ chối thì server trả 409
 * `BOUNTY_HAS_CLAIMS`, lời nhắn hiện dưới dòng).
 *
 * Form (thêm và sửa dùng chung): "Tên" (bắt buộc), "Mô tả" (tuỳ chọn), "Điểm" (1–50), "Role" (`Select`
 * có tìm, nhóm theo phe, dòng đầu "Không gắn role"), "Áp dụng cho" ("Mọi buổi" hoặc một buổi chưa kết
 * thúc / kết thúc hôm nay — lấy từ danh sách buổi của hôm nay và `LOOKAHEAD_DAYS` ngày tới, cùng
 * khoá cache với tab Buổi chơi). Sửa thì buổi đang gắn luôn có trong danh sách dù đã qua.
 *
 * Mọi thay đổi làm mới danh sách và thẻ treo thưởng ở trang Hôm nay (`SESSION_BOUNTIES_KEY`).
 */

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { BountyDto, BountyInput, BountyPatch, RoleDto, SessionDto } from '../../../shared/api-types';
import { apiGet, apiSend, errorMessage } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { QueryState } from '../../components/QueryState';
import { Select, type SelectGroup } from '../../components/Select';
import { bountyIcon, bountyScopeText, sessionText } from '../../lib/bounties';
import { cx } from '../../lib/cx';
import { FACTIONS, FACTION_SHORT_LABEL, FACTION_TEXT } from '../../lib/factions';
import { addDaysIso, vnTodayIso } from '../../lib/format';
import { useStaggerOnce } from '../../lib/motion';
import { rolesQuery } from '../../lib/queries';
import { ADMIN_BOUNTIES_KEY, SESSION_BOUNTIES_KEY } from '../../lib/queryKeys';
import { Chip } from './Chip';

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 200;
const POINTS_MIN = 1;
const POINTS_MAX = 50;
/** Số ngày tới (sau hôm nay) lấy buổi cho ô "Áp dụng cho". */
const LOOKAHEAD_DAYS = 6;
/** Giá trị "không chọn" của hai ô chọn: "Không gắn role" / "Mọi buổi". */
const NONE = 0;

const H2_CLASS = 'text-xl leading-tight font-extrabold text-white';
const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';

const ROLE_SEARCH = { label: 'Tìm role', placeholder: 'Tìm role…', empty: 'Không có role nào khớp' };
const SESSION_SEARCH = { label: 'Tìm buổi', placeholder: 'Tìm buổi…', empty: 'Không có buổi nào khớp' };

interface BountyValues {
  title: string;
  description: string;
  /** Chuỗi của ô số; kiểm tra lúc gửi. */
  points: string;
  roleId: number;
  sessionId: number;
}

/** Một buổi chọn được cho "Áp dụng cho". */
interface SessionOption {
  id: number;
  startsAt: string;
  modeName: string;
}

/** Làm mới danh sách mục và thẻ treo thưởng của các buổi (trang Hôm nay). */
function useRefreshBounties() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ADMIN_BOUNTIES_KEY });
    void queryClient.invalidateQueries({ queryKey: SESSION_BOUNTIES_KEY });
  };
}

/** Đang bật trước, rồi đã tắt; trong mỗi nhóm giữ thứ tự của server. */
function sortBounties(list: BountyDto[]): BountyDto[] {
  return [...list.filter((bounty) => bounty.active), ...list.filter((bounty) => !bounty.active)];
}

/**
 * Buổi chọn được: buổi chưa kết thúc (`scheduled`) từ hôm nay tới `LOOKAHEAD_DAYS` ngày sau, cùng buổi
 * đã kết thúc hôm nay (server cũng chỉ nhận hai loại này), theo giờ bắt đầu.
 */
function useSessionOptions(): SessionOption[] {
  const today = vnTodayIso();
  const dates = Array.from({ length: LOOKAHEAD_DAYS + 1 }, (_, offset) => addDaysIso(today, offset));
  const results = useQueries({
    // Cùng khoá với tab Buổi chơi (`['sessions', 'date', ngày]`): tạo/sửa buổi ở đó làm mới cả ở đây.
    queries: dates.map((date) => ({ queryKey: ['sessions', 'date', date], queryFn: () => apiGet<SessionDto[]>(`/api/sessions?date=${date}`) })),
  });
  return results
    .flatMap((result, index) =>
      (result.data ?? []).filter((session) => session.status === 'scheduled' || (session.status === 'ended' && dates[index] === today)),
    )
    .map(({ id, startsAt, modeName }) => ({ id, startsAt, modeName }))
    // Mỗi buổi một dòng (phòng khi hai ngày trả về cùng một buổi).
    .filter((session, index, all) => all.findIndex((other) => other.id === session.id) === index)
    .sort((x, y) => x.startsAt.localeCompare(y.startsAt));
}

export function BountiesTab() {
  const bounties = useQuery({ queryKey: ADMIN_BOUNTIES_KEY, queryFn: () => apiGet<BountyDto[]>('/api/admin/bounties') });
  const roles = useQuery(rolesQuery);
  const sessions = useSessionOptions();
  const headingId = useId();
  const stagger = useStaggerOnce((bounties.data?.length ?? 0) > 0);

  return (
    <>
      <CreateBounty roles={roles.data ?? []} sessions={sessions} />
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <h2 id={headingId} className={H2_CLASS}>
          Mục treo thưởng
        </h2>
        <QueryState query={bounties}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>
                <p>Chưa có mục treo thưởng nào</p>
              </EmptyState>
            ) : (
              <ul className={cx('panel flex flex-col divide-y divide-night-700 p-0', stagger)}>
                {sortBounties(list).map((bounty) => (
                  <BountyRow key={bounty.id} bounty={bounty} roles={roles.data ?? []} sessions={sessions} />
                ))}
              </ul>
            )
          }
        </QueryState>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Thêm
// ---------------------------------------------------------------------------

function CreateBounty({ roles, sessions }: { roles: RoleDto[]; sessions: SessionOption[] }) {
  const refresh = useRefreshBounties();
  const create = useMutation({
    mutationFn: (body: BountyInput) => apiSend<BountyDto>('POST', '/api/admin/bounties', body),
    onSuccess: refresh,
  });

  return (
    <section className="panel flex flex-col gap-3">
      <h2 className={H2_CLASS}>Thêm treo thưởng</h2>
      {/* `key` theo mục vừa tạo: thêm xong thì form dựng lại trống. */}
      <BountyForm
        key={create.data?.id ?? 'new'}
        formLabel="Thêm treo thưởng"
        roles={roles}
        sessions={sessions}
        initial={{ title: '', description: '', points: '', roleId: NONE, sessionId: NONE }}
        submitLabel="Thêm treo thưởng"
        pending={create.isPending}
        error={create.isError ? errorMessage(create.error) : null}
        success={create.isSuccess ? `Đã thêm “${create.data.title}”` : null}
        onChange={() => {
          if (create.isError || create.isSuccess) create.reset();
        }}
        onSubmit={(input) => create.mutate(input)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Một mục: Sửa, Tắt/Bật, Xoá
// ---------------------------------------------------------------------------

function BountyRow({ bounty, roles, sessions }: { bounty: BountyDto; roles: RoleDto[]; sessions: SessionOption[] }) {
  const queryClient = useQueryClient();
  const refresh = useRefreshBounties();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const patch = useMutation({
    mutationFn: (body: BountyPatch) => apiSend<BountyDto>('PATCH', `/api/admin/bounties/${bounty.id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<BountyDto[]>(ADMIN_BOUNTIES_KEY, (current) => current?.map((item) => (item.id === updated.id ? updated : item)));
      refresh();
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => apiSend<undefined>('DELETE', `/api/admin/bounties/${bounty.id}`),
    onSuccess: () => {
      queryClient.setQueryData<BountyDto[]>(ADMIN_BOUNTIES_KEY, (current) => current?.filter((item) => item.id !== bounty.id));
      refresh();
    },
    onSettled: () => setConfirmingDelete(false),
  });

  // Buổi đang gắn luôn chọn lại được (kể cả khi đã qua khỏi danh sách buổi chọn được).
  const sessionChoices = bounty.session && !sessions.some((item) => item.id === bounty.session?.id) ? [bounty.session, ...sessions] : sessions;
  const rowError = patch.isError && !editing ? errorMessage(patch.error) : remove.isError ? errorMessage(remove.error) : null;
  const busy = patch.isPending || remove.isPending;

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 text-base font-bold break-words text-white">{bounty.title}</span>
        <span className="chip bg-gold px-2.5 py-0.5 text-gold-ink tabular-nums">{`+${bounty.points}`}</span>
        {!bounty.active && <Chip tone="duck">Đã tắt</Chip>}
      </div>
      {bounty.description && !editing && <p className="break-words text-night-200">{bounty.description}</p>}
      <p className="text-night-300">
        {bounty.role ? `${bountyIcon(bounty.role)} ${bounty.role.nameVi}` : 'Mọi role'} · {bountyScopeText(bounty)} · {`${bounty.approvedClaims} lần nhận đã duyệt`}
      </p>

      {editing ? (
        <BountyForm
          formLabel={`Sửa ${bounty.title}`}
          roles={roles}
          sessions={sessionChoices}
          initial={{
            title: bounty.title,
            description: bounty.description ?? '',
            points: String(bounty.points),
            roleId: bounty.role?.id ?? NONE,
            sessionId: bounty.session?.id ?? NONE,
          }}
          submitLabel="Lưu"
          pending={patch.isPending}
          error={patch.isError ? errorMessage(patch.error) : null}
          success={null}
          onCancel={() => {
            patch.reset();
            setEditing(false);
          }}
          onChange={() => {
            if (patch.isError) patch.reset();
          }}
          onSubmit={(input) => patch.mutate(input)}
        />
      ) : confirmingDelete ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-white">Xoá mục này?</span>
          <button type="button" className="btn-danger" disabled={busy} onClick={() => remove.mutate()}>
            {remove.isPending ? 'Đang xoá…' : 'Xác nhận xoá'}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmingDelete(false)}>
            Thôi
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              patch.reset();
              remove.reset();
              setEditing(true);
            }}
          >
            Sửa
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => patch.mutate({ active: !bounty.active })}>
            {bounty.active ? 'Tắt' : 'Bật'}
          </button>
          {bounty.approvedClaims === 0 && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                remove.reset();
                setConfirmingDelete(true);
              }}
            >
              Xoá
            </button>
          )}
        </div>
      )}
      {rowError && (
        <p role="alert" className={ERROR_CLASS}>
          {rowError}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Form dùng chung cho thêm và sửa
// ---------------------------------------------------------------------------

interface BountyFormProps {
  formLabel: string;
  roles: RoleDto[];
  sessions: SessionOption[];
  initial: BountyValues;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  success: string | null;
  onChange: () => void;
  /** Nhận thân đã kiểm tra: tên/mô tả đã cắt khoảng trắng, mô tả rỗng → `null`. */
  onSubmit: (input: BountyInput) => void;
  onCancel?: () => void;
}

function roleGroups(roles: RoleDto[]): SelectGroup<number>[] {
  return [
    { options: [{ value: NONE, label: 'Không gắn role' }] },
    ...FACTIONS.map((faction) => ({
      label: FACTION_SHORT_LABEL[faction],
      labelClassName: FACTION_TEXT[faction],
      options: roles
        .filter((role) => role.faction === faction)
        .map((role) => ({ value: role.id, label: `${role.icon} ${role.nameVi}`, searchText: [role.nameVi, role.nameEn] })),
    })).filter((group) => group.options.length > 0),
  ];
}

function sessionGroups(sessions: SessionOption[]): SelectGroup<number>[] {
  return [{ options: [{ value: NONE, label: 'Mọi buổi' }, ...sessions.map((session) => ({ value: session.id, label: sessionText(session) }))] }];
}

function BountyForm({ formLabel, roles, sessions, initial, submitLabel, pending, error, success, onChange, onSubmit, onCancel }: BountyFormProps) {
  const id = useId();
  const [values, setValues] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);

  const update = (next: Partial<BountyValues>) => {
    setValues((current) => ({ ...current, ...next }));
    setLocalError(null);
    onChange();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = values.title.trim();
    if (title === '') return setLocalError('Tên không được để trống');
    const points = Number(values.points);
    if (values.points.trim() === '' || !Number.isInteger(points) || points < POINTS_MIN || points > POINTS_MAX) return setLocalError(`Điểm phải từ ${POINTS_MIN} đến ${POINTS_MAX}`);
    setLocalError(null);
    const description = values.description.trim();
    onSubmit({
      title,
      description: description === '' ? null : description,
      points,
      roleId: values.roleId === NONE ? null : values.roleId,
      sessionId: values.sessionId === NONE ? null : values.sessionId,
    });
  };

  const shownError = localError ?? error;

  return (
    <form noValidate aria-label={formLabel} onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={`${id}-title`} className={LABEL_CLASS}>
          Tên
        </label>
        <input id={`${id}-title`} type="text" maxLength={TITLE_MAX} className="field" value={values.title} onChange={(e) => update({ title: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${id}-description`} className={LABEL_CLASS}>
            Mô tả
          </label>
          <span className={cx(HINT_CLASS, 'tabular-nums')}>
            {values.description.length}/{DESCRIPTION_MAX}
          </span>
        </div>
        <input
          id={`${id}-description`}
          type="text"
          maxLength={DESCRIPTION_MAX}
          className="field"
          value={values.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-points`} className={LABEL_CLASS}>
          Điểm
        </label>
        <input
          id={`${id}-points`}
          type="number"
          inputMode="numeric"
          min={POINTS_MIN}
          max={POINTS_MAX}
          className="field"
          value={values.points}
          onChange={(e) => update({ points: e.target.value })}
        />
        <p className={HINT_CLASS}>{`Từ ${POINTS_MIN} đến ${POINTS_MAX}.`}</p>
      </div>
      <Select stacked label="Role" value={values.roleId} onChange={(roleId) => update({ roleId })} groups={roleGroups(roles)} search={ROLE_SEARCH} />
      <Select
        stacked
        className="sm:col-span-2"
        label="Áp dụng cho"
        value={values.sessionId}
        onChange={(sessionId) => update({ sessionId })}
        groups={sessionGroups(sessions)}
        search={SESSION_SEARCH}
      />
      <div className="flex flex-col gap-2 sm:col-span-2">
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? 'Đang lưu…' : submitLabel}
          </button>
          {onCancel && (
            <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>
              Huỷ
            </button>
          )}
        </div>
        {shownError && (
          <p role="alert" className={ERROR_CLASS}>
            {shownError}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm font-bold text-ok">
            {success}
          </p>
        )}
      </div>
    </form>
  );
}
