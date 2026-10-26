/**
 * Chữ gửi lên Discord từ tầng service (không import discord.js ở đây — adapter bot mới
 * được dùng thư viện đó). Tên người do thành viên tự đặt nên có thể chứa ký tự định dạng
 * Markdown của Discord; tin tổng kết phải hiện đúng tên, không bị in đậm / gạch / ẩn.
 */

/**
 * Chèn `\` trước mọi ký tự Discord dùng để định dạng trong một dòng chữ: `\`, `*`, `_`,
 * `~`, `` ` ``, `|` (cùng tập mặc định của `escapeMarkdown` trong discord.js). Ký tự chỉ
 * có nghĩa ở đầu dòng (`#`, `>`, `-`) không cần escape vì tên người không bao giờ đứng
 * đầu dòng trong các tin của app. Không ngăn ping — việc đó do `allowedMentions` lúc gửi.
 */
export function escapeDiscordMarkdown(text: string): string {
  return text.replace(/[\\*_~`|]/g, '\\$&');
}
