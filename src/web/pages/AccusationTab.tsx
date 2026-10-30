/**
 * Tab "Báo cáo người chơi" của trang Khai điểm (spec 2026-10-31 §B): form báo cáo một người chơi
 * sai luật — "Ngày chơi" và "Buổi" chọn sẵn theo mặc định (§A, `useReportDay`), bốn ô chọn
 * (`AccusationPickers`), "Ghi chú" ≤ 300 — gửi `POST /api/accusations`; dưới form là "Báo cáo của
 * tôi" (mới nhất trước) với trạng thái nguyên văn của spec và ghi chú khi báo cáo trùng vụ với một
 * báo cáo khác đang chờ.
 *
 * Form chỉ chặn tại chỗ khi thiếu một trong bốn trường; mọi luật khác (cửa sổ 3 ngày, tự báo cáo,
 * tối đa 10 báo cáo mỗi ngày…) do server báo và lời báo hiện nguyên văn. Báo cáo vừa gửi được ghi
 * thẳng vào cache "Báo cáo của tôi" (DTO server trả); vụ đã bị trừ điểm thì server lưu thẳng thành
 * "Đã có người báo cáo trước" và form nói luôn điều đó thay cho "chờ mod duyệt".
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { RoleDto, StandaloneAccusationDto, StandaloneAccusationInputDto } from '../../shared/api-types';
import { apiSend, errorMessage } from '../api';
import { AccusationPickers, EMPTY_ACCUSATION_DRAFT, parseAccusationDraft, type AccusationDraft } from '../components/AccusationFields';
import { EmptyState } from '../components/EmptyState';
import { QueryState } from '../components/QueryState';
import { DUPLICATE_NOTE, formatStandaloneLine, standaloneStatusText } from '../lib/accusations';
import { sessionText } from '../lib/bounties';
import { formatDateLabel, vnTodayIso } from '../lib/format';
import { myAccusationsQuery } from '../lib/queries';
import { MY_ACCUSATIONS_KEY, PENDING_ACCUSATIONS_KEY } from '../lib/queryKeys';
import { DateField, HINT_CLASS, NoteField, SessionField, useReportDay } from './reportFields';

/** Gợi ý điểm dưới form (spec §B, nguyên văn). */
export const ACCUSATION_HINT = 'Báo cáo đúng: bạn +1 điểm (Tổng cả 3 phe), người bị báo cáo bị trừ điểm phạt của role đó.';
const SUCCESS_MESSAGE = 'Đã gửi, chờ mod duyệt';
const SUPERSEDED_MESSAGE = 'Đã gửi — vụ này đã có người báo cáo trước';

/** Màu dòng trạng thái: chờ = xám, đúng = xanh, còn lại (bác / trùng / huỷ) = đỏ nhạt. */
const STATUS_CLASS: Record<StandaloneAccusationDto['status'], string> = {
  pending: 'text-night-300',
  approved: 'text-ok',
  rejected: 'text-duck-soft',
  superseded: 'text-duck-soft',
  revoked: 'text-duck-soft',
};

export function AccusationTab({ roles }: { roles: RoleDto[] }) {
  const mine = useQuery(myAccusationsQuery);
  return (
    <>
      <section className="panel flex flex-col gap-3">
        <h2 className="text-xl leading-tight font-extrabold text-white">Báo cáo một người chơi</h2>
        <AccusationForm roles={roles} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl leading-tight font-extrabold text-white">Báo cáo của tôi</h2>
        <QueryState query={mine}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>
                <p>Bạn chưa gửi báo cáo người chơi nào</p>
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {list.map((accusation) => (
                  <MyStandaloneAccusation key={accusation.id} accusation={accusation} />
                ))}
              </ul>
            )
          }
        </QueryState>
      </section>
    </>
  );
}

