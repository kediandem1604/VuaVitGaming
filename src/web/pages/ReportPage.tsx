/**
 * Trang Khai điểm (spec §4.6, §6): form khai một trận — tìm role (không phân biệt dấu,
 * `normalizeText` dùng chung với lệnh slash), giá trị có `max` = `maxPerGame` và nhãn
 * = `metricLabel` của role, ngày chơi trong [hôm nay − 3, hôm nay] giờ VN, buổi của
 * ngày đó (không bắt buộc), ghi chú ≤ 300 ký tự — rồi "Lần khai của tôi" với trạng
 * thái và ô sửa cho lần khai còn chờ duyệt, kèm mục con "Treo thưởng của tôi" (spec treo thưởng §6).
 *
 * Giao diện Sảnh đêm: mỗi gợi ý role có nhân vật thu nhỏ (không bảng tên, chỉ trang trí) +
 * tên role + chip phe; role đã chọn hiện thành thẻ nhỏ có nhân vật; chip trạng thái lần khai: chờ
 * duyệt `gold`, đã duyệt `ok`, bị từ chối `duck-soft`.
 *
 * Form chỉ chặn tại chỗ hai lỗi hiển nhiên (chưa chọn role, chưa nhập giá trị), chỉ số phụ và
 * chỉ số phạt ngoài giới hạn, và file highlight sai loại/quá
 * cỡ; mọi quy tắc khác (giới hạn của chỉ số chính, cửa sổ 3 ngày, mùa đã chốt…) do server báo
 * và thông báo của server được hiện nguyên văn. Lần khai vừa tạo/sửa được ghi thẳng vào cache
 * danh sách (dùng DTO server trả về) thay vì tải lại.
 *
 * Chỉ số phụ (spec chỉ số phụ §6–7): role có chỉ số phụ thì form khai và form sửa có ô thứ hai
 * (nhãn = `extraMetricLabel`, gợi ý "Tối đa N mỗi trận · +P điểm mỗi lần", mặc định 0) gửi
 * thành `extraValue`; role không có thì không gửi trường này. Chỉ số phạt (spec điểm role §5)
 * cùng kiểu: ô thứ ba (nhãn = `penaltyMetricLabel`, gợi ý "Tối đa N mỗi trận · −P điểm mỗi
 * lần", mặc định 0) gửi thành `penaltyValue`. Ô chỉ số chính gợi ý thêm "+{points} điểm mỗi
 * lần" khi `points ≠ 1`. Dòng của một lần khai đọc qua `formatReportValue` ("4 mạng đã giết +
 * 2 lần ám sát trong cuộc họp", "4 phát bắn trúng kẻ xấu − 1 phát bắn sai").
 *
 * Hai tab ngay dưới tiêu đề (spec 2026-10-31 §B): "Khai điểm" | "Báo cáo người chơi", giữ trên URL
 * `?tab=` (mặc định Khai điểm), theo mẫu tab WAI-ARIA như "Tổng điểm theo phe" (←/→ vòng, Home/End),
 * vạch chỉ báo `TabIndicator`. Báo cáo người chơi gửi ở tab riêng (`AccusationTab.tsx`): form khai
 * và form sửa KHÔNG còn phần báo cáo và không bao giờ gửi `accusation` (server trả 400). Lần khai cũ
 * đã gắn báo cáo vẫn hiện khung báo cáo + trạng thái (chờ / đúng +1 / bị bác kèm lý do / đã có
 * người báo cáo trước) và ghi chú khi báo cáo bị ẩn vì trùng, chỉ để xem; mục trừ điểm do bị báo
 * cáo (`source = 'accusation'`) mang chip "Bị trừ điểm" và đọc "Bị báo cáo: bắn {tên} ({phe}) −
 * {điểm} điểm" (`lib/accusations.ts`).
 *
 * Ngày chơi và buổi mặc định (spec 2026-10-31 §A, `reportFields.tsx`): form khai chọn sẵn ngày
 * `defaultPlayedOn` (trước 6:00 sáng giờ VN là hôm qua) và buổi `pickDefaultSession` của ngày đó.
 *
 * Ngày nhân điểm (spec ngày nhân điểm §5): ngày chơi đang chọn là ngày nhân thì dưới ô ngày có
 * dòng "Ngày này điểm cộng ×m" — hệ số lấy từ danh sách "sắp tới" (hôm nay trở đi); form sửa giữ
 * ngày cũ thì dùng hệ số của chính lần khai (ngày đã qua không còn trong danh sách đó). Lần khai
 * có `multiplier > 1` mang chip vàng `×m` cạnh chip trạng thái.
 *
 * Highlight (spec highlight §3): ô file không bắt buộc, chỉ hiện khi tính năng dùng được;
 * gửi = tạo lần khai rồi mới tải file, lỗi tải file không huỷ lần khai. Danh sách có link
 * "Xem highlight" và nút Thêm/Đổi trên lần khai còn chờ duyệt (`ReportHighlight.tsx`).
 */

