/**
 * Khoá TanStack Query dùng chung giữa nhiều trang (một trang sửa/làm mới cache của trang khác).
 * Tách riêng khỏi các module trang để tránh vòng import giữa chúng: trang chỉ cần khoá,
 * không cần kéo cả component trang về.
 */

/** Hàng chờ duyệt của tab Duyệt điểm — trang Khai điểm làm mới sau khi khai hoặc sửa. */
export const PENDING_REPORTS_KEY = ['admin', 'reports', 'pending'] as const;
/** Mục "Đã duyệt gần đây" của tab Duyệt điểm. */
export const APPROVED_REPORTS_KEY = ['admin', 'reports', 'approved'] as const;
/** Danh sách lần khai của chính mình (trang Khai điểm) — tab Duyệt điểm làm mới sau khi huỷ duyệt. */
export const MY_REPORTS_KEY = ['reports', 'mine'] as const;
/** Cache các role đang hoá thân mùa này (trang Hồ sơ) — tab Duyệt điểm làm mới sau khi huỷ duyệt. */
export const TITLES_QUERY_KEY = ['me', 'titles'] as const;
/** Tiền tố khoá trang thành viên công khai (`['member', id]`) — tab Thành viên làm mới sau khi admin sửa số buổi. */
export const MEMBER_QUERY_KEY = ['member'] as const;
