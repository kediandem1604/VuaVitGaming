/**
 * Kiểu DTO dùng chung giữa server và web. File này không được import gì từ
 * server hay Prisma — web build cũng biên dịch nó.
 */

export type AccessLevel = 'member' | 'mod' | 'admin';

/** Hồ sơ của chính người đang đăng nhập (`GET /api/me`). */
export interface MeDto {
  id: number;
  memberCode: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  notifyEmail: boolean;
  notifyDm: boolean;
  accessLevel: AccessLevel;
}

export type SessionStatus = 'scheduled' | 'ended' | 'cancelled';

/** Chế độ chơi đang bật (`GET /api/modes`), cho form tạo buổi. */
export interface ModeDto {
  id: number;
  key: string;
  nameVi: string;
}

/** Một chế độ chơi cho admin (`GET /api/admin/modes` — kể cả đang tắt; `PATCH /api/admin/modes/:id`). */
export interface AdminModeDto extends ModeDto {
  nameEn: string;
  active: boolean;
}

export interface SessionAttendeeDto {
  memberId: number;
  displayName: string;
  avatarUrl: string | null;
}

/** Một buổi chơi (`GET /api/sessions`, điểm danh, tạo buổi). `startsAt` là ISO 8601 (UTC). */
export interface SessionDto {
  id: number;
  startsAt: string;
  modeName: string;
  capacity: number;
  roomCode: string | null;
  note: string | null;
  status: SessionStatus;
  /** Người đang tham gia, theo thứ tự đăng ký. */
  attendees: SessionAttendeeDto[];
  /** `'going'` nếu người đang đăng nhập có trong `attendees`. */
  myStatus: 'going' | null;
}

/** Một người thắng một hạng mục tri ân. */
export interface HallWinnerDto {
  memberId: number;
  displayName: string;
  avatarUrl: string | null;
  voteCount: number;
}

/** Một hạng mục của buổi; `winners` rỗng khi không ai được vote. */
export interface HallAwardDto {
  categoryName: string;
  winners: HallWinnerDto[];
}

/** Một buổi đã đóng vote; `label` = `{chế độ} {HH:mm}` giờ VN. */
export interface HallSessionDto {
  sessionId: number;
  label: string;
  awards: HallAwardDto[];
}

/** Sảnh tri ân một ngày VN (`date` dạng `YYYY-MM-DD`): các buổi trong ngày đã đóng vote, theo giờ bắt đầu. */
export interface HallOfDayDto {
  date: string;
  sessions: HallSessionDto[];
}

/** Phạm vi hạng mục tri ân: buổi nào cũng có / chỉ một chế độ chơi / theo role (admin tick thêm khi kết thúc). */
export type CategoryScope = 'always' | 'mode' | 'optional';

/** Hạng mục tính cho danh hiệu tháng nào: `mvp` (Khen → SMVP), `fun` (Vui → Vua tấu hài), `none` (không tính). */
export type BadgeGroupDto = 'mvp' | 'fun' | 'none';

/**
 * Hạng mục tri ân cho trang quản trị (`/api/admin/categories`); `mode` chỉ có khi
 * `scope = 'mode'`. `badgeGroup` là ô "Tính cho danh hiệu"; tạo mà không gửi → `none`.
 */
export interface AwardCategoryDto {
  id: number;
  scope: CategoryScope;
  mode: ModeDto | null;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  badgeGroup: BadgeGroupDto;
}

/** Phe của role: Ngỗng, Vịt, Phe thứ 3. */
export type Faction = 'goose' | 'duck' | 'neutral';

/**
 * Một role trong danh mục (`GET /api/roles`, quản trị role). `modeKey` chỉ có ở role
 * riêng của chế độ đặc biệt. Ảnh tuỳ chỉnh không nằm trong DTO: khi `hasImage`, lấy
 * qua `GET /api/roles/:id/image`.
 */
