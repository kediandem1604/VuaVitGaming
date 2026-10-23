/** Giới hạn độ dài một tin Discord. */
export const DISCORD_MESSAGE_MAX = 2000;

/**
 * Ghép các dòng thành từng đoạn ≤ `max` ký tự, chỉ cắt giữa hai dòng (dòng dài quá
 * `max` thì cắt cứng). Ghép các đoạn lại bằng `\n` cho đúng văn bản ban đầu (trừ chỗ
 * cắt cứng). Không có dòng nào → không có đoạn nào.
 */
export function chunkLines(lines: string[], max: number = DISCORD_MESSAGE_MAX): string[] {
  const chunks: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    for (let i = 0; i < Math.max(1, line.length); i += max) {
      const piece = line.slice(i, i + max);
      if (current === null) current = piece;
      else if (current.length + 1 + piece.length <= max) current += `\n${piece}`;
      else {
        chunks.push(current);
        current = piece;
      }
    }
  }
  if (current !== null) chunks.push(current);
  return chunks;
}