import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { AccusationDto, BountyClaimDto, Faction, HighlightConfigDto, MultiplierDayDto, ReportDto, ReportRoleDto, ReportStatus, RoleDto } from '../../shared/api-types';
import { formatReportValue, hasExtraMetric, hasPenaltyMetric } from '../../shared/metric';
import { normalizeText } from '../../shared/text';
import { apiGet, apiSend, errorMessage } from '../api';
import { Character } from '../components/Character';
import { EmptyState } from '../components/EmptyState';
import { HighlightLink } from '../components/HighlightLink';
import { MultiplierChip } from '../components/MultiplierChip';
import { QueryState } from '../components/QueryState';
import { TabIndicator } from '../components/TabIndicator';
import { DUPLICATE_NOTE, PENALISED_CHIP, accusationStatusText, formatAccusationLine, formatPenaltyLine } from '../lib/accusations';
import { CLAIM_CHIP_CLASS, bountyIcon, claimStatusText, sessionText } from '../lib/bounties';
import { cx } from '../lib/cx';
import { FACTION_LABEL } from '../lib/factions';
import { usePresence } from '../lib/motion';
import { addDaysIso, formatDateLabel, vnTodayIso } from '../lib/format';
import { multiplierOn, rolesQuery, upcomingMultipliersQuery } from '../lib/queries';
import { MY_BOUNTY_CLAIMS_KEY, MY_REPORTS_KEY, PENDING_REPORTS_KEY } from '../lib/queryKeys';
import { AccusationTab } from './AccusationTab';
import { HighlightButton, HighlightField, checkHighlight, uploadHighlight, type HighlightUpload } from './ReportHighlight';
import { DateField, HINT_CLASS, LABEL_CLASS, NoteField, SessionField, WINDOW_DAYS, useReportDay } from './reportFields';

const HIGHLIGHT_CONFIG_KEY = ['reports', 'highlight-config'] as const;

/** Số gợi ý role tối đa khi gõ tìm. */
const MAX_SUGGESTIONS = 10;

const SUCCESS_MESSAGE = 'Đã gửi, chờ mod duyệt';
/** Lần khai đã tạo nhưng bước tải highlight lỗi: báo riêng kèm lời của server; người dùng thêm lại ở danh sách. */
const highlightNotUploaded = (reason: string) => `Đã gửi khai điểm, nhưng highlight chưa tải lên được: ${reason}`;

/** Chip trạng thái: nền màu trạng thái, chữ mực tối (`gold-ink` trên vàng, `night-950` trên `ok`/`duck-soft`). */
const STATUS_CHIP: Record<ReportStatus, { text: string; className: string }> = {
  pending: { text: 'Chờ duyệt', className: 'bg-gold text-gold-ink' },
  approved: { text: 'Đã duyệt', className: 'bg-ok text-night-950' },
  rejected: { text: 'Bị từ chối', className: 'bg-duck-soft text-night-950' },
  revoked: { text: 'Bị huỷ duyệt', className: 'bg-duck-soft text-night-950' },
};

/** Chip phe cạnh tên role: chữ trắng trên bản `-strong` (`goose`/`duck` gốc không đủ tương phản). */
const FACTION_CHIP: Record<Faction, string> = {
  goose: 'bg-goose-strong',
  duck: 'bg-duck-strong',
  neutral: 'bg-third',
};

/** Nhân vật thu nhỏ trong gợi ý và trong thẻ role đã chọn (px, kèm lớp bề rộng tương ứng). */
const SUGGESTION_FIGURE = { size: 40, className: 'w-10' };
const CHOSEN_FIGURE = { size: 64, className: 'w-16' };

interface ReportBody {
  roleId: number;
  value: number;
  /** Chỉ gửi với role có chỉ số phụ (server mặc định 0). */
  extraValue?: number;
  /** Chỉ gửi với role có chỉ số phạt (server mặc định 0). */
  penaltyValue?: number;
  playedOn: string;
  sessionId?: number;
  note?: string;
}

interface ReportPatchBody {
  value: number;
  /** Chỉ gửi với role có chỉ số phụ (không gửi thì server giữ giá trị cũ). */
  extraValue?: number;
  /** Chỉ gửi với role có chỉ số phạt (không gửi thì server giữ giá trị cũ). */
  penaltyValue?: number;
  playedOn: string;
  note: string | null;
}

/** Giá trị mặc định của ô chỉ số phụ và ô chỉ số phạt: 0 (hầu hết trận không có lần ám sát trong họp, không bắn sai). */
const OPTIONAL_METRIC_DEFAULT = '0';

/**
 * Phần role mà form cần để vẽ ô chỉ số chính (gợi ý điểm), ô chỉ số phụ và ô chỉ số phạt:
 * `RoleDto` (form khai) và `ReportDto.role` (form sửa) đều khớp. Mỗi bộ ba trường phụ/phạt cùng
 * có hoặc cùng null.
 */
type FormRole = Pick<
  ReportRoleDto,
  'metricLabel' | 'maxPerGame' | 'points' | 'extraMetricLabel' | 'extraMaxPerGame' | 'extraPoints' | 'penaltyMetricLabel' | 'penaltyMaxPerGame' | 'penaltyPoints'
>;

type ParsedMetric = { value: number; error: null } | { value: null; error: string };

/** Ô số không bắt buộc đã gõ: trống = 0; phải là số nguyên trong [0, max], không thì lời báo cùng chữ với server. */
function parseOptionalMetric(raw: string, max: number, outOfRange: string): ParsedMetric {
  const value = raw.trim() === '' ? 0 : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) return { value: null, error: outOfRange };
  return { value, error: null };
}

