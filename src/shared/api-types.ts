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

/** Hạng mục tri ân cho trang quản trị (`/api/admin/categories`); `mode` chỉ có khi `scope = 'mode'`. */
export interface AwardCategoryDto {
  id: number;
  scope: CategoryScope;
  mode: ModeDto | null;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
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

/** Trạng thái một lần khai điểm: chờ duyệt, đã duyệt, bị từ chối. */
export type ReportStatus = 'pending' | 'approved' | 'rejected';

/**
 * Một lần khai điểm (lịch sử của tôi, hàng chờ duyệt). `playedOn` dạng `YYYY-MM-DD`
 * (ngày VN), `createdAt` ISO 8601 (UTC). `rejectReason` chỉ có khi `status = 'rejected'`.
 */
export interface ReportDto {
  id: number;
  member: { id: number; displayName: string };
  role: { id: number; nameVi: string; icon: string; metricLabel: string };
  value: number;
  playedOn: string;
  sessionId: number | null;
  note: string | null;
  status: ReportStatus;
  rejectReason: string | null;
  createdAt: string;
}

/**
 * Một dòng bảng xếp hạng của một role trong một mùa. Hạng 1..n liên tiếp (không đồng
 * hạng); `lastApprovedAt` ISO 8601 (UTC) là lần duyệt gần nhất của người đó ở role này
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

export type MemberStatus = 'active' | 'left';

/**
 * Một thành viên trong trang quản trị (`GET /api/admin/members`, mod/admin). `email`
 * chỉ có giá trị khi NGƯỜI XEM là admin — mod luôn nhận `null`. `joinedAt` ISO 8601 (UTC).
 */
export interface AdminMemberDto {
  id: number;
  memberCode: string;
  displayName: string;
  accessLevel: AccessLevel;
  status: MemberStatus;
  email: string | null;
  joinedAt: string;
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
