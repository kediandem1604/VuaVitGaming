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

/** Thân phản hồi của mọi lỗi API. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}
