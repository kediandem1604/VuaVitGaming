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
/** Tiền tố khoá bảng "Tổng điểm theo phe" (`['leaderboard-totals', mùa]`) — tab Duyệt điểm làm mới sau khi huỷ duyệt. */
export const LEADERBOARD_TOTALS_KEY = ['leaderboard-totals'] as const;
/** Danh sách mục treo thưởng của tab Quản trị → Treo thưởng. */
export const ADMIN_BOUNTIES_KEY = ['admin', 'bounties'] as const;
/** Hàng chờ "Treo thưởng chờ duyệt" của tab Duyệt điểm — trang Hôm nay làm mới sau khi nhận. */
export const PENDING_BOUNTY_CLAIMS_KEY = ['admin', 'bounty-claims', 'pending'] as const;
/** Lần nhận treo thưởng đã duyệt trong mục "Đã duyệt gần đây" của tab Duyệt điểm. */
export const APPROVED_BOUNTY_CLAIMS_KEY = ['admin', 'bounty-claims', 'approved'] as const;
/** "Treo thưởng của tôi" (trang Khai điểm) — trang Hôm nay và tab Duyệt điểm làm mới. */
export const MY_BOUNTY_CLAIMS_KEY = ['bounty-claims', 'mine'] as const;
/** Tiền tố khoá thẻ treo thưởng của từng buổi (`['session-bounties', id]`) — tab Treo thưởng và Duyệt điểm làm mới. */
export const SESSION_BOUNTIES_KEY = ['session-bounties'] as const;
/** Ngày nhân điểm từ hôm nay trở đi — banner ở mọi trang và gợi ý ở form Khai điểm; tab Cài đặt làm mới sau khi thêm/sửa/xoá. */
export const MULTIPLIER_UPCOMING_KEY = ['multiplier-days', 'upcoming'] as const;
/** Danh sách ngày nhân điểm của tab Quản trị → Cài đặt (kèm ngày đã qua của mùa đang mở). */
export const ADMIN_MULTIPLIER_DAYS_KEY = ['admin', 'multiplier-days'] as const;