/**
 * Đọc ô chỉ số phụ đã gõ: trống = 0; phải là số nguyên trong [0, extraMaxPerGame], không thì
 * trả lời báo cùng chữ với server (`VALUE_OUT_OF_RANGE`). Role không có chỉ số phụ → 0, không lỗi.
 */
function parseExtraValue(raw: string, role: FormRole): ParsedMetric {
  if (!hasExtraMetric(role)) return { value: 0, error: null };
  const max = role.extraMaxPerGame ?? 0;
  return parseOptionalMetric(raw, max, `Chỉ số phụ phải từ 0 đến ${max}`);
}

/** Như `parseExtraValue` cho ô chỉ số phạt: [0, penaltyMaxPerGame]; role không có chỉ số phạt → 0, không lỗi. */
function parsePenaltyValue(raw: string, role: FormRole): ParsedMetric {
  if (!hasPenaltyMetric(role)) return { value: 0, error: null };
  const max = role.penaltyMaxPerGame ?? 0;
  return parseOptionalMetric(raw, max, `Chỉ số phạt phải từ 0 đến ${max}`);
}

/** Gợi ý dưới ô chỉ số chính: "Tối đa N mỗi trận", thêm " · +P điểm mỗi lần" khi `points ≠ 1` (spec điểm role §5). */
function mainHint(role: FormRole): string {
  const base = `Tối đa ${role.maxPerGame} mỗi trận`;
  return role.points === 1 ? base : `${base} · +${role.points} điểm mỗi lần`;
}

/** Gửi khai điểm: thân JSON và file highlight đã kiểm tra (nếu có chọn). */
interface SubmitInput {
  body: ReportBody;
  highlight: HighlightUpload | null;
}

/** Lần khai đã tạo (có `highlightUrl` nếu tải được) và lỗi riêng của bước tải file, nếu có. */
interface SubmitResult {
  report: ReportDto;
  highlightError: string | null;
}

/** Thay một lần khai trong cache "Lần khai của tôi" bằng DTO server vừa trả. */
function replaceInMine(queryClient: QueryClient, updated: ReportDto) {
  queryClient.setQueryData<ReportDto[]>(MY_REPORTS_KEY, (current) => current?.map((item) => (item.id === updated.id ? updated : item)));
}

/**
 * Highlight vừa tải xong: hàng chờ Duyệt điểm (nếu người này là mod, đang mở cùng phiên) phải thấy
 * link mới của chính lần khai này — cache hàng chờ là của tab admin nên chỉ đánh dấu cũ để tải lại.
 */
function refreshReviewQueue(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: PENDING_REPORTS_KEY });
}

/** Hai tab của trang (`?tab=`); không có hoặc giá trị lạ = Khai điểm. */
const PAGE_TABS = [
  { key: 'khai-diem', label: 'Khai điểm' },
  { key: 'bao-cao', label: 'Báo cáo người chơi' },
] as const;
type PageTab = (typeof PAGE_TABS)[number]['key'];
const TAB_PARAM = 'tab';
const PANEL_ID = 'report-page-panel';
const tabId = (key: PageTab) => `report-tab-${key}`;

export function ReportPage() {
  const roles = useQuery(rolesQuery);
  const [params, setParams] = useSearchParams();
  const requested = params.get(TAB_PARAM);
  const active: PageTab = PAGE_TABS.find((tab) => tab.key === requested)?.key ?? 'khai-diem';
  const tabRefs = useRef<Partial<Record<PageTab, HTMLButtonElement | null>>>({});

  const select = (key: PageTab) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, key);
    setParams(next, { replace: true });
  };
  /** ←/→ (vòng), Home/End: chọn tab và dời focus theo (mẫu "automatic activation", như "Tổng điểm theo phe"). */
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys = PAGE_TABS.map((tab) => tab.key);
    const i = keys.indexOf(active);
    const n = keys.length;
    const target =
      event.key === 'ArrowRight' ? keys[(i + 1) % n]
      : event.key === 'ArrowLeft' ? keys[(i - 1 + n) % n]
      : event.key === 'Home' ? keys[0]
      : event.key === 'End' ? keys[n - 1]
      : undefined;
    if (!target) return;
    event.preventDefault();
    select(target);
    tabRefs.current[target]?.focus();
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
      <h1 className="text-raised text-3xl leading-none font-extrabold text-white">Khai điểm</h1>

      {/*
       * Dải tab ngay dưới tiêu đề (`-mt-3` kéo sát lên), cuộn ngang trong chính nó nếu chật;
       * `py-1.5` chừa chỗ cho viền focus không bị cắt. `relative` để vạch chỉ báo trượt theo tab.
       */}
      <div role="tablist" aria-label="Khai điểm" className="relative -mt-3 flex gap-2 overflow-x-auto py-1.5 [scrollbar-width:thin]">
        <TabIndicator selectedId={tabId(active)} />
        {PAGE_TABS.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[tab.key] = el;
              }}
              type="button"
              role="tab"
              id={tabId(tab.key)}
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? undefined : -1}
              className={cx('chip shrink-0 px-4 py-1.5 text-base hover:brightness-110', selected && 'bg-gold text-gold-ink')}
              onClick={() => select(tab.key)}
              onKeyDown={onTabKeyDown}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* `key` theo tab để nội dung tab mới mờ vào (`tab-enter`). */}
      <div key={active} role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(active)} className="tab-enter flex flex-col gap-6">
        {active === 'khai-diem' ? <ReportTab roles={roles} /> : <QueryState query={roles}>{(list) => <AccusationTab roles={list} />}</QueryState>}
      </div>
    </div>
  );
}

