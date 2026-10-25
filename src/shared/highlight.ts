/**
 * Highlight kèm lần khai điểm (spec highlight §8): content-type được nhận ở
 * `PUT /api/reports/:id/highlight`. Dùng chung server (parser body thô, guard JSON) và web
 * (ô chọn file, nhận diện loại trước khi tải lên) để hai bên không lệch nhau. Không import
 * gì từ server hay Prisma — web build cũng biên dịch file này.
 */

/** Video MP4, WebM, MOV (QuickTime) và ảnh PNG, JPG, GIF. Chỉ để qua cửa: server nhận diện loại thật theo nội dung file. */
export const HIGHLIGHT_CONTENT_TYPES: readonly string[] = ['video/mp4', 'video/webm', 'video/quicktime', 'image/png', 'image/jpeg', 'image/gif'];
