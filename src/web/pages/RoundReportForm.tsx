/**
 * Form "Khai role ván này" (spec ván §5) — dùng ở trang buổi `/buoi/:id` và trang Khai điểm: role
 * (`Select` có ô tìm, nhóm theo phe), chỉ số chính / phụ / phạt như form khai theo ngày (cùng các ô ở
 * `reportFields.tsx`), ghi chú; "Gửi" → `POST /api/rounds/:id/reports`. Có `existing` (lần khai của
 * mình còn chờ duyệt) thì là form sửa: "Lưu" → `PATCH /api/reports/:id` với role, chỉ số và ghi chú —
 * không bao giờ gửi ván, ngày hay buổi (server cố định theo ván).
 *
 * Gửi xong: lần khai vừa tạo được thêm thẳng vào danh sách công khai của ván trong cache (không chờ
 * tải lại), rồi làm mới ván của buổi, "Lần khai của tôi" và hàng chờ Duyệt điểm. Lỗi của server (đã
 * khai ván này, ván không còn nhận khai, giới hạn chỉ số…) hiện nguyên văn.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { ReportDto, RoleDto, RoundDto, RoundReportDto, RoundReportInput, SessionRoundsDto } from '../../shared/api-types';
import { hasExtraMetric, hasPenaltyMetric } from '../../shared/metric';
import { ApiError, apiSend, errorMessage } from '../api';
import { Select, type SelectGroup } from '../components/Select';
import { FACTIONS, FACTION_SHORT_LABEL, FACTION_TEXT } from '../lib/factions';
import { MY_REPORTS_KEY, PENDING_REPORTS_KEY } from '../lib/queryKeys';
import { sessionRoundsQuery } from '../lib/rounds';
import { ExtraField, HINT_CLASS, LABEL_CLASS, NoteField, OPTIONAL_METRIC_DEFAULT, PenaltyField, mainHint, parseExtraValue, parsePenaltyValue, type FormRole } from './reportFields';

const ROLE_SEARCH = { label: 'Tìm role', placeholder: 'Tìm role…', empty: 'Không có role nào khớp' };
/** Mã lỗi cho biết ván đang xem đã cũ (đã khai ở nơi khác, ván hết hạn/bị xoá, lần khai vừa được duyệt). */
const STALE_ROUND_CODES = new Set(['ROUND_REPORT_DUPLICATE', 'ROUND_REPORT_CLOSED', 'NOT_PENDING', 'NOT_FOUND']);

/** Nhóm role theo phe cho ô chọn (chỉ nhóm còn role). */
export function roleGroups(roles: readonly RoleDto[]): SelectGroup<number>[] {
  return FACTIONS.map((faction) => ({
    label: FACTION_SHORT_LABEL[faction],
    labelClassName: FACTION_TEXT[faction],
    options: roles
      .filter((role) => role.active && role.faction === faction)
      .map((role) => ({ value: role.id, label: `${role.icon} ${role.nameVi}`, searchText: [role.nameVi, role.nameEn, role.key.replaceAll('_', ' ')] })),
  })).filter((group) => group.options.length > 0);
}

interface RoundReportFormProps {
  round: RoundDto;
  roles: readonly RoleDto[];
  /** Lần khai còn chờ duyệt của chính mình ở ván này → form sửa. */
  existing?: ReportDto | null;
  /** Gửi/lưu xong hoặc bấm Huỷ. */
  onDone: () => void;
}

/** Lần khai vừa tạo → dòng trong danh sách công khai của ván (server trả bản đầy đủ khi tải lại). */
function toRoundReport(report: ReportDto, role: RoleDto | undefined): RoundReportDto {
  return {
    id: report.id,
    member: { id: report.member.id, displayName: report.member.displayName, avatarUrl: null },
    role: { id: report.role.id, nameVi: report.role.nameVi, icon: report.role.icon, faction: role?.faction ?? 'goose' },
    status: 'pending',
    won: report.round?.won ?? false,
    mine: report,
  };
}

