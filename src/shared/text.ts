/**
 * Chuẩn hoá chữ để so khớp không phân biệt hoa thường và dấu: gợi ý role trong lệnh
 * slash (bot) và ô tìm role trên web dùng chung. Dùng chung server và web — không
 * import gì từ server hay Prisma.
 */

/**
 * Chữ thường → tách tổ hợp (NFD) rồi bỏ mọi dấu kết hợp → `đ` → `d` (NFD không tách
 * được chữ này) → gộp khoảng trắng liên tiếp thành một → cắt hai đầu.
 * `normalizeText('Kiếm sĩ') === 'kiem si'`, `normalizeText('Đa đa') === 'da da'`.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}
