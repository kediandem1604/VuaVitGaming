/**
 * Link "🎬 Xem highlight" tới tin nhắn Discord chứa highlight của một lần khai (spec highlight
 * §3, §9): mở tab mới, `rel` để tab mới không với tay về trang. Dùng ở "Lần khai của tôi" và tab
 * Duyệt điểm — đặt trong cột flex, `self-start` để vùng bấm chỉ rộng bằng chữ. Emoji chỉ trang
 * trí nên tên truy cập của link là "Xem highlight".
 */
export function HighlightLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="self-start text-sm font-bold text-gold underline underline-offset-2">
      <span aria-hidden="true">🎬</span> Xem highlight
    </a>
  );
}