export function RoundReportForm({ round, roles, existing = null, onDone }: RoundReportFormProps) {
  const queryClient = useQueryClient();
  const base = useId();
  const roundsKey = sessionRoundsQuery(round.sessionId).queryKey;

  const [roleId, setRoleId] = useState<number>(existing?.role.id ?? 0);
  // Mọi ô số bắt đầu bằng 0 (form sửa: giá trị đã khai) — không gõ gì vẫn gửi được 0.
  const [value, setValue] = useState(existing ? String(existing.value) : OPTIONAL_METRIC_DEFAULT);
  const [extraValue, setExtraValue] = useState(existing ? String(existing.extraValue) : OPTIONAL_METRIC_DEFAULT);
  const [penaltyValue, setPenaltyValue] = useState(existing ? String(existing.penaltyValue) : OPTIONAL_METRIC_DEFAULT);
  const [note, setNote] = useState(existing?.note ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  // Role đang chọn: trong danh sách role đang bật; form sửa giữ được role cũ dù role đó vừa bị tắt.
  const listed = roles.find((item) => item.id === roleId);
  const role: FormRole | null = listed ?? (existing && existing.role.id === roleId ? existing.role : null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: roundsKey });
    void queryClient.invalidateQueries({ queryKey: MY_REPORTS_KEY });
    void queryClient.invalidateQueries({ queryKey: PENDING_REPORTS_KEY });
  };

  const submit = useMutation({
    mutationFn: (body: RoundReportInput) =>
      existing
        ? apiSend<ReportDto>('PATCH', `/api/reports/${existing.id}`, body)
        : apiSend<ReportDto>('POST', `/api/rounds/${round.id}/reports`, body),
    onSuccess: (report) => {
      if (!existing) {
        queryClient.setQueryData<SessionRoundsDto>(roundsKey, (current) =>
          current
            ? { ...current, rounds: current.rounds.map((item) => (item.id === round.id ? { ...item, reports: [...item.reports, toRoundReport(report, listed)] } : item)) }
            : current,
        );
      }
      refresh();
      onDone();
    },
    onError: (error) => {
      if (error instanceof ApiError && STALE_ROUND_CODES.has(error.code)) void queryClient.invalidateQueries({ queryKey: roundsKey });
    },
  });

  const touch = () => {
    setLocalError(null);
    if (submit.isError) submit.reset();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!role) {
      setLocalError('Hãy chọn role');
      return;
    }
    if (value.trim() === '') {
      setLocalError(`Hãy nhập ${role.metricLabel}`);
      return;
    }
    const extra = parseExtraValue(extraValue, role);
    if (extra.error !== null) {
      setLocalError(extra.error);
      return;
    }
    const penalty = parsePenaltyValue(penaltyValue, role);
    if (penalty.error !== null) {
      setLocalError(penalty.error);
      return;
    }
    setLocalError(null);
    const trimmed = note.trim();
    if (existing) {
      // Sửa: luôn gửi đủ chỉ số phụ/phạt (0 khi role mới không có) để không còn giá trị của role cũ.
      submit.mutate({ roleId, value: Number(value), extraValue: extra.value, penaltyValue: penalty.value, note: trimmed === '' ? null : trimmed });
      return;
    }
    submit.mutate({
      roleId,
      value: Number(value),
      ...(hasExtraMetric(role) ? { extraValue: extra.value } : {}),
      ...(hasPenaltyMetric(role) ? { penaltyValue: penalty.value } : {}),
      ...(trimmed !== '' ? { note: trimmed } : {}),
    });
  };

  const error = localError ?? (submit.isError ? errorMessage(submit.error) : null);

  return (
    <form noValidate aria-label={existing ? `Sửa lần khai ván ${round.number}` : `Khai role ván ${round.number}`} onSubmit={onSubmit} className="panel-inset flex flex-col gap-3">
      <Select
        stacked
        label="Role"
        placeholder="Chọn role…"
        value={roleId}
        onChange={(next) => {
          setRoleId(next);
          // Chỉ số của role trước không có nghĩa với role mới: mọi ô số về 0.
          setValue(OPTIONAL_METRIC_DEFAULT);
          setExtraValue(OPTIONAL_METRIC_DEFAULT);
          setPenaltyValue(OPTIONAL_METRIC_DEFAULT);
          touch();
        }}
        groups={roleGroups(roles)}
        search={ROLE_SEARCH}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={`${base}-value`} className={LABEL_CLASS}>
          {role ? role.metricLabel : 'Giá trị'}
        </label>
        <input
          id={`${base}-value`}
          type="number"
          inputMode="numeric"
          min={0}
          max={role?.maxPerGame}
          step={1}
          className="field"
          value={value}
          disabled={!role}
          onChange={(event) => {
            setValue(event.target.value);
            touch();
          }}
        />
        <p className={HINT_CLASS}>{role ? mainHint(role) : 'Chọn role để biết chỉ số cần khai'}</p>
      </div>

      {role && hasExtraMetric(role) && (
        <ExtraField
          id={`${base}-extra`}
          role={role}
          value={extraValue}
          onChange={(next) => {
            setExtraValue(next);
            touch();
          }}
        />
      )}
      {role && hasPenaltyMetric(role) && (
        <PenaltyField
          id={`${base}-penalty`}
          role={role}
          value={penaltyValue}
          onChange={(next) => {
            setPenaltyValue(next);
            touch();
          }}
        />
      )}

      <NoteField
        id={`${base}-note`}
        value={note}
        onChange={(next) => {
          setNote(next);
          touch();
        }}
      />

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={submit.isPending}>
          {submit.isPending ? 'Đang gửi…' : existing ? 'Lưu' : 'Gửi'}
        </button>
        <button type="button" className="btn-secondary" disabled={submit.isPending} onClick={onDone}>
          Huỷ
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-bold text-duck-soft">
          {error}
        </p>
      )}
    </form>
  );
}