export interface RoleDto {
  id: number;
  key: string;
  faction: Faction;
  nameVi: string;
  nameEn: string;
  description: string;
  /** Tên chỉ số tính điểm, vd "Số mạng chém". */
  metricLabel: string;
  /** Giới hạn giá trị một lần khai (1–100). */
  maxPerGame: number;
  /** Điểm mỗi đơn vị chỉ số chính (1–100, mặc định 1) — spec điểm role §3. */
  points: number;
  /**
   * Chỉ số phụ (tuỳ chọn): tên, giới hạn một lần khai (1–100) và điểm mỗi đơn vị (1–100).
   * Cả ba cùng có hoặc cùng null (role không có chỉ số phụ).
   */
  extraMetricLabel: string | null;
  extraMaxPerGame: number | null;
  extraPoints: number | null;
  /**
   * Chỉ số phạt (tuỳ chọn, spec điểm role §3): tên, giới hạn một lần khai (1–100) và điểm bị TRỪ
   * mỗi đơn vị (1–100, số dương). Cả ba cùng có hoặc cùng null (role không có chỉ số phạt).
   */
  penaltyMetricLabel: string | null;
  penaltyMaxPerGame: number | null;
  penaltyPoints: number | null;
  mapNote: string | null;
  modeKey: string | null;
  /** Biểu tượng emoji của role. */
  icon: string;
  hasImage: boolean;
  active: boolean;
  sortOrder: number;
}

/** Một hạng mục trong form "Kết thúc buổi" (`GET /api/admin/sessions/:id/end-options`); `preselected` = tick sẵn. */
export interface EndOptionDto {
  id: number;
  name: string;
  scope: CategoryScope;
  preselected: boolean;
}

/** Trạng thái một lần khai điểm: chờ duyệt, đã duyệt, bị từ chối, bị huỷ duyệt (từ `approved`, trạng thái cuối). */
export type ReportStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

/** Nguồn một lần khai: `self` do chính người chơi khai; `accusation` là mục trừ điểm tạo khi duyệt báo cáo người chơi (spec điểm role §6). */
export type ReportSource = 'self' | 'accusation';

/**
 * Phần role kèm trong một lần khai: đủ để vẽ dòng, giới hạn ô nhập khi sửa (`maxPerGame`,
 * `extraMaxPerGame`, `penaltyMaxPerGame`) và đọc "x + y − z" / điểm (`metricLabel`, `points`,
 * `extraMetricLabel`, `extraPoints`, `penaltyMetricLabel`, `penaltyPoints`). Mỗi bộ ba trường
 * phụ/phạt cùng có hoặc cùng null (role không có chỉ số đó).
 */
export interface ReportRoleDto {
  id: number;
  nameVi: string;
  icon: string;
  metricLabel: string;
  maxPerGame: number;
  points: number;
  extraMetricLabel: string | null;
  extraMaxPerGame: number | null;
  extraPoints: number | null;
  penaltyMetricLabel: string | null;
  penaltyMaxPerGame: number | null;
  penaltyPoints: number | null;
}

/**
 * Một lần khai điểm (lịch sử của tôi, hàng chờ duyệt). `playedOn` dạng `YYYY-MM-DD`
 * (ngày VN), `createdAt` ISO 8601 (UTC). `rejectReason` là lý do từ chối (`status = 'rejected'`)
 * hoặc lý do huỷ duyệt (`status = 'revoked'`); `null` ở các trạng thái khác.
 * `highlightUrl` là link tới tin Discord chứa highlight (mở tab mới), `null` khi chưa kèm.
 * `extraValue` là chỉ số phụ, `penaltyValue` chỉ số phạt (0 với role không có); `bonusPoints` là
 * +1 khi báo cáo kèm theo được duyệt đúng; `source` cho biết lần khai do người chơi khai hay là mục
 * trừ điểm do báo cáo. `points = value × points + extraValue × extraPoints − penaltyValue ×
 * penaltyPoints + bonusPoints` theo điểm hiện tại của role (spec điểm role §3), có thể âm.
 */