/** Tab "Khai điểm": form khai một trận, "Lần khai của tôi" và "Treo thưởng của tôi". */
function ReportTab({ roles }: { roles: UseQueryResult<RoleDto[]> }) {
  const mine = useQuery({ queryKey: MY_REPORTS_KEY, queryFn: () => apiGet<ReportDto[]>('/api/reports/mine?limit=50') });
  const config = useQuery({ queryKey: HIGHLIGHT_CONFIG_KEY, queryFn: () => apiGet<HighlightConfigDto>('/api/reports/highlight-config') });
  /**
   * Highlight dùng được = tính năng bật và hỏi được giới hạn. Hỏi lỗi (vd bot Discord đang rớt)
   * coi như không có: ẩn ô file và nút Thêm/Đổi, không báo gì — khai điểm vẫn bình thường.
   */
  const highlight = config.data?.enabled ? config.data : null;

  return (
    <>
      <section className="panel flex flex-col gap-3">
        <h2 className="text-xl leading-tight font-extrabold text-white">Khai một trận</h2>
        <QueryState query={roles}>{(list) => <ReportForm roles={list} highlight={highlight} />}</QueryState>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl leading-tight font-extrabold text-white">Lần khai của tôi</h2>
        <QueryState query={mine}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>
                <p>Bạn chưa khai điểm lần nào</p>
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {list.map((report) => (
                  <ReportItem key={report.id} report={report} highlight={highlight} />
                ))}
              </ul>
            )
          }
        </QueryState>
        <MyBounties />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Form khai
// ---------------------------------------------------------------------------

interface ReportFormProps {
  roles: RoleDto[];
  /** `null` = highlight không dùng được (tắt hoặc hỏi không được): không có ô file. */
  highlight: HighlightConfigDto | null;
}

