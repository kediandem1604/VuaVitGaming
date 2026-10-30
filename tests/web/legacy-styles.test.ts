import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, test } from 'vitest';

/**
 * Chốt dọn dẹp giao diện "Sảnh đêm" (spec §3.3, §3.6): web chỉ còn bản tối, nên không
 * file nào dưới `src/web` được giữ lớp `dark:` hay màu `slate-*` của giao diện cũ, và
 * utility `card` (bí danh tạm của `panel` từ Task 2) cùng biến thể `dark` tạm thời đã bị
 * xoá khỏi `styles.css`. Test đọc thẳng mã nguồn để các lớp cũ không quay lại về sau.
 */

// Môi trường jsdom cho `import.meta.url` dạng http, nên đi từ `__dirname` của vitest.
const WEB_ROOT = resolve(__dirname, '../../src/web');
const STYLES_CSS = join(WEB_ROOT, 'styles.css');

/** Đệ quy mọi file .ts/.tsx/.css dưới `src/web`, đường dẫn tuyệt đối. */
function webSourceFiles(dir: string = WEB_ROOT): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...webSourceFiles(path));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Các dòng của `file` khớp `pattern`, ghi dạng `đường-dẫn:số-dòng: nội dung` để lỗi chỉ thẳng chỗ sửa. */
function offendingLines(file: string, pattern: RegExp, lineFilter: (line: string) => boolean = () => true): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      lineFilter(line) && pattern.test(line) ? [`${relative(WEB_ROOT, file)}:${index + 1}: ${line.trim()}`] : [],
    );
}

const FILES = webSourceFiles();

test('src/web has source files to check', () => {
  expect(FILES.length).toBeGreaterThan(10);
  expect(FILES).toContain(STYLES_CSS);
});

test('no light-theme or slate classes remain in the web app', () => {
  // `translate-x-5` chứa "slate-" nên cần ranh giới từ; `dark:` cũng vậy để không bắt nhầm chữ trong câu.
  const offenders = FILES.flatMap((file) => offendingLines(file, /\bdark:|\bslate-\d/));
  expect(offenders).toEqual([]);
});

test('the old card utility and the transitional dark variant are gone from styles.css', () => {
  const css = readFileSync(STYLES_CSS, 'utf8');
  expect(css).not.toContain('@utility card');
  expect(css).not.toContain('@custom-variant dark');
});

test('no .tsx file still uses the bare card class', () => {
  // Chỉ xét dòng có className= hoặc cx(; `card` phải đứng riêng trong chuỗi lớp (cạnh dấu nháy hay khoảng trắng).
  const offenders = FILES.filter((file) => file.endsWith('.tsx')).flatMap((file) =>
    offendingLines(file, /["'`\s]card["'`\s]/, (line) => line.includes('className=') || line.includes('cx(')),
  );
  expect(offenders).toEqual([]);
});
