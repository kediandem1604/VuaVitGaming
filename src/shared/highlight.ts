/**
 * Highlight kèm lần khai điểm (spec highlight §7, §8): content-type được nhận ở
 * `PUT /api/reports/:id/highlight` và hai câu báo lỗi về file. Dùng chung server (parser body thô,
 * guard JSON, mã lỗi) và web (ô chọn file, kiểm tra trước khi tải lên) để hai bên không lệch
 * nhau. Không import gì từ server hay Prisma — web build cũng biên dịch file này.
 */

/** Video MP4, WebM, MOV (QuickTime) và ảnh PNG, JPG, GIF. Chỉ để qua cửa: server nhận diện loại thật theo nội dung file. */
export const HIGHLIGHT_CONTENT_TYPES: readonly string[] = ['video/mp4', 'video/webm', 'video/quicktime', 'image/png', 'image/jpeg', 'image/gif'];

/** Câu của lỗi `INVALID_HIGHLIGHT` (spec highlight §7.3): file không phải loại được nhận, hoặc rỗng. */
export const INVALID_HIGHLIGHT_MESSAGE = 'Highlight phải là video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF';

const MIB = 1024 * 1024;

/** Giới hạn dung lượng viết theo MiB như Discord: 10 MiB → "10 MB". */
export function highlightLimitLabel(maxBytes: number): string {
  return `${Math.floor(maxBytes / MIB)} MB`;
}

/** Câu của lỗi `HIGHLIGHT_TOO_LARGE` theo giới hạn hiện hành (spec highlight §7.4): "Highlight tối đa 10 MB". */
export function highlightLimitMessage(maxBytes: number): string {
  return `Highlight tối đa ${highlightLimitLabel(maxBytes)}`;
}