function ReportForm({ roles, highlight }: ReportFormProps) {
  const queryClient = useQueryClient();
  const ids = useFieldIds();
  const today = vnTodayIso();
  const multipliers = useQuery(upcomingMultipliersQuery);

  const [role, setRole] = useState<RoleDto | null>(null);
  const [value, setValue] = useState('');
  const [extraValue, setExtraValue] = useState(OPTIONAL_METRIC_DEFAULT);
  const [penaltyValue, setPenaltyValue] = useState(OPTIONAL_METRIC_DEFAULT);
  /** Ngày chơi + buổi, chọn sẵn theo mặc định (spec 2026-10-31 §A). */
  const day = useReportDay();
  const { playedOn, sessionId } = day;
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  /** Đang ở bước tải file (sau khi lần khai đã tạo xong) — để nút gửi nói đúng việc đang làm. */
  const [uploading, setUploading] = useState(false);
  /**
   * Số lần bấm Gửi khi file đang chọn bị từ chối: làm `key` của dòng báo để nó được dựng lại
   * (trình đọc màn hình đọc lại `role="alert"`) dù chữ không đổi — không lặng lẽ bỏ qua cú bấm.
   */
  const [refusals, setRefusals] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  /** File đang chọn đã kiểm tra loại và dung lượng; `null` khi không chọn (hoặc ô file không hiện). */
  const chosen = file && highlight ? checkHighlight(file, highlight.maxBytes) : null;

  /** Xoá file khỏi state lẫn ô file (ô file không điều khiển được qua `value`). */
  const clearFile = () => {
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const submit = useMutation({
    mutationFn: async ({ body, highlight: upload }: SubmitInput): Promise<SubmitResult> => {
      const created = await apiSend<ReportDto>('POST', '/api/reports', body);
      if (!upload) return { report: created, highlightError: null };
      // Lỗi tải file không huỷ lần khai vừa tạo: vẫn là "gửi xong", kèm lời báo riêng.
      setUploading(true);
      try {
        return { report: await uploadHighlight(created.id, upload), highlightError: null };
      } catch (error) {
        return { report: created, highlightError: errorMessage(error) };
      } finally {
        setUploading(false);
      }
    },
    onSuccess: ({ report, highlightError }, { highlight: upload }) => {
      queryClient.setQueryData<ReportDto[]>(MY_REPORTS_KEY, (current) => [report, ...(current ?? [])]);
      if (upload && highlightError === null) refreshReviewQueue(queryClient);
      setValue('');
      setExtraValue(OPTIONAL_METRIC_DEFAULT);
      setPenaltyValue(OPTIONAL_METRIC_DEFAULT);
      setNote('');
      clearFile();
    },
  });

  /** Người dùng sửa gì đó: bỏ thông báo của lần gửi trước. */
  const touch = () => {
    setLocalError(null);
    if (submit.isError || submit.isSuccess) submit.reset();
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
    // File sai loại/quá cỡ: không gửi gì cả; lời báo đang hiện được dựng lại để đọc lại (xem `refusals`).
    // Lối ra: nút "Bỏ file" rồi gửi không kèm highlight, hoặc chọn file khác.
    if (chosen?.problem) {
      setRefusals((count) => count + 1);
      return;
    }
    setLocalError(null);
    const trimmedNote = note.trim();
    submit.mutate({
      body: {
        roleId: role.id,
        value: Number(value),
        ...(hasExtraMetric(role) ? { extraValue: extra.value } : {}),
        ...(hasPenaltyMetric(role) ? { penaltyValue: penalty.value } : {}),
        playedOn,
        ...(sessionId !== '' ? { sessionId: Number(sessionId) } : {}),
        ...(trimmedNote !== '' ? { note: trimmedNote } : {}),
      },
      highlight: chosen?.upload ?? null,
    });
  };

  const highlightError = submit.data?.highlightError ?? null;
  const error =
    localError ??
    chosen?.problem ??
    (submit.isError ? errorMessage(submit.error) : null) ??
    (highlightError !== null ? highlightNotUploaded(highlightError) : null);

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <RolePicker
        roles={roles}
        selected={role}
        onSelect={(next) => {
          setRole(next);
          // Ô phụ/phạt của role trước không có nghĩa với role mới: về mặc định.
          setExtraValue(OPTIONAL_METRIC_DEFAULT);
          setPenaltyValue(OPTIONAL_METRIC_DEFAULT);
          touch();
        }}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.value} className={LABEL_CLASS}>
          {role ? role.metricLabel : 'Giá trị'}
        </label>
        <input
          id={ids.value}
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
          id={ids.extra}
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
          id={ids.penalty}
          role={role}
          value={penaltyValue}
          onChange={(next) => {
            setPenaltyValue(next);
            touch();
          }}
        />
      )}

      <DateField
        id={ids.date}
        today={today}
        value={playedOn}
        multiplier={multiplierOn(multipliers.data, playedOn)}
        onChange={(next) => {
          day.setPlayedOn(next);
          touch();
        }}
      />

      <SessionField
        id={ids.session}
        day={day.day}
        value={sessionId}
        onChange={(next) => {
          day.setSessionId(next);
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

      {highlight && (
        <HighlightField
          id={ids.highlight}
          ref={fileInput}
          maxBytes={highlight.maxBytes}
          hasFile={file !== null}
          onChange={(next) => {
            setFile(next);
            touch();
          }}
          onClear={() => {
            clearFile();
            touch();
            // Nút "Bỏ file" biến mất ngay khi bấm: đưa focus về ô file thay vì rơi về <body>.
            fileInput.current?.focus();
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        <button type="submit" className="btn-primary w-full sm:w-auto sm:self-start" disabled={submit.isPending}>
          {uploading ? 'Đang tải highlight…' : submit.isPending ? 'Đang gửi…' : 'Gửi khai điểm'}
        </button>
        {error && (
          <p key={refusals} role="alert" className="text-sm font-bold text-duck-soft">
            {error}
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-5 text-sm font-bold text-ok">
          {submit.isSuccess && highlightError === null && SUCCESS_MESSAGE}
        </p>
      </div>
    </form>
  );
}

/** Id duy nhất cho các ô của một form (trang có nhiều form: khai mới và sửa từng lần khai). */
function useFieldIds() {
  const base = useId();
  return {
    value: `${base}-value`,
    extra: `${base}-extra`,
    penalty: `${base}-penalty`,
    date: `${base}-date`,
    session: `${base}-session`,
    note: `${base}-note`,
    highlight: `${base}-highlight`,
  };
}

// ---------------------------------------------------------------------------
// Ô tìm role
// ---------------------------------------------------------------------------

interface RolePickerProps {
  roles: RoleDto[];
  selected: RoleDto | null;
  onSelect: (role: RoleDto | null) => void;
}

/** Khớp theo tên Việt, tên Anh hoặc key, không phân biệt hoa thường và dấu. */
function roleMatches(role: RoleDto, query: string): boolean {
  return [role.nameVi, role.nameEn, role.key.replaceAll('_', ' ')].some((text) => normalizeText(text).includes(query));
}

/**
 * Ô gõ tìm + danh sách gợi ý (combobox/listbox). Gõ chữ là bỏ role đang chọn và mở
 * gợi ý; chọn một gợi ý thì ô hiện tên role, đóng danh sách và hiện thẻ role đã chọn.
 */
function RolePicker({ roles, selected, onSelect }: RolePickerProps) {
  const inputId = useId();
  const listId = `${inputId}-options`;
  const [query, setQuery] = useState('');

  const normalised = normalizeText(query);
  const open = selected === null && normalised !== '';
  const matches = open ? roles.filter((role) => roleMatches(role, normalised)).slice(0, MAX_SUGGESTIONS) : [];
  // Danh sách gợi ý mở = phóng + mờ vào, đóng = còn một nhịp mờ ra (spec §5.2); lúc mờ ra giữ nguyên
  // các dòng vừa hiện (chọn xong thì `matches` đã rỗng) để không nháy sang "Không có role nào khớp".
  const popup = usePresence(open);
  const lastMatches = useRef(matches);
  if (open) lastMatches.current = matches;
  const shown = open ? matches : lastMatches.current;

  const choose = (role: RoleDto) => {
    onSelect(role);
    setQuery(role.nameVi);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, role: RoleDto) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(role);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className={LABEL_CLASS}>
        Role
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        placeholder="Gõ tên role, vd “kiem si”"
        className="field"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (selected) onSelect(null);
        }}
      />
      {popup.mounted &&
        (shown.length === 0 ? (
          open && <p className={HINT_CLASS}>Không có role nào khớp</p>
        ) : (
          <ul
            id={listId}
            role="listbox"
            aria-label="Kết quả tìm role"
            className="popover layer-pop flex max-h-80 flex-col gap-0.5 overflow-y-auto p-1"
            data-state={popup.state}
            aria-hidden={open ? undefined : true}
            inert={open ? undefined : true}
          >
            {shown.map((role) => (
              // Viền focus lùi vào trong (-outline-offset) để không bị khung cuộn cắt mất.
              <li
                key={role.id}
                role="option"
                aria-selected={false}
                tabIndex={0}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-night-700 focus-visible:-outline-offset-3 focus-visible:bg-night-700"
                onClick={() => choose(role)}
                onKeyDown={(event) => onKeyDown(event, role)}
              >
                <RoleFigure role={role} {...SUGGESTION_FIGURE} />
                {/* Chip phe xuống dòng dưới tên khi hàng hẹp (320px với tên role dài). */}
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words">
                    <span className="font-bold text-white">
                      <span aria-hidden="true">{role.icon}</span> {role.nameVi}
                    </span>
                    <span className="text-night-300"> — {role.metricLabel}</span>
                  </span>
                  <FactionChip faction={role.faction} />
                </span>
              </li>
            ))}
          </ul>
        ))}
      {selected && (
        <div className="panel-inset flex items-center gap-3">
          <RoleFigure role={selected} {...CHOSEN_FIGURE} />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <p className="text-sm text-night-300">
              Đã chọn:{' '}
              <span className="font-bold text-white">
                <span aria-hidden="true">{selected.icon}</span> {selected.nameVi}
              </span>{' '}
              ({selected.nameEn})
            </p>
            <FactionChip faction={selected.faction} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Nhân vật thu nhỏ không bảng tên, chỉ để nhận ra role bằng bộ đồ; tên người giữ để
 * trống (null sẽ ra hình bóng "chưa ai hoá thân"). Bọc trong ô bề rộng cố định vì
 * `Character` tự rộng hết ô chứa. Ô bọc `aria-hidden`: tên role đã viết ngay bên cạnh,
 * nếu để `role="img"` của nhân vật thì trình đọc màn hình đọc tên role hai lần.
 */
function RoleFigure({ role, size, className }: { role: RoleDto; size: number; className: string }) {
  return (
    <div aria-hidden="true" className={cx('shrink-0', className)}>
      <Character role={role} holderName="" variant="current" size={size} nameplate={false} />
    </div>
  );
}

function FactionChip({ faction }: { faction: Faction }) {
  return <span className={cx('chip px-2 py-0.5 text-xs', FACTION_CHIP[faction])}>{FACTION_LABEL[faction]}</span>;
}

// ---------------------------------------------------------------------------
// Các ô dùng chung cho form khai và form sửa
// ---------------------------------------------------------------------------

interface MetricFieldProps {
  id: string;
  /** Role có chỉ số phụ/phạt tương ứng (người gọi đã kiểm `hasExtraMetric`/`hasPenaltyMetric`). */
  role: FormRole;
  value: string;
  onChange: (value: string) => void;
}

interface OptionalMetricFieldProps {
  id: string;
  label: string;
  max: number;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}

/** Ô số không bắt buộc cùng dáng với ô chỉ số chính: nhãn, giới hạn [0, max], một dòng gợi ý. */
function OptionalMetricField({ id, label, max, hint, value, onChange }: OptionalMetricFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input id={id} type="number" inputMode="numeric" min={0} max={max} step={1} className="field" value={value} onChange={(event) => onChange(event.target.value)} />
      <p className={HINT_CLASS}>{hint}</p>
    </div>
  );
}

/**
 * Ô chỉ số phụ (spec chỉ số phụ §6): nhãn = `extraMetricLabel`, giới hạn [0, extraMaxPerGame], gợi
 * ý "Tối đa N mỗi trận · +P điểm mỗi lần".
 */
function ExtraField({ id, role, value, onChange }: MetricFieldProps) {
  const max = role.extraMaxPerGame ?? 0;
  return <OptionalMetricField id={id} label={role.extraMetricLabel ?? ''} max={max} hint={`Tối đa ${max} mỗi trận · +${role.extraPoints} điểm mỗi lần`} value={value} onChange={onChange} />;
}

/**
 * Ô chỉ số phạt (spec điểm role §5): nhãn = `penaltyMetricLabel`, giới hạn [0, penaltyMaxPerGame],
 * gợi ý "Tối đa N mỗi trận · −P điểm mỗi lần" (dấu trừ Unicode, như khi đọc một lần khai).
 */
function PenaltyField({ id, role, value, onChange }: MetricFieldProps) {
  const max = role.penaltyMaxPerGame ?? 0;
  return <OptionalMetricField id={id} label={role.penaltyMetricLabel ?? ''} max={max} hint={`Tối đa ${max} mỗi trận · −${role.penaltyPoints} điểm mỗi lần`} value={value} onChange={onChange} />;
}

// ---------------------------------------------------------------------------
// Treo thưởng của tôi (spec treo thưởng §6)
// ---------------------------------------------------------------------------

/** Số lần nhận gần nhất hiện ở "Treo thưởng của tôi". */
const MY_BOUNTIES_LIMIT = 20;

/**
 * Mục con "Treo thưởng của tôi" dưới "Lần khai của tôi": các lần nhận gần nhất — `{icon} {mục}`
 * `+{điểm}`, buổi, chip trạng thái ("Chờ duyệt" / "Đã nhận +{điểm}" / "Bị từ chối: {lý do}" /
 * "Đã bị huỷ: {lý do}"). Nhận thưởng ở trang Hôm nay (hoặc Discord), ở đây chỉ xem.
 */
function MyBounties() {
  const headingId = useId();
  const claims = useQuery({ queryKey: MY_BOUNTY_CLAIMS_KEY, queryFn: () => apiGet<BountyClaimDto[]>(`/api/bounty-claims/mine?limit=${MY_BOUNTIES_LIMIT}`) });

  return (
    <section aria-labelledby={headingId} className="mt-3 flex flex-col gap-3">
      <h3 id={headingId} className="text-lg leading-tight font-extrabold text-white">
        Treo thưởng của tôi
      </h3>
      <QueryState query={claims}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState>
              <p>Bạn chưa nhận treo thưởng nào</p>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((claim) => (
                <li key={claim.id} className="panel flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 font-bold break-words text-white">
                      {bountyIcon(claim.role)} {claim.bounty.title}
                    </span>
                    <span className="chip bg-gold px-2.5 py-0.5 text-gold-ink tabular-nums">{`+${claim.points}`}</span>
                    <time dateTime={claim.playedOn} className="ml-auto text-sm text-night-300 tabular-nums">
                      {formatDateLabel(claim.playedOn)}
                    </time>
                  </div>
                  <p className={HINT_CLASS}>Buổi {sessionText(claim.session)}</p>
                  <span className={cx('chip self-start rounded-xl! break-words whitespace-normal!', CLAIM_CHIP_CLASS[claim.status])}>{claimStatusText(claim)}</span>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lần khai của tôi
// ---------------------------------------------------------------------------

interface ReportItemProps {
  report: ReportDto;
  /** `null` = highlight không dùng được: không có nút Thêm/Đổi (link "Xem highlight" vẫn hiện nếu đã có). */
  highlight: HighlightConfigDto | null;
}

function ReportItem({ report, highlight }: ReportItemProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const chip = STATUS_CHIP[report.status];
  /** Mục trừ điểm do bị báo cáo: dòng giá trị đọc theo báo cáo, không lặp ghi chú của server (cùng nội dung). */
  const penaltyOf = report.source === 'accusation' ? report.penaltyOf : null;

  return (
    <li className="panel flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold text-white">
          {report.role.icon} {report.role.nameVi}
        </span>
        <span className={cx('chip', chip.className)}>{chip.text}</span>
        {report.source === 'accusation' && <span className="chip bg-duck-soft text-night-950">{PENALISED_CHIP}</span>}
        <MultiplierChip multiplier={report.multiplier} />
        <time dateTime={report.playedOn} className="ml-auto text-sm text-night-300 tabular-nums">
          {formatDateLabel(report.playedOn)}
        </time>
      </div>

      {editing ? (
        <EditForm report={report} onDone={() => setEditing(false)} />
      ) : (
        <>
          {/* `break-words`: "x + y" với hai nhãn dài phải xuống dòng ở 320px, không tràn ngang. */}
          <p className="font-bold break-words text-white">{penaltyOf ? formatPenaltyLine(penaltyOf) : formatReportValue(report, report.role)}</p>
          {report.sessionId !== null && <p className={HINT_CLASS}>Buổi #{report.sessionId}</p>}
          {report.note && !penaltyOf && <p className="text-sm text-night-200">{report.note}</p>}
          {/* Báo cáo cũ gửi kèm lần khai (trước khi tách tab): chỉ để xem. */}
          {report.accusation && <MyAccusation accusation={report.accusation} duplicate={report.accusationDuplicate} />}
          {/* `rejectReason` là lý do của cả từ chối lẫn huỷ duyệt. */}
          {(report.status === 'rejected' || report.status === 'revoked') && report.rejectReason && (
            <p className="text-sm text-duck-soft">Lý do: {report.rejectReason}</p>
          )}
          {report.highlightUrl && <HighlightLink href={report.highlightUrl} />}
          {report.status === 'pending' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                Sửa
              </button>
              {highlight && (
                <HighlightButton
                  report={report}
                  maxBytes={highlight.maxBytes}
                  onUploaded={(updated) => {
                    replaceInMine(queryClient, updated);
                    refreshReviewQueue(queryClient);
                  }}
                  // Lần khai có thể vừa được duyệt/từ chối: tải lại để thấy trạng thái thật.
                  onFailed={() => void queryClient.invalidateQueries({ queryKey: MY_REPORTS_KEY })}
                />
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

/**
 * Khung báo cáo của chính mình dưới một lần khai: dòng "Báo cáo: … — phe …", trạng thái (chờ duyệt /
 * đúng +1 / bị bác kèm lý do / đã có người báo cáo trước — `accusationStatusText`) và ghi chú khi
 * báo cáo bị ẩn khỏi hàng chờ vì trùng vụ với báo cáo sớm hơn.
 */
function MyAccusation({ accusation, duplicate }: { accusation: AccusationDto; duplicate: boolean }) {
  const settled = accusation.status === 'rejected' || accusation.status === 'superseded';
  return (
    <div className="panel-inset flex flex-col gap-1 text-sm">
      <p className="font-bold break-words text-white">{formatAccusationLine(accusation)}</p>
      <p className={settled ? 'text-duck-soft' : accusation.status === 'approved' ? 'text-ok' : 'text-night-300'}>{accusationStatusText(accusation)}</p>
      {duplicate && <p className="text-night-300">{DUPLICATE_NOTE}</p>}
    </div>
  );
}

/**
 * Hệ số gợi ý ở form sửa cho ngày `date`. Danh sách đã tải phủ cửa sổ khai [hôm nay − 3, …] nên là nguồn
 * đúng cho các ngày đó (admin hạ/xoá hệ số thì gợi ý theo); chỉ khi danh sách chưa tải hoặc ngày cũ hơn
 * cửa sổ mới lấy hệ số server đã tính cho chính lần khai (nếu đúng ngày của nó).
 */
function editMultiplier(days: readonly MultiplierDayDto[] | undefined, date: string, today: string, report: ReportDto): number {
  if (days?.some((item) => item.day === date)) return multiplierOn(days, date);
  if (days !== undefined && date >= addDaysIso(today, -WINDOW_DAYS)) return 1;
  return date === report.playedOn ? report.multiplier : 1;
}

/**
 * Sửa giá trị (và chỉ số phụ/phạt nếu role có) / ngày / ghi chú của lần khai còn chờ duyệt (PATCH);
 * role và buổi giữ nguyên. Ô chính giới hạn theo `role.maxPerGame`, ô phụ theo `extraMaxPerGame`, ô
 * phạt theo `penaltyMaxPerGame`. Không bao giờ gửi `accusation` (báo cáo người chơi ở tab riêng; báo
 * cáo cũ đã gắn giữ nguyên).
 */
function EditForm({ report, onDone }: { report: ReportDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const ids = useFieldIds();
  const today = vnTodayIso();
  const multipliers = useQuery(upcomingMultipliersQuery);
  const [value, setValue] = useState(String(report.value));
  const [extraValue, setExtraValue] = useState(String(report.extraValue));
  const [penaltyValue, setPenaltyValue] = useState(String(report.penaltyValue));
  const [playedOn, setPlayedOn] = useState(report.playedOn);
  const [note, setNote] = useState(report.note ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: ReportPatchBody) => apiSend<ReportDto>('PATCH', `/api/reports/${report.id}`, body),
    onSuccess: (updated) => {
      replaceInMine(queryClient, updated);
      onDone();
    },
    // Lần khai có thể vừa được duyệt/từ chối: tải lại để thấy trạng thái thật.
    onError: () => void queryClient.invalidateQueries({ queryKey: MY_REPORTS_KEY }),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim() === '') {
      setLocalError(`Hãy nhập ${report.role.metricLabel}`);
      return;
    }
    const extra = parseExtraValue(extraValue, report.role);
    if (extra.error !== null) {
      setLocalError(extra.error);
      return;
    }
    const penalty = parsePenaltyValue(penaltyValue, report.role);
    if (penalty.error !== null) {
      setLocalError(penalty.error);
      return;
    }
    setLocalError(null);
    const trimmedNote = note.trim();
    save.mutate({
      value: Number(value),
      ...(hasExtraMetric(report.role) ? { extraValue: extra.value } : {}),
      ...(hasPenaltyMetric(report.role) ? { penaltyValue: penalty.value } : {}),
      playedOn,
      note: trimmedNote === '' ? null : trimmedNote,
    });
  };

  const error = localError ?? (save.isError ? errorMessage(save.error) : null);

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.value} className={LABEL_CLASS}>
          {report.role.metricLabel}
        </label>
        <input
          id={ids.value}
          type="number"
          inputMode="numeric"
          min={0}
          max={report.role.maxPerGame}
          step={1}
          className="field"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setLocalError(null);
          }}
        />
        <p className={HINT_CLASS}>{mainHint(report.role)}</p>
      </div>
      {hasExtraMetric(report.role) && (
        <ExtraField
          id={ids.extra}
          role={report.role}
          value={extraValue}
          onChange={(next) => {
            setExtraValue(next);
            setLocalError(null);
          }}
        />
      )}
      {hasPenaltyMetric(report.role) && (
        <PenaltyField
          id={ids.penalty}
          role={report.role}
          value={penaltyValue}
          onChange={(next) => {
            setPenaltyValue(next);
            setLocalError(null);
          }}
        />
      )}
      <DateField
        id={ids.date}
        today={today}
        value={playedOn}
        multiplier={editMultiplier(multipliers.data, playedOn, today, report)}
        onChange={setPlayedOn}
      />
      <NoteField id={ids.note} value={note} onChange={setNote} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button type="button" className="btn-secondary" disabled={save.isPending} onClick={onDone}>
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
