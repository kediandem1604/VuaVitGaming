/**
 * Đường dẫn nội bộ dùng chung giữa các trang, để mọi link tới cùng một trang xây một kiểu.
 * Tách riêng khỏi các trang: trang khác chỉ cần đường dẫn, không cần kéo cả component trang về.
 */

/** Trang thành viên công khai (`/thanh-vien/:id`, spec huy hiệu §9) của một thành viên. */
export function memberPath(id: number): string {
  return `/thanh-vien/${id}`;
}