function AccusationForm({ roles }: { roles: RoleDto[] }) {
  const queryClient = useQueryClient();
  const base = useId();
  const ids = { date: `${base}-date`, session: `${base}-session`, note: `${base}-note` };
  const today = vnTodayIso();
  const day = useReportDay();
  const [draft, setDraft] = useState<AccusationDraft>(EMPTY_ACCUSATION_DRAFT);
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: (body: StandaloneAccusationInputDto) => apiSend<StandaloneAccusationDto>('POST', '/api/accusations', body),
    onSuccess: (created) => {
      queryClient.setQueryData<StandaloneAccusationDto[]>(MY_ACCUSATIONS_KEY, (current) => [created, ...(current ?? [])]);
      // Người gửi là mod đang mở cùng phiên: hàng chờ Duyệt điểm phải thấy báo cáo mới.
      void queryClient.invalidateQueries({ queryKey: PENDING_ACCUSATIONS_KEY });
      setDraft(EMPTY_ACCUSATION_DRAFT);
      setNote('');
    },
  });

  /** Người dùng sửa gì đó: bỏ thông báo của lần gửi trước. */
  const touch = () => {
    setLocalError(null);
    if (submit.isError || submit.isSuccess) submit.reset();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseAccusationDraft(draft);
    if (parsed.error !== null) {
      setLocalError(parsed.error);
      return;
    }
    setLocalError(null);
    const trimmedNote = note.trim();
    submit.mutate({
      playedOn: day.playedOn,
      ...(day.sessionId !== '' ? { sessionId: Number(day.sessionId) } : {}),
      ...(trimmedNote !== '' ? { note: trimmedNote } : {}),
      ...parsed.input,
    });
  };

  const error = localError ?? (submit.isError ? errorMessage(submit.error) : null);
  const success = submit.data ? (submit.data.status === 'superseded' ? SUPERSEDED_MESSAGE : SUCCESS_MESSAGE) : null;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* Báo cáo không nhân điểm: không có dòng "Ngày này điểm cộng ×m". */}
      <DateField
        id={ids.date}
        today={today}
        value={day.playedOn}
        multiplier={1}
        onChange={(next) => {
          day.setPlayedOn(next);
          touch();
        }}
      />
      <SessionField
        id={ids.session}
        day={day.day}
        value={day.sessionId}
        loadError="Không tải được danh sách buổi, bạn vẫn báo cáo được không kèm buổi"
        onChange={(next) => {
          day.setSessionId(next);
          touch();
        }}
      />
      <AccusationPickers
        roles={roles}
        draft={draft}
        onDraftChange={(next) => {
          setDraft(next);
          touch();
        }}
      />
      <NoteField
        id={ids.note}
        value={note}
        onChange={(next) => {
          setNote(next);
          touch();
        }}
      />

      <div className="flex flex-col gap-2">
        <p className={HINT_CLASS}>{ACCUSATION_HINT}</p>
        <button type="submit" className="btn-primary w-full sm:w-auto sm:self-start" disabled={submit.isPending}>
          {submit.isPending ? 'Đang gửi…' : 'Gửi báo cáo'}
        </button>
        {error && (
          <p role="alert" className="text-sm font-bold text-duck-soft">
            {error}
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-5 text-sm font-bold text-ok">
          {success}
        </p>
      </div>
    </form>
  );
}

/** Một dòng "Báo cáo của tôi": tóm tắt vụ, ngày chơi, buổi (nếu có), ghi chú, trạng thái, ghi chú trùng vụ. */
function MyStandaloneAccusation({ accusation }: { accusation: StandaloneAccusationDto }) {
  return (
    <li className="panel flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 font-bold break-words text-white">{formatStandaloneLine(accusation)}</span>
        <time dateTime={accusation.playedOn} className="ml-auto text-sm text-night-300 tabular-nums">
          {formatDateLabel(accusation.playedOn)}
        </time>
      </div>
      {accusation.session && <p className={HINT_CLASS}>Buổi {sessionText(accusation.session)}</p>}
      {accusation.note && <p className="text-sm break-words text-night-200">{accusation.note}</p>}
      <p className={`text-sm font-bold break-words ${STATUS_CLASS[accusation.status]}`}>{standaloneStatusText(accusation)}</p>
      {/* Ghi chú trùng vụ chỉ có nghĩa khi báo cáo còn chờ. */}
      {accusation.duplicate && accusation.status === 'pending' && <p className={HINT_CLASS}>{DUPLICATE_NOTE}</p>}
    </li>
  );
}
