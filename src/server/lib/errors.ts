/**
 * Lỗi nghiệp vụ dùng chung: mỗi mã có HTTP status và thông báo tiếng Việt mặc định.
 * Thông báo là thứ người dùng thấy (web, Discord) — không bao giờ chứa chi tiết nội bộ.
 */

export type ErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_MEMBER'
  | 'SESSION_NOT_OPEN'
  | 'SESSION_FULL'
  | 'ROUND_CLOSED'
  | 'SELF_VOTE'
  | 'NOT_NOMINEE'
  | 'CATEGORY_NOT_IN_ROUND'
  | 'ROLE_INACTIVE'
  | 'VALUE_OUT_OF_RANGE'
  | 'PLAYED_ON_OUT_OF_WINDOW'
  | 'SEASON_CLOSED'
  | 'RATE_LIMITED'
  | 'NOT_PENDING'
  | 'SELF_REVIEW'
  | 'REASON_REQUIRED'
  | 'INVALID_IMAGE'
  | 'HIGHLIGHT_DISABLED'
  | 'INVALID_HIGHLIGHT'
  | 'HIGHLIGHT_TOO_LARGE'
  | 'DISCORD_UNAVAILABLE';

const DEFAULTS: Record<ErrorCode, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: 'Không tìm thấy' },
  UNAUTHENTICATED: { status: 401, message: 'Bạn cần đăng nhập' },
  FORBIDDEN: { status: 403, message: 'Bạn không có quyền làm việc này' },
  VALIDATION: { status: 400, message: 'Dữ liệu không hợp lệ' },
  NOT_MEMBER: { status: 403, message: 'Bạn cần vào server Discord trước' },
  SESSION_NOT_OPEN: { status: 409, message: 'Buổi chơi đã kết thúc hoặc bị huỷ' },
  SESSION_FULL: { status: 409, message: 'Đã đủ người' },
  ROUND_CLOSED: { status: 409, message: 'Vote đã đóng' },
  SELF_VOTE: { status: 400, message: 'Không được tự vote' },
  NOT_NOMINEE: { status: 400, message: 'Người này không có mặt ở buổi chơi' },
  CATEGORY_NOT_IN_ROUND: { status: 400, message: 'Hạng mục không thuộc đợt vote này' },
  ROLE_INACTIVE: { status: 400, message: 'Role này đang tắt' },
  VALUE_OUT_OF_RANGE: { status: 400, message: 'Giá trị không hợp lệ' },
  PLAYED_ON_OUT_OF_WINDOW: { status: 400, message: 'Chỉ khai được trận trong 3 ngày gần nhất' },
  SEASON_CLOSED: { status: 409, message: 'Mùa này đã chốt' },
  RATE_LIMITED: { status: 429, message: 'Bạn đã khai quá 30 lần hôm nay' },
  NOT_PENDING: { status: 409, message: 'Lần khai này đã được xử lý' },
  SELF_REVIEW: { status: 403, message: 'Mod không được tự duyệt lần khai của mình' },
  REASON_REQUIRED: { status: 400, message: 'Cần ghi lý do từ chối' },
  INVALID_IMAGE: { status: 400, message: 'Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB' },
  HIGHLIGHT_DISABLED: { status: 409, message: 'Chưa bật tính năng highlight' },
  INVALID_HIGHLIGHT: { status: 400, message: 'Highlight phải là video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF' },
  // Nơi ném thường ghi rõ giới hạn hiện hành ("Highlight tối đa N MB"); đây là câu dự phòng.
  HIGHLIGHT_TOO_LARGE: { status: 400, message: 'Highlight quá lớn' },
  DISCORD_UNAVAILABLE: { status: 503, message: 'Không đăng được highlight lên Discord, thử lại sau' },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message?: string) {
    const defaults = DEFAULTS[code];
    super(message ?? defaults.message);
    this.name = 'AppError';
    this.code = code;
    this.status = defaults.status;
  }
}

/** Tạo AppError; bỏ trống `message` để dùng thông báo mặc định của mã lỗi. */
export function appError(code: ErrorCode, message?: string): AppError {
  return new AppError(code, message);
}