export interface ReportDto {
  id: number;
  member: { id: number; displayName: string };
  role: ReportRoleDto;
  value: number;
  extraValue: number;
  penaltyValue: number;
  bonusPoints: number;
  source: ReportSource;
  points: number;
  playedOn: string;
  sessionId: number | null;
  note: string | null;
  status: ReportStatus;
  rejectReason: string | null;
  createdAt: string;
  highlightUrl: string | null;
  /**
   * Báo cáo người chơi gửi KÈM lần khai này (chỉ lần khai `source = 'self'`, spec điểm role §6), hoặc
   * `null` khi không có. Ở "Lần khai của tôi" (`GET /api/reports/mine`, POST/PATCH `/api/reports`) và
   * "Đã duyệt gần đây": luôn có mặt nếu lần khai có báo cáo, ở mọi trạng thái. Ở hàng chờ duyệt
   * (`GET /api/admin/reports?status=pending`): chỉ có khi báo cáo đang được HIỆN để mod quyết — báo
   * cáo trùng bị ẩn thì `null` và `accusationDuplicate = true`.
   */
  accusation: AccusationDto | null;
  /**
   * `true` khi lần khai có báo cáo `pending` nhưng nó trùng vụ với một báo cáo khác đang được hiện
   * (sớm hơn) hoặc vụ đã bị trừ điểm rồi — hàng chờ không kèm khung báo cáo, chỉ ghi chú nhỏ "Báo
   * cáo của bạn trùng với một báo cáo khác đang chờ". Vụ đã bị trừ điểm: mod duyệt lần khai này thì
   * báo cáo trùng thành `superseded`, từ chối thì `rejected`. Còn báo cáo sớm hơn đang chờ
   * (`accusationWaitingFor`): chưa duyệt được lần khai (409 `NOT_PENDING`), từ chối thì được.
   * Mọi trường hợp khác `false`.
   */
  accusationDuplicate: boolean;
  /**
   * Chỉ ở hàng chờ duyệt: báo cáo kèm lần khai bị ẩn vì trùng với báo cáo `pending` SỚM HƠN của cùng
   * vụ (đang được hiện ở lần khai khác) → tên người gửi báo cáo đó. Báo cáo sớm nhất phải được quyết
   * trước: duyệt lần khai này bị chặn (409 `NOT_PENDING` "Báo cáo kèm lần khai này trùng với báo cáo
   * của {tên} đang chờ — duyệt lần khai đó trước"); từ chối thì được. Báo cáo sớm hơn bị bác → báo
   * cáo này hiện lên (trường thành `null`). Ngoài hàng chờ, hoặc ẩn vì vụ đã bị trừ điểm → `null`.
   */
  accusationWaitingFor: { reporterName: string } | null;
  /**
   * Chỉ với mục trừ điểm (`source = 'accusation'`): báo cáo đã tạo ra mục này (để hiện "Bị báo cáo:
   * bắn {victim.displayName} ({phe}) − {penaltyPoints} điểm"); `null` với lần khai thường.
   */
  penaltyOf: AccusationDto | null;
}

/** Trạng thái báo cáo người chơi: chờ duyệt, đúng, bị bác, bị thay thế (trùng vụ đã duyệt trước). */
export type AccusationStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

/**
 * Báo cáo người chơi gửi kèm `POST/PATCH /api/reports` (trường `accusation`; PATCH `null` = bỏ báo
 * cáo, vắng mặt = giữ nguyên). Bốn trường bắt buộc: người bị báo cáo (thành viên đang hoạt động,
 * khác chính mình), role của họ (đang bật, có chỉ số phạt), người bị bắn (đang hoạt động, khác người
 * bị báo cáo), phe của người bị bắn.
 */
