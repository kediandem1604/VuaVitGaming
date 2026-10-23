/**
 * Chọn database cho test: PostgreSQL trong Docker (mặc định, `docker compose up db-test`)
 * hay PostgreSQL nhúng (`GGD_TEST_DB=embedded`, phương án dự phòng khi không có Docker).
 * Hai hàm thuần, không đụng môi trường hay tiến trình — global-setup gọi vào đây.
 */

export type TestDbMode = 'docker' | 'embedded';

/** Cổng của PostgreSQL test (xem `TEST_DATABASE_URL` ở setup.ts) — chỉ để ghi trong thông báo. */
const TEST_PORT = 54330;

/**
 * `GGD_TEST_DB` trống hoặc không đặt → `docker`; `embedded` (không phân biệt hoa thường)
 * → `embedded`. Giá trị khác bị từ chối ngay (gõ nhầm `embeded` mà lặng lẽ chạy Docker
 * thì người dùng tưởng đang chạy bản nhúng).
 */
export function testDbMode(env: Record<string, string | undefined>): TestDbMode {
  const raw = env.GGD_TEST_DB?.trim().toLowerCase() ?? '';
  if (raw === '' || raw === 'docker') return 'docker';
  if (raw === 'embedded') return 'embedded';
  throw new Error(`GGD_TEST_DB không hợp lệ: "${env.GGD_TEST_DB}" — chỉ nhận "docker" (mặc định) hoặc "embedded".`);
}

/** Thông báo khi không bật được PostgreSQL test bằng Docker: cả hai lối ra, kèm nguyên văn lỗi gốc. */
export function dockerHelp(detail: string): string {
  return [
    'Không bật được PostgreSQL test bằng Docker (docker compose up -d --wait db-test).',
    'Cách xử lý:',
    '  • Bật Docker Desktop rồi chạy lại; hoặc',
    '  • Dùng PostgreSQL nhúng: GGD_TEST_DB=embedded npm test',
    "    (PowerShell: $env:GGD_TEST_DB='embedded'; npm test).",
    `  • Nếu cổng ${TEST_PORT} đang bị chiếm, tắt PostgreSQL nhúng cũ (postgres.exe của lần chạy trước) rồi thử lại.`,
    'Lỗi gốc:',
    detail.trim() === '' ? '  (không có thông tin thêm)' : detail.trimEnd(),
  ].join('\n');
}
