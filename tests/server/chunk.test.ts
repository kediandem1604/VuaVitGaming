import { expect, test } from 'vitest';
import { DISCORD_MESSAGE_MAX, chunkLines } from '../../src/server/lib/chunk.js';

test('chunkLines packs whole lines into parts of at most max characters', () => {
  expect(DISCORD_MESSAGE_MAX).toBe(2000);
  expect(chunkLines([])).toEqual([]);
  expect(chunkLines(['a', 'b'], 10)).toEqual(['a\nb']);
  // 'aaaa\nbbbb' = 9 ký tự vừa đủ; thêm dòng nữa thì sang phần mới, không cắt giữa dòng.
  expect(chunkLines(['aaaa', 'bbbb', 'cc'], 9)).toEqual(['aaaa\nbbbb', 'cc']);
  // Dòng dài hơn max thì cắt cứng.
  expect(chunkLines(['abcdefghij'], 4)).toEqual(['abcd', 'efgh', 'ij']);
  const lines = Array.from({ length: 300 }, (_, i) => `• dòng số ${i}`);
  const parts = chunkLines(lines);
  for (const part of parts) expect(part.length).toBeLessThanOrEqual(2000);
  expect(parts.join('\n')).toBe(lines.join('\n'));
});