export interface AccusationInputDto {
  accusedId: number;
  accusedRoleId: number;
  victimId: number;
  victimFaction: Faction;
}

/**
 * Một báo cáo người chơi (trong `ReportDto.accusation` / `penaltyOf`). Không chứa người báo cáo —
 * đó là người khai của lần khai chứa nó. `rejectReason`: lý do bác (`rejected`) hoặc "Đã có người
 * báo cáo trước" (`superseded`); `null` ở trạng thái khác. Khung hàng chờ: "Báo cáo: {accused}
 * ({accusedRole}) bắn {victim} — phe {victimFaction}".
 */
export interface AccusationDto {
  id: number;
  status: AccusationStatus;
  accused: { id: number; displayName: string };
  accusedRole: { id: number; nameVi: string; icon: string; penaltyPoints: number | null };
  victim: { id: number; displayName: string };
  victimFaction: Faction;
  rejectReason: string | null;
}

/** Một dòng ô chọn người (`GET /api/members/options`): thành viên đang hoạt động, theo tên. */
export interface MemberOptionDto {
  id: number;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Lần khai đã duyệt trong danh sách quản trị "Đã duyệt gần đây" (`GET /api/admin/reports?status=approved`):
 * kèm người duyệt (`null` nếu dữ liệu không có) và giờ duyệt ISO 8601 (UTC). Chỉ mod/admin
 * thấy — người khai không được xem tên người duyệt (như hiện nay).
 */
export type ReviewedReportDto = ReportDto & {
  reviewedBy: { id: number; displayName: string } | null;
  reviewedAt: string;
};

/**
 * Cấu hình highlight cho form Khai điểm (`GET /api/reports/highlight-config`): tính năng tắt
 * → `{ enabled: false, maxBytes: 0 }`; bật → `maxBytes` là giới hạn tải lên hiện hành (byte)
 * của server Discord theo cấp boost.
 */
export interface HighlightConfigDto {
  enabled: boolean;
  maxBytes: number;
}

/**
 * Một dòng bảng xếp hạng của một role trong một mùa. Hạng 1..n liên tiếp (không đồng
 * hạng); `games` chỉ đếm lần khai do chính người chơi khai (không đếm mục trừ điểm do báo
 * cáo); `lastApprovedAt` ISO 8601 (UTC) là lần duyệt gần nhất của người đó ở role này
 * trong mùa — mốc dùng để phân hoà điểm (ai đạt mức điểm đó trước xếp trên).
 */
export interface LeaderboardRowDto {
  rank: number;
  memberId: number;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  games: number;
  lastApprovedAt: string;
}

/**
 * Một dòng "Top 3 mỗi phe" (`GET /api/leaderboard/factions`): một cặp (người, role) trong
 * một mùa. `value` là điểm mùa của cặp đó (tổng điểm các lần khai đã duyệt theo luật spec điểm
 * role §3: chính × `points`, cộng chỉ số phụ, trừ chỉ số phạt, cộng bonus); `points` là điểm
 * dùng để xếp hạng trong phe — bằng đúng `value` (luật ×5 cũ đã bỏ). Một người có thể có
 * nhiều dòng (mỗi role một dòng). Hạng 1..n liên tiếp, không đồng hạng. `role` chỉ gồm những
 * gì cần để vẽ dòng (kể cả đọc `value` là "N điểm" hay "N {nhãn}" — khớp `MetricRole`) và dẫn
 * tới bảng của role đó. `games` chỉ đếm lần khai do chính người chơi khai.
 */
export interface FactionTopRowDto {
  rank: number;
  memberId: number;
  displayName: string;
  avatarUrl: string | null;
  role: {
    id: number;
    nameVi: string;
    icon: string;
    metricLabel: string;
    points: number;
    extraMetricLabel: string | null;
    extraPoints: number | null;
    penaltyMetricLabel: string | null;
    penaltyMaxPerGame: number | null;
    penaltyPoints: number | null;
    faction: Faction;
  };
  value: number;
  points: number;
  games: number;
}

/**
 * Top mỗi phe của một mùa (`seasonId` dạng `YYYY-MM`): mọi role tính cho phe của chính
 * nó (kể cả role chế độ đặc biệt và role đã tắt). Phe chưa có cặp nào điểm > 0 → mảng rỗng.
 */
export interface FactionTopDto {
  seasonId: string;
  factions: Record<Faction, FactionTopRowDto[]>;
}

/**
 * Một dòng "Tổng điểm theo phe" (`GET /api/leaderboard/totals`): một NGƯỜI trong một bảng.
 * `points` = tổng điểm mùa của mọi cặp (người, role) điểm > 0 thuộc phe đó trong mùa (cùng
 * luật với `FactionTopRowDto.points`); bảng "Cả 3 phe" cộng ba phe. Hạng 1..n liên tiếp.
 */
export interface FactionTotalRowDto {
  rank: number;
  memberId: number;
  displayName: string;
  avatarUrl: string | null;
  points: number;
}

/** Bảng tổng điểm: `all` là "Cả 3 phe", còn lại là từng phe. */
export type TotalsScope = 'all' | Faction;

/**
 * Tổng điểm theo phe của một mùa: bốn bảng, mỗi bảng có `top` (20 dòng đầu) và `me` — dòng
 * của người đang xem nếu họ có điểm > 0 ở bảng đó (kể cả khi đã nằm trong `top`), không thì `null`.
 */
export interface FactionTotalsDto {
  seasonId: string;
  boards: Record<TotalsScope, { top: FactionTotalRowDto[]; me: FactionTotalRowDto | null }>;
}

/** Người đang hoá thân một role trong Đại sảnh (top 1 của mùa, điểm > 0). */
export interface HallHolderDto {
  memberId: number;
  displayName: string;
  score: number;
}

/** Người giữ role ở mùa đã chốt gần nhất trước đó — chỉ có khi mùa đang xem chưa ai hoá thân. */
export interface HallPreviousDto extends HallHolderDto {
  seasonId: string;
}

export interface HallRoleDto {
  role: RoleDto;
  holder: HallHolderDto | null;
  previous: HallPreviousDto | null;
}

/**
 * Đại sảnh hoá thân một mùa (`seasonId` dạng `YYYY-MM`): mọi role đang bật theo thứ tự
 * danh mục. Mùa đã chốt (`closed`) lấy người giữ từ kết quả chốt; mùa đang mở tính trực
 * tiếp từ lần khai đã duyệt. (Khác với `HallOfDayDto` — Sảnh tri ân theo buổi chơi.)
 */
export interface HallDto {
  seasonId: string;
  closed: boolean;
  roles: HallRoleDto[];
}

/** Một role mà người đang đăng nhập đang hoá thân trong mùa hiện tại (`GET /api/me/titles`), kèm điểm. */
export interface HeldRoleDto {
  role: RoleDto;
  score: number;
}

/** Một mùa (`GET /api/seasons`, mới nhất trước): mã `YYYY-MM` và đã chốt chưa. Mùa hiện tại luôn có mặt. */
export interface SeasonDto {
  id: string;
  closed: boolean;
}

/** Người nhận một danh hiệu — đủ để vẽ avatar + tên và link tới trang thành viên `/thanh-vien/:id`. */
export interface BadgeMemberDto {
  id: number;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Một danh hiệu đã trao (`GET /api/badges`, `PublicMemberDto.badges`). `title`, `icon`, `detail`
 * là chữ đóng băng lúc trao; `kind` tra từ danh mục `src/shared/badges.ts` theo `badgeKey`;
 * `periodId` là `YYYY-MM` với danh hiệu tháng, `''` với cột mốc; `awardedAt` ISO 8601 (UTC).
 */
export interface BadgeDto {
  id: number;
  badgeKey: string;
  kind: 'monthly' | 'milestone';
  periodId: string;
  title: string;
  icon: string;
  detail: string;
  awardedAt: string;
  member: BadgeMemberDto;
}

/**
 * Trang thành viên công khai (`GET /api/members/:id`, mọi thành viên đã đăng nhập xem được):
 * KHÔNG có email, quyền hay Discord id. `joinedAt` ISO 8601 (UTC) là ngày vào server hiệu lực
 * (theo Discord khi biết, không thì lúc app thấy lần đầu); `daysInServer` số ngày lịch VN từ đó
 * tới lúc rời (hoặc bây giờ); `games` số buổi đã đi (đã gồm phần admin chỉnh, không dưới 0);
 * `left` = đã rời server; `badges` mọi danh hiệu của người đó, mới nhất trước.
 */
export interface PublicMemberDto {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  daysInServer: number;
  games: number;
  left: boolean;
  badges: BadgeDto[];
}

export type MemberStatus = 'active' | 'left';

/**
 * Một thành viên trong trang quản trị (`GET /api/admin/members`, mod/admin; `PUT
 * /api/admin/members/:id/games` trả về dòng mới). `email` chỉ có giá trị khi NGƯỜI XEM là admin —
 * mod luôn nhận `null`. `joinedAt` ISO 8601 (UTC) là lúc app thấy người đó lần đầu;
 * `serverJoinedAt` ngày vào server hiệu lực (theo Discord khi biết, không thì `joinedAt`);
 * `daysInServer` số ngày lịch VN từ đó tới lúc rời (hoặc bây giờ); `games` tổng số buổi sau
 * chỉnh (không dưới 0); `gamesAdjustment` phần admin đã chỉnh (có thể âm, 0 = chưa chỉnh).
 */
export interface AdminMemberDto {
  id: number;
  memberCode: string;
  displayName: string;
  accessLevel: AccessLevel;
  status: MemberStatus;
  email: string | null;
  joinedAt: string;
  serverJoinedAt: string;
  daysInServer: number;
  games: number;
  gamesAdjustment: number;
}

export type ReminderKind = 'pre15' | 'start';
export type NotifyChannel = 'email' | 'dm';

/**
 * Một lần gửi nhắc giờ thất bại (`GET /api/admin/notification-failures`, mới nhất trước).
 * `sessionLabel` = `{chế độ} {HH:mm} {dd/MM}` giờ VN; `sentAt` ISO 8601 (UTC).
 */
export interface NotificationFailureDto {
  sessionId: number;
  sessionLabel: string;
  memberId: number;
  displayName: string;
  kind: ReminderKind;
  channel: NotifyChannel;
  sentAt: string;
  error: string;
}

/** Một đợt vote đang mở (`GET /api/admin/vote-rounds?status=open`, theo giờ đóng tăng dần); `closesAt` ISO 8601 (UTC). */
export interface OpenVoteRoundDto {
  id: number;
  sessionId: number;
  sessionLabel: string;
  closesAt: string;
}

/** Cài đặt chạy của ứng dụng (`GET`/`PATCH /api/admin/settings`, chỉ admin). */
export interface SettingsDto {
  /** Vote MVP mở trong bao nhiêu giờ sau khi buổi kết thúc (1–72). */
  voteDurationHours: number;
  /** Buổi chơi tự kết thúc sau bao nhiêu giờ kể từ giờ bắt đầu (1–24). */
  autoEndHours: number;
  /** Nhắc người tham gia trước giờ bắt đầu bao nhiêu phút (5–120). */
  reminderLeadMinutes: number;
}

/** Chủ đề giao diện chung cho mọi người: `night` (Sảnh đêm, mặc định) hoặc `halloween`. */
export type ThemeName = 'night' | 'halloween';

/** Chủ đề hiện tại (`GET /api/theme`, công khai) — admin đổi bằng `PUT /api/admin/theme`. */
export interface ThemeDto {
  theme: ThemeName;
}

/** Thân phản hồi của mọi lỗi API. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Bot Discord đang nối (`ready`) hay không (`down`: chưa đăng nhập, mất kết nối…). */
export type DiscordStatus = 'ready' | 'down';

/**
 * `GET /healthz` (không cần đăng nhập, không giới hạn tốc độ). Luôn 200 khi tiến trình
 * web còn sống — Discord sập không được làm Railway khởi động lại web.
 */
export interface HealthDto {
  ok: true;
  discord: DiscordStatus;
}

// ---------------------------------------------------------------------------
// Treo thưởng (spec treo thưởng §3, §5)
// ---------------------------------------------------------------------------

/**
 * Một mục treo thưởng (`GET /api/admin/bounties`, tạo/sửa). `role` null = "Mọi role" (điểm chỉ vào
 * Tổng "Cả 3 phe"); `session` null = "Mọi buổi" (`startsAt` ISO 8601 UTC). `approvedClaims` = số lần
 * nhận đã duyệt của mục.
 */
export interface BountyDto {
  id: number;
  title: string;
  description: string | null;
  points: number;
  role: { id: number; nameVi: string; icon: string; faction: Faction } | null;
  session: { id: number; startsAt: string; modeName: string } | null;
  active: boolean;
  approvedClaims: number;
}

/** Body `POST /api/admin/bounties`: tên 1–80, mô tả ≤ 200 (rỗng → null), điểm 1–50; `null` = mọi role / mọi buổi. */
export interface BountyInput {
  title: string;
  description?: string | null;
  points: number;
  roleId: number | null;
  sessionId: number | null;
}

/** Body `PATCH /api/admin/bounties/:id`: chỉ các trường được gửi; `active` để Tắt/Bật. */
export interface BountyPatch extends Partial<BountyInput> {
  active?: boolean;
}

export type BountyClaimStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type BountyClaimSource = 'web' | 'discord';

/**
 * Một lần nhận treo thưởng (spec treo thưởng §3, §6, §8). `role` và `points` là bản chép từ mục lúc
 * nhận (sửa mục sau đó không đổi); `bounty` là tên/mô tả HIỆN TẠI của mục. `playedOn` = ngày VN của
 * buổi (`YYYY-MM-DD`). `rejectReason` là lý do từ chối hoặc huỷ duyệt. `reviewedBy`/`reviewedAt`:
 * người/giờ duyệt hoặc từ chối (từ chối tự động lúc chốt mùa: `reviewedBy = null`).
 */
export interface BountyClaimDto {
  id: number;
  bounty: { id: number; title: string; description: string | null };
  member: { id: number; displayName: string };
  session: { id: number; startsAt: string; modeName: string };
  playedOn: string;
  role: { id: number; nameVi: string; icon: string; faction: Faction } | null;
  points: number;
  status: BountyClaimStatus;
  rejectReason: string | null;
  source: BountyClaimSource;
  createdAt: string;
  reviewedBy: { id: number; displayName: string } | null;
  reviewedAt: string | null;
}

/**
 * `GET /api/sessions/:id/bounties`: mục áp dụng cho buổi (thứ tự của `bountiesForSession`) và mọi lần
 * nhận của người xem ở buổi này (ghép theo `bounty.id`; có thể có lần nhận của mục đã tắt). `attended`:
 * người xem có điểm danh `going`. `open`: buổi chưa huỷ, ngày buổi trong `[hôm nay − 3, hôm nay]` và
 * mùa chưa chốt — `false` thì ẩn nút "Tôi đã hoàn thành" (không tính `attended`).
 */
export interface SessionBountiesDto {
  sessionId: number;
  attended: boolean;
  open: boolean;
  bounties: BountyDto[];
  myClaims: BountyClaimDto[];
}
