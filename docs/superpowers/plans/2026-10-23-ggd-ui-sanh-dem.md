# GGD Hub — Giao diện "Sảnh đêm" + Docker: kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm lại toàn bộ giao diện web theo phong cách "Sảnh đêm" giống game Goose Goose Duck (nhân vật ngỗng trắng đội đồ theo role) và chuyển database dev/test sang Docker.

**Architecture:** Chỉ đụng lớp web (`src/web`), hạ tầng test (`tests/helpers`) và file chạy/đóng gói (Docker, scripts, CI, README). Bộ token màu nằm ở `styles.css` (`@theme`) và được kiểm bằng test so với `src/web/lib/palette.ts`. Nhân vật = `GooseBody` + một "bộ đồ" (kit) chọn theo `role.key` qua `kitForRole`. Các trang giữ nguyên dữ liệu, API, nhãn truy cập; chỉ đổi cách trình bày.

**Tech Stack:** React 19, React Router 7, TanStack Query 5, Tailwind 4 (`@theme`, `@utility`), Vite 6, Vitest 3 + Testing Library (jsdom), `@fontsource-variable/baloo-2`, `lucide-react`, Docker Compose v2 + `postgres:16-alpine`.

**Spec:** `docs/superpowers/specs/2026-10-23-ggd-ui-sanh-dem-design.md` (đọc kèm; spec gốc `2026-10-22-ggd-hub-design.md` cho mọi thứ không đổi).

## Global Constraints

- Không sửa code server, API, schema Prisma, email, embed Discord. Ngoại lệ: `tests/helpers/*`, `scripts/*`, `package.json`, file Docker/CI/README/`.env.example`.
- Mọi chữ người dùng thấy là tiếng Việt có dấu. Comment trong code viết tiếng Việt như phần còn lại của repo.
- Không dùng hình, logo, font gốc của game; mọi hình là SVG tự vẽ.
- Màu phe giữ nguyên: Ngỗng `#2F80ED`, Vịt `#E5484D`, Phe thứ 3 `#8E4EC6`.
- Chỉ giao diện tối: `color-scheme: dark`; cuối cùng không còn lớp `dark:` hay `slate-` nào trong `src/web`.
- Chữ đạt ≥ 4.5:1, chữ lớn (≥ 18.67px đậm) và viền ô nhập liệu/icon ≥ 3:1.
- Hoạt ảnh chỉ trong `@media (prefers-reduced-motion: no-preference)`.
- Giữ nguyên props của `Character` (`role, holderName, variant, size, className`); chỉ được thêm prop tuỳ chọn.
- Giữ nguyên chữ, nhãn `aria-*`, vai trò ARIA mà test hiện có dựa vào, trừ chỗ task ghi rõ là đổi.
- Không cuộn ngang ở 320px trên mọi trang.
- Dependency mới chỉ có `@fontsource-variable/baloo-2` và `lucide-react` (đặt trong `dependencies`).
- Docker: ảnh `postgres:16-alpine`; cổng chỉ mở trên `127.0.0.1`; chuỗi kết nối giữ nguyên `postgresql://ggd:ggd@localhost:54329/ggd_dev` (dev) và `…:54330/ggd_test` (test).
- File LF. Commit message tiếng Anh dạng `feat:/fix:/test:/docs:/chore:`, kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Chỉ commit trên nhánh `feat/ui-sanh-dem`, không push.

## Review Focus

1. **Tên dài ở 320px**: tên người 24 ký tự, role "Người vận động hành lang", "Kẻ điều khiển giấc mơ" trong `RoleCard`, bục xếp hạng, gợi ý role → phải xuống dòng hoặc cắt "…", không tràn ngang. (Test ở Task 6 và kiểm trình duyệt ở Task 11.)
2. **Hàng ghế khi dữ liệu lệch**: số người tham gia lớn hơn `capacity` (dữ liệu cũ hoặc admin vừa giảm sức chứa) → hiện đủ mọi người, không ô âm, không mất avatar. (Test ở Task 7.)
3. **Đếm ngược ở mép**: còn dưới 1 phút, đúng giờ bắt đầu, đã quá giờ, còn hơn 1 ngày, buổi đã huỷ/kết thúc → chữ đúng, không hiện số âm. (Test ở Task 7.)
4. **Docker không sẵn sàng**: Docker Desktop chưa bật, hoặc cổng 54330 đang bị PostgreSQL nhúng cũ chiếm → `npm test` dừng với hướng dẫn tiếng Việt, không treo. (Test ở Task 1.)
5. **Ảnh role tuỳ chỉnh và trạng thái trống**: role có ảnh admin tải lên, hoặc chưa ai giữ → không vẽ bộ đồ đè lên ảnh/hình bóng. (Test ở Task 3 và Task 4.)

---

### Task 1: Docker cho database dev/test, chạy thử app, dữ liệu mẫu

**Files:**
- Create: `docker-compose.yml`, `tests/helpers/test-db.ts`, `tests/server/test-db.test.ts`, `scripts/demo-data.ts`
- Modify: `tests/helpers/global-setup.ts`, `package.json` (scripts), `.github/workflows/ci.yml`, `.env.example`, `README.md` (§1, §7, §8, §11, §12)

**Interfaces:**
- Produces: `testDbMode(env: Record<string, string | undefined>): 'docker' | 'embedded'`; `dockerHelp(detail: string): string`; lệnh `npm run db:start | db:stop | db:start:embedded | db:demo | app:docker`.
- Produces (cho các task giao diện): `npm run db:demo` nạp dữ liệu mẫu vào DB dev để xem giao diện qua `/auth/dev-login?discordId=demo-admin` (cần `DEV_LOGIN=1`).

- [ ] **Step 1: Viết test hỏng** trong `tests/server/test-db.test.ts`:

```ts
test('docker is the default test database', () => {
  expect(testDbMode({})).toBe('docker');
  expect(testDbMode({ GGD_TEST_DB: '' })).toBe('docker');
});
test('GGD_TEST_DB=embedded selects the embedded database, any case', () => {
  expect(testDbMode({ GGD_TEST_DB: 'embedded' })).toBe('embedded');
  expect(testDbMode({ GGD_TEST_DB: 'EMBEDDED' })).toBe('embedded');
});
test('an unknown GGD_TEST_DB value is rejected instead of silently ignored', () => {
  expect(() => testDbMode({ GGD_TEST_DB: 'embeded' })).toThrow(/GGD_TEST_DB/);
});
test('docker help tells the user both ways out and keeps the original error', () => {
  const text = dockerHelp('Cannot connect to the Docker daemon');
  expect(text).toContain('Docker Desktop');
  expect(text).toContain('GGD_TEST_DB=embedded');
  expect(text).toContain('54330');
  expect(text).toContain('Cannot connect to the Docker daemon');
});
```

- [ ] **Step 2: Chạy** `npx vitest run tests/server/test-db.test.ts` → FAIL (chưa có module).
- [ ] **Step 3: Viết `tests/helpers/test-db.ts`** với hai hàm trên. `dockerHelp` nói: không bật được PostgreSQL test bằng Docker; bật Docker Desktop rồi chạy lại, hoặc chạy `GGD_TEST_DB=embedded npm test` (PowerShell: `$env:GGD_TEST_DB='embedded'; npm test`); nếu cổng 54330 đang bị chiếm thì tắt PostgreSQL nhúng cũ; kèm nguyên văn lỗi gốc.
- [ ] **Step 4: Viết `docker-compose.yml`** đúng bảng §7.1 của spec: `db` (volume `ggd-pgdata`, healthcheck `pg_isready -U ggd -d ggd_dev`, `interval: 2s`, `retries: 30`), `db-test` (`tmpfs: /var/lib/postgresql/data`, `command: postgres -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, healthcheck tương tự với `ggd_test`), `app` (`build: .`, `profiles: [app]`, `env_file: ${GGD_ENV_FILE:-.env}`, `environment: { DATABASE_URL: postgresql://ggd:ggd@db:5432/ggd_dev, PORT: "3000" }`, `depends_on: { db: { condition: service_healthy } }`). Mọi `ports` dạng `"127.0.0.1:<máy>:<container>"`.
- [ ] **Step 5: Sửa `global-setup.ts`**: `testDbMode(process.env)`; `embedded` → giữ nguyên đường cũ; `docker` → chạy `docker compose up -d --wait db-test` (cwd = gốc repo, gom stdout/stderr); mã thoát khác 0 hoặc lỗi spawn → `throw new Error(dockerHelp(output))`. Sau đó `prismaMigrateDeploy` + `dropLeftoverTestObjects` như cũ. Teardown của nhánh Docker không làm gì (container để chạy sẵn).
- [ ] **Step 6: Script npm**: `"db:start": "docker compose up -d --wait db"`, `"db:stop": "docker compose stop db db-test"`, `"db:start:embedded": "tsx scripts/dev-db.ts"`, `"db:demo": "tsx scripts/demo-data.ts"`, `"app:docker": "docker compose --profile app up --build app"`.
- [ ] **Step 7: Viết `scripts/demo-data.ts`**: nối `DATABASE_URL` (từ `.env`/môi trường), từ chối chạy nếu URL không phải `localhost`/`127.0.0.1`; gọi `seedReferenceData`; tạo (idempotent, theo `discordId` cố định `demo-*`) ~12 thành viên tên tiếng Việt (có một tên 24 ký tự) với `demo-admin` là admin; hôm nay 2 buổi chơi (một buổi 8/12 người, một buổi đã huỷ); một vòng vote đã đóng có kết quả cho 2–3 hạng mục; báo cáo điểm đã duyệt cho khoảng 15 role rải đủ 3 phe để Đại sảnh có người hoá thân, vài báo cáo chờ duyệt. Dùng service có sẵn trong `src/server/modules/*` thay vì tự ghi bảng khi service có hàm phù hợp.
- [ ] **Step 8: CI và tài liệu**: CI giữ nguyên các bước (global-setup tự bật `db-test`; máy Ubuntu có Docker), sửa comment đầu file. README: §1 bỏ "Không cần Docker" → cần Docker Desktop, có phương án dự phòng; §7 bảng lệnh mới + `db:demo` + đăng nhập thử qua dev-login; §8 test chạy bằng Docker, `GGD_TEST_DB=embedded`; §11/§12 bỏ ghi chú "Docker hỏng, Dockerfile chưa build thử" và thêm mục sự cố "Docker Desktop crash vì file socket `dockerInference`" → tắt Settings → AI → Docker Model Runner, đổi tên `%LOCALAPPDATA%\Docker\run`. `.env.example`: chú thích dòng `DATABASE_URL` thành "PostgreSQL dev (npm run db:start bằng Docker, hoặc db:start:embedded)".
- [ ] **Step 9: Kiểm tra**
  - `npx vitest run tests/server/test-db.test.ts` → PASS.
  - `npm test` (Docker) → toàn bộ PASS.
  - PowerShell `$env:GGD_TEST_DB='embedded'; npm test` → toàn bộ PASS.
  - `npm run db:start; npm run db:migrate; npm run db:demo` → chạy không lỗi, chạy lại lần hai cũng không lỗi.
  - `docker build .` → thành công.
  - Tạo file env giả ngoài repo (giá trị Discord/SMTP giả, `SESSION_SECRET` 32+ ký tự, `PUBLIC_URL=http://localhost:3000`), `GGD_ENV_FILE=<đường dẫn> npm run app:docker` (chạy nền), `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/healthz` → `200`; rồi `docker compose --profile app down`.
- [ ] **Step 10: Commit** `feat: run the dev and test databases in Docker, add demo data and a local production run`.

---

### Task 2: Bộ nhận diện — token màu, font, icon, utility

**Files:**
- Create: `src/web/lib/palette.ts`, `tests/web/palette.test.ts`
- Modify: `src/web/styles.css`, `src/web/index.html`, `src/web/main.tsx`, `package.json` (dependencies)

**Interfaces:**
- Produces: `PALETTE` (object `as const`, key = tên token trong spec §3.1 + `ink: '#231A3A'`, `beak: '#FF9F1C'`, `wing: '#E6E2F0'`, `white: '#FFFFFF'`, `discord: '#5865F2'`); `contrastRatio(a: string, b: string): number` (WCAG 2.x).
- Produces utility CSS: `panel`, `panel-inset`, `btn-primary`, `btn-secondary`, `btn-danger`, `field`, `chip`, `lift` (nhích lên 2px khi rê chuột, chỉ trong `@media (hover: hover)` và khối reduced-motion), và lớp màu Tailwind `bg-night-900`, `text-night-300`, `border-night-950`, `bg-gold`, `text-gold-ink`, `bg-goose-strong`, `text-duck-soft`, `text-ok`… sinh từ `@theme`. `card` tạm là bí danh của `panel` (xoá ở Task 11). Font family `'Baloo 2 Variable'`.

- [ ] **Step 1: Viết test hỏng** `tests/web/palette.test.ts`:

```ts
test('contrastRatio follows WCAG', () => {
  expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  expect(contrastRatio('#2A3070', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#2A3070'), 5);
});
test('styles.css declares every palette token with the same value', () => {
  // đọc src/web/styles.css bằng fs; với mỗi tên trong TOKENS (danh sách token spec §3.1)
  // tìm `--color-${name}:\s*(#[0-9A-Fa-f]{6})` và so (không phân biệt hoa thường) với PALETTE[name]
});
test.each([
  ['white', 'night-800', 4.5], ['night-200', 'night-800', 4.5], ['night-300', 'night-800', 4.5],
  ['night-300', 'night-900', 4.5], ['gold-ink', 'gold', 4.5], ['gold', 'night-800', 4.5],
  ['white', 'goose-strong', 4.5], ['white', 'duck-strong', 4.5], ['white', 'third', 4.5],
  ['goose-soft', 'night-800', 4.5], ['duck-soft', 'night-800', 4.5], ['third-soft', 'night-800', 4.5],
  ['ok', 'night-800', 4.5], ['white', 'night-700', 4.5], ['white', 'discord', 4.5],
  ['night-600', 'night-800', 3], ['night-600', 'night-900', 3],
])('%s on %s reaches %s:1', (fg, bg, min) => {
  expect(contrastRatio(PALETTE[fg], PALETTE[bg])).toBeGreaterThanOrEqual(min);
});
```

- [ ] **Step 2: Chạy** `npx vitest run tests/web/palette.test.ts` → FAIL.
- [ ] **Step 3: Viết `palette.ts`** với đúng giá trị spec §3.1, và `contrastRatio`.
- [ ] **Step 4: Cài dependency** `npm install @fontsource-variable/baloo-2 lucide-react`.
- [ ] **Step 5: Viết lại `styles.css`**: `@theme` cho mọi token (`--color-<tên>`) + `--font-sans: 'Baloo 2 Variable', system-ui, sans-serif`; `:root { color-scheme: dark }`; `body` nền `night-900` + chấm sao (`radial-gradient` lặp, 2 lớp chấm lệch nhau, độ mờ thấp), chữ `night-200`, `font-weight: 500`; các `@utility` ở spec §3.3 (nút khối: viền 3px + `border-bottom-width: 6px`, `:active` → `border-bottom-width: 3px; transform: translateY(3px)`, `disabled` không lún); `:focus-visible` outline 3px `gold` offset 2px cho `a, button, input, select, textarea, [tabindex]`; giữ các khối `@keyframes`/`.duck-*` hiện có (Task 5 mới đổi). Bỏ mọi `dark:` trong `styles.css`.
- [ ] **Step 6: `index.html`**: `color-scheme` = `dark`, thêm `<meta name="theme-color" content="#1B1F4A" />`. `main.tsx`: `import '@fontsource-variable/baloo-2';` trước `./styles.css`.
- [ ] **Step 7: Kiểm tra** `npx vitest run tests/web/palette.test.ts` → PASS; `npm run typecheck` và `npm test` → PASS; `npm run build` → PASS.
- [ ] **Step 8: Commit** `feat: night-lobby design tokens, Baloo 2 font and chunky button utilities`.

---

### Task 3: Dáng ngỗng mới, bảng ánh xạ bộ đồ, `Character` với huy hiệu

**Files:**
- Create: `src/web/components/goose/GooseBody.tsx`, `src/web/components/goose/kits/index.tsx`, `src/web/components/goose/kits/Badge.tsx`, `src/web/lib/roleKits.ts`, `tests/web/roleKits.test.ts`
- Modify: `src/web/components/Character.tsx`, `tests/web/Character.test.tsx`

**Interfaces:**
- Consumes: `PALETTE` (Task 2).
- Produces:
  - `type Kit = 'knife' | 'sword' | 'detective' | 'police' | 'ninja' | 'wizard' | 'engineer' | 'bomb' | 'crown' | 'heart' | 'clown' | 'halo' | 'explorer' | 'sniper' | 'bird' | 'pouch' | 'vampire' | 'badge'`; `KITS: readonly Kit[]`.
  - `kitForRole(key: string): Kit`; `birdCrestColour(key: string): string` (hex; key không phải chim → `PALETTE['night-600']`).
  - `GooseBody({ silhouette }: { silhouette?: boolean })`: vẽ trong toạ độ khung `0 0 120 160`, chân chạm đất ở y≈152, đầu khoảng y 40–70 (chừa y < 36 cho bảng tên). Thân có `data-part="body"`; `silhouette` → tô `night-600`, không mắt, không mỏ.
  - `KitArt({ kit, role, layer }: { kit: Kit; role: RoleDto; layer: 'back' | 'front' })`: lớp `back` vẽ sau thân, `front` vẽ trước. Lớp `front` của mọi kit có gốc `<g data-kit={kit}>`. Ở task này mọi kit khác `badge` tạm vẽ như `badge` (Task 4 thay).
  - `Character` vẽ theo thứ tự: vòng sáng phe (`data-part="glow"`, elip dưới chân tô màu phe, mờ) → `KitArt back` → `GooseBody` → `KitArt front` → bảng tên → nhãn "Mùa trước". Hình (trừ bảng tên) nằm trong `<g data-part="figure">`; `previous` → `figure` có `opacity="0.45"`. `empty` → `GooseBody silhouette`, không glow, không kit. `hasImage` → không `GooseBody`, không kit, vẫn có glow và bảng tên.
  - Hoạt ảnh nhún/chớp mắt: lớp CSS `goose-idle` trên `figure`, `goose-eyes` trên nhóm mắt (keyframes thêm vào `styles.css`, trong khối reduced-motion).

- [ ] **Step 1: Viết test hỏng** `tests/web/roleKits.test.ts`: một hằng `EXPECTED: Record<Exclude<Kit, 'badge'>, string[]>` chép nguyên bảng spec §4.2, rồi:

```ts
test('every role in the spec table gets its kit', () => {
  for (const [kit, keys] of Object.entries(EXPECTED)) for (const key of keys) expect(kitForRole(key)).toBe(kit);
});
test('seeded roles outside the table, and unknown keys, wear the badge', () => {
  const mapped = new Set(Object.values(EXPECTED).flat());
  for (const role of ROLES) if (!mapped.has(role.key)) expect(kitForRole(role.key)).toBe('badge');
  expect(kitForRole('goose')).toBe('badge');
  expect(kitForRole('khong-co-role-nay')).toBe('badge');
});
test('every spec key exists in the seed', () => {
  const seeded = new Set(ROLES.map((r) => r.key));
  for (const key of Object.values(EXPECTED).flat()) expect(seeded.has(key)).toBe(true);
});
test('each bird has its own crest colour', () => {
  const colours = EXPECTED.bird.map(birdCrestColour);
  expect(new Set(colours).size).toBe(EXPECTED.bird.length);
  for (const c of colours) expect(c).toMatch(/^#[0-9A-F]{6}$/i);
});
```

(`ROLES` import từ `src/server/seed/roles.ts`.)

- [ ] **Step 2: Sửa `tests/web/Character.test.tsx`** theo thiết kế mới (giữ nguyên các test bảng tên dài/vừa):
  - Thay `body is tinted by faction` bằng `body is white and the faction shows in the glow under the feet`: `[data-part="body"]` có `fill="#FFFFFF"`; `[data-part="glow"]` có `fill` = `#E5484D` (vịt), `#2F80ED` (ngỗng), `#8E4EC6` (phe 3).
  - `previous holder is marked`: nhãn + "Mùa trước" + `[data-part="figure"]` có `opacity="0.45"`.
  - `custom image replaces drawing`: thuộc tính `img` như cũ; `[data-part="body"]` và `[data-kit]` đều không có; `[data-part="glow"]` và bảng tên vẫn có.
  - `empty variant says nobody holds the role`: nhãn + chữ bảng tên không trắng; `[data-part="body"]` có `fill` = `PALETTE['night-600']`; không `[data-kit]`, không `[data-part="glow"]`; không "Mùa trước".
  - `default badge carries the role icon and size caps the width`: dùng role `{ ...swordsman, key: 'goose', icon: '🪿', faction: 'goose' }`, thấy `🪿`, `maxWidth: 96px`, không `mx-auto`, có `[data-kit="badge"]`.
- [ ] **Step 3: Chạy** `npx vitest run tests/web/roleKits.test.ts tests/web/Character.test.tsx` → FAIL.
- [ ] **Step 4: Viết `roleKits.ts`, `GooseBody.tsx`, `kits/Badge.tsx`** (huy hiệu tròn trắng trên ngực, viền màu phe 2.5, emoji `role.icon` giữa), `kits/index.tsx`, rồi viết lại `Character.tsx` theo Interfaces. Hình dáng theo spec §4.1 (bản xem trước đã duyệt: thân trứng, viền `ink` 3–4, cánh `wing`, mắt đen to có đốm sáng, mỏ `beak` bo tròn, hai bàn chân `beak`).
- [ ] **Step 5: Chạy** hai file test trên → PASS; `npm test` → PASS (các trang dùng `Character` không phải đổi).
- [ ] **Step 6: Commit** `feat: game-style white goose character with a role-to-kit map`.

---

### Task 4: 17 bộ đồ theo role

**Files:**
- Create: `src/web/components/goose/kits/{Knife,Sword,Detective,Police,Ninja,Wizard,Engineer,Bomb,Crown,Heart,Clown,Halo,Explorer,Sniper,Bird,Pouch,Vampire}.tsx`, `scripts/kit-gallery.tsx`, `tests/web/kits.test.tsx`
- Modify: `src/web/components/goose/kits/index.tsx`

**Interfaces:**
- Consumes: `Kit`, `KITS`, `kitForRole`, `birdCrestColour`, `KitArt` (Task 3).
- Produces: `KitArt` vẽ đúng hình cho mọi kit. Kit có phần sau thân (`explorer` ba lô, `vampire` áo choàng, `heart` đôi cánh) vẽ phần đó ở `layer="back"`. `scripts/kit-gallery.tsx` in ra một trang HTML tĩnh (dùng `renderToStaticMarkup`) có 18 nhân vật mẫu, mỗi kit một con, kèm tên kit.

- [ ] **Step 1: Viết test hỏng** `tests/web/kits.test.tsx`:

```ts
test.each(KITS.filter((k) => k !== 'badge'))('%s draws its own art instead of the badge', (kit) => {
  const key = firstKeyFor(kit); // tìm trong ROLES role đầu tiên có kitForRole(key) === kit
  render(<Character role={roleFromSeed(key)} holderName="Kẹ" variant="current" />);
  const art = document.querySelector(`[data-kit="${kit}"]`);
  expect(art).not.toBeNull();
  expect(art!.childElementCount).toBeGreaterThan(0);
  expect(screen.queryByText(roleFromSeed(key).icon)).toBeNull();
});
test('every seeded role renders a labelled character', () => {
  for (const seed of ROLES) {
    const { unmount } = render(<Character role={roleFromSeed(seed.key)} holderName="Kẹ" variant="current" />);
    expect(screen.getByRole('img', { name: `${seed.nameVi}: Kẹ` })).toBeInTheDocument();
    unmount();
  }
});
test('the crest colour differs between birds', () => {
  // render raven và pigeon; fill của `[data-kit="bird"] [data-part="crest"]` khác nhau và bằng birdCrestColour(key)
});
test('kits never draw over an uploaded image or an empty slot', () => {
  // swordsman với hasImage: true → không [data-kit]; swordsman variant empty → không [data-kit]
});
```

(`roleFromSeed(key)` dựng `RoleDto` từ `ROLES` với `id` = vị trí + 1, `hasImage: false`.)
- [ ] **Step 2: Chạy** `npx vitest run tests/web/kits.test.tsx` → FAIL.
- [ ] **Step 3: Vẽ 17 kit** theo bảng spec §4.2: nét viền `PALETTE.ink`, mọi hình nằm trong khung `0 0 120 160` và không đè vùng bảng tên (y < 36), trừ `halo` và mũ nhọn `wizard` được nhô tới y ≈ 30. Vật cầm tay đặt ở phía cánh (bên phải người xem). `bird` có `<path data-part="crest" fill={birdCrestColour(role.key)}>`.
- [ ] **Step 4: Chạy** `npx vitest run tests/web/kits.test.tsx tests/web/Character.test.tsx tests/web/roleKits.test.ts` → PASS.
- [ ] **Step 5: Xem bằng mắt**: `npx tsx scripts/kit-gallery.tsx > <scratchpad>/kits.html`, mở bằng trình duyệt, chụp màn hình; mỗi kit nhận ra được bằng mắt, không lệch khỏi thân, không đè bảng tên. Đính kèm ảnh chụp trong báo cáo.
- [ ] **Step 6: Commit** `feat: draw 17 role kits for the goose character`.

---

### Task 5: Logo, favicon, nhóm ngỗng và trang Đăng nhập

**Files:**
- Create: `src/web/components/LobbySquad.tsx`
- Modify: `src/web/components/DuckMark.tsx`, `src/web/public/favicon.svg`, `src/web/pages/LoginPage.tsx`, `src/web/styles.css` (đổi lớp `duck-*` → `goose-*`, bỏ keyframes không dùng), `tests/web/LoginPage.test.tsx`
- Delete: `src/web/components/DuckSquad.tsx`, `src/web/components/DuckBody.tsx`

**Interfaces:**
- Consumes: `GooseBody`, `KitArt` (Task 3–4), `PALETTE`.
- Produces: `LobbySquad({ className }: { className?: string })` — SVG `aria-hidden`, 5 thành viên theo spec §4.4 (`ninja`, `detective`, `crown` ở giữa to hơn, `wizard`, `knife`), mỗi con là `<g className="goose" data-member={kit}>`; chạm/rê chuột đặt `data-hopping`, hết hoạt ảnh (`onAnimationEnd`) thì bỏ — giữ đúng hành vi `DuckSquad` hiện có. `DuckMark` giữ tên và props (`className`), `aria-hidden`.

- [ ] **Step 1: Sửa test** `LoginPage.test.tsx`: test "duck squad is decorative" và "a touched duck hops…" đổi sang `LobbySquad` (chọn phần tử bằng `[data-member="crown"]`), giữ nguyên các khẳng định; thêm `test('the squad shows the five kits', …)` kiểm có đủ `[data-member]` = ninja, detective, crown, wizard, knife.
- [ ] **Step 2: Chạy** `npx vitest run tests/web/LoginPage.test.tsx tests/web/Layout.test.tsx` → FAIL ở test mới.
- [ ] **Step 3: Làm** `LobbySquad`, vẽ lại `DuckMark` (đầu ngỗng trắng viền `ink`, mỏ cam) và `favicon.svg` (cùng hình, nền tròn `night-900`), làm lại `LoginPage` theo spec §6 (nền đêm toàn màn hình, tiêu đề chữ nổi vàng viền tối, nút Discord `#5865F2` kiểu khối, lỗi trong panel viền `duck-soft` chữ `duck-soft`). Xoá `DuckSquad.tsx`, `DuckBody.tsx`.
- [ ] **Step 4: Chạy** `npm test` → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Xem trên trình duyệt** (dev server + `/login`) ở 320px và 1280px; chụp màn hình cho báo cáo.
- [ ] **Step 6: Commit** `feat: night-lobby login page with the redrawn goose squad and logo`.

---

### Task 6: Khung trang, điều hướng và thành phần dùng chung

**Files:**
- Create: `src/web/components/RoleCard.tsx`, `src/web/components/EmptyState.tsx`, `tests/web/RoleCard.test.tsx`
- Modify: `src/web/components/{Layout,Avatar,QueryState,Modal,SeasonSelect}.tsx`, `src/web/App.tsx`, `tests/web/Layout.test.tsx`

**Interfaces:**
- Consumes: `Character`, `CharacterVariant`, `GooseBody`, `PALETTE`, `FACTION_LABEL` (`lib/factions.ts`).
- Produces: `RoleCard({ role, holderName, variant, score, extra, characterSize, className }: { role: RoleDto; holderName: string | null; variant: CharacterVariant; score: number | null; extra?: ReactNode; characterSize?: number; className?: string })` — một `div` (không phải link): băng phe (chữ `FACTION_LABEL[faction].toLocaleUpperCase('vi')`), `Character`, dòng `{role.icon} {role.nameVi}`, dòng điểm `{score} {role.metricLabel}` khi `score !== null`, `extra` ở cuối; `variant === 'empty'` → viền nét đứt và dòng "Khai điểm để giành".
- Layout: icon lucide cho 7 mục (`House`, `Crown`, `ChartColumn`, `Trophy`, `PenLine`, `User`, `Wrench`); giữ nguyên `NAV_ITEMS` (nhãn, đường dẫn, `short`, `staffOnly`), các mốc `lg`, các lớp chống tràn mà test đang kiểm.
- Produces: `EmptyState({ children }: { children: ReactNode })` — `panel-inset` có một `GooseBody` nhỏ (`aria-hidden`) và chữ. Task 7–10 dùng nó cho các câu "chưa có…" hiện có của trang (giữ nguyên chữ).

- [ ] **Step 1: Viết test hỏng** `tests/web/RoleCard.test.tsx` (file này chứa cả test của `EmptyState`):

```ts
test('the banner names the faction in capitals', () => {
  // goose → 'PHE NGỖNG', duck → 'PHE VỊT', neutral → 'PHE THỨ 3'
});
test('score line shows the score and the metric', () => {
  // score 31, metricLabel 'Số mạng chém' → có chữ '31' và 'Số mạng chém'; score null → không có dòng điểm
});
test('an empty role invites a report without nesting a link', () => {
  // variant 'empty' → getByText('Khai điểm để giành'); queryByRole('link') === null
});
test('long names wrap inside the card', () => {
  // nameVi 'Người vận động hành lang', holderName 24 ký tự → gốc có lớp 'min-w-0', dòng tên role có lớp 'break-words'
});
```

Thêm `test('empty state shows its text beside a decorative goose', …)` vào cùng file (`EmptyState` → `getByText` thấy chữ; có `svg` nằm trong `[aria-hidden="true"]`).

Thêm vào `Layout.test.tsx`: `test('navigation uses drawn icons, not emoji', …)` — `textContent` của cả hai `navigation` không khớp `/\p{Extended_Pictographic}/u`, và mỗi link có một `svg[aria-hidden="true"]`.
- [ ] **Step 2: Chạy** `npx vitest run tests/web/RoleCard.test.tsx tests/web/Layout.test.tsx` → FAIL.
- [ ] **Step 3: Làm** `RoleCard`; viết lại `Layout` theo spec §5.1–5.2; `Avatar` theo §5.4 (chữ cái `gold` trên `night-700`, viền 2px `night-950`); `QueryState` (đang tải: một `GooseBody` nhỏ nhún + "Đang tải…"; lỗi: panel viền `duck-soft` + chữ lỗi `duck-soft` + nút "Thử lại" `btn-secondary`; giữ nguyên chữ và `role="alert"`); `Modal` (panel, lớp phủ `night-950/70`), `SeasonSelect` (`field`), `App.tsx` (bỏ lớp `slate`). Giữ nguyên chữ và nhãn truy cập.
- [ ] **Step 4: Chạy** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: night-lobby shell, icon dock and shared role card`.

---

### Task 7: Trang Hôm nay — phòng chờ, hàng ghế, đếm ngược, Sảnh tri ân

**Files:**
- Create: `src/web/hooks/useNow.ts`
- Modify: `src/web/lib/format.ts`, `src/web/components/SessionCard.tsx`, `src/web/components/DailyHall.tsx`, `src/web/pages/TodayPage.tsx`, `tests/web/format.test.ts`, `tests/web/SessionCard.test.tsx`, `tests/web/TodayPage.test.tsx`, `tests/web/DailyHall.test.tsx`

**Interfaces:**
- Produces: `formatCountdown(startsAt: string, now: Date): string`; `useNow(intervalMs?: number): Date` (mặc định 60 000, dọn interval khi unmount).
- SessionCard: hàng ghế là `<ul aria-label="Hàng ghế">`, mỗi ô một `<li>`; ô có người chứa `Avatar` có `label` = tên; ô trống có `aria-label="Ghế trống"`; số ô = `Math.max(session.capacity, session.attendees.length)`; dòng `{taken}/{capacity} ghế đã có người`. Chip đếm ngược chỉ khi `status === 'scheduled'`. Mã phòng hiện trong chip `Mã phòng: {roomCode}` (giữ đúng chữ này).

- [ ] **Step 1: Viết test hỏng** trong `format.test.ts`:

```ts
const start = '2026-10-23T13:00:00.000Z';
const at = (iso: string) => new Date(iso);
test('countdown wording', () => {
  expect(formatCountdown(start, at('2026-10-23T10:45:00.000Z'))).toBe('còn 2 giờ 15 phút');
  expect(formatCountdown(start, at('2026-10-23T11:00:00.000Z'))).toBe('còn 2 giờ');
  expect(formatCountdown(start, at('2026-10-23T12:20:00.000Z'))).toBe('còn 40 phút');
  expect(formatCountdown(start, at('2026-10-23T12:59:30.000Z'))).toBe('còn dưới 1 phút');
  expect(formatCountdown(start, at('2026-10-23T13:00:00.000Z'))).toBe('Đang chơi');
  expect(formatCountdown(start, at('2026-10-23T15:00:00.000Z'))).toBe('Đang chơi');
  expect(formatCountdown(start, at('2026-10-22T10:00:00.000Z'))).toBe('còn 1 ngày 3 giờ');
  expect(formatCountdown(start, at('2026-10-21T13:00:00.000Z'))).toBe('còn 2 ngày');
});
```

(Phút làm tròn xuống: 59 phút 59 giây → "còn 59 phút".)

Trong `SessionCard.test.tsx`:

```ts
test('one seat per place, filled seats show who is coming', () => {
  // capacity 12, 8 attendees → within(getByRole('list', { name: 'Hàng ghế' })).getAllByRole('listitem') có 12;
  // 4 phần tử getAllByLabelText('Ghế trống'); có chữ '8/12 ghế đã có người'
});
test('more attendees than seats still shows everyone', () => {
  // capacity 3, 5 attendees → 5 ô, 0 'Ghế trống', chữ '5/3 ghế đã có người'
});
test('scheduled sessions count down; cancelled and ended ones do not', () => {
  // vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T10:45:00.000Z')); startsAt 13:00Z
  // scheduled → 'còn 2 giờ 15 phút'; cancelled/ended → không có chữ bắt đầu bằng 'còn' và không 'Đang chơi'
});
```

Sửa các khẳng định cũ dựa trên `aria-label="Người tham gia"`, chữ `x/y người`, ô `+N` cho khớp hàng ghế mới (giữ nguyên test nút Tham gia/Huỷ, lỗi, mã phòng, ghi chú).
- [ ] **Step 2: Chạy** `npx vitest run tests/web/format.test.ts tests/web/SessionCard.test.tsx` → FAIL.
- [ ] **Step 3: Làm** `formatCountdown`, `useNow`, rồi `SessionCard`, `TodayPage`, `DailyHall` theo spec §6 (Hôm nay). Ở 320px hàng ghế tự xuống dòng (`flex-wrap`, ô 32px).
- [ ] **Step 4: Chạy** `npm test` → PASS.
- [ ] **Step 5: Xem trên trình duyệt** với `npm run db:demo` + dev-login, ở 320/768/1280; chụp màn hình.
- [ ] **Step 6: Commit** `feat: lobby-style session cards with seats and a countdown`.

---

### Task 8: Đại sảnh, Xếp hạng (bục 1-2-3), Tri ân

**Files:**
- Create: `src/web/components/Podium.tsx`
- Modify: `src/web/pages/HallPage.tsx`, `src/web/pages/LeaderboardPage.tsx`, `src/web/pages/MvpPage.tsx`, `tests/web/HallPage.test.tsx`, `tests/web/LeaderboardPage.test.tsx`, `tests/web/MvpPage.test.tsx`

**Interfaces:**
- Consumes: `RoleCard` (Task 6), `Character`, `Avatar`.
- Produces: `Podium({ role, rows }: { role: RoleDto; rows: LeaderboardRowDto[] })` — `<ol aria-label="Bục vinh danh">` tối đa 3 mục, thứ tự DOM theo hạng (1, 2, 3), thứ tự hiển thị 2-1-3 bằng `order-*`; hạng 1 có `Character` (variant `current`, `holderName` = tên) đứng trên bục cao nhất; hạng 2, 3 là `Avatar` có `label`. Mỗi mục ghi tên và `{score} {metricLabel}`.

- [ ] **Step 1: Sửa/viết test**:
  - `LeaderboardPage.test.tsx`: thay phần kiểm `topCard()` bằng: `within(getByRole('list', { name: 'Bục vinh danh' })).getAllByRole('listitem')` có số mục = `min(3, số hàng)`; mục đầu chứa `getByRole('img', { name: 'Ngỗng: Ngỗng Một' })` và chữ `7 Số lần vote trúng Vịt`; bảng đầy đủ bên dưới giữ nguyên mọi khẳng định cũ (2 hàng, "Hạng 1" có 👑…). Thêm `test('a single row gives a one-step podium', …)`.
  - `HallPage.test.tsx`: giữ mọi test tab/mùa/link; thêm `test('each hall tile is a role card inside the leaderboard link', …)` — mỗi `link` của lưới chứa chữ băng phe và không chứa `link` lồng.
  - `MvpPage.test.tsx`: giữ nguyên mọi test chọn ngày (nút ngày đã có `aria-pressed`, nhóm "Chọn ngày" đã cuộn ngang trong chính nó — giữ cả hai).
- [ ] **Step 2: Chạy** ba file test → FAIL ở phần mới.
- [ ] **Step 3: Làm** `Podium`; `HallPage` (tab chip màu phe: mục đang chọn nền `-strong`/`third`, mục khác `night-700`; ô = `Link` có lớp `lift` bọc `RoleCard` với `extra` = ghi chú bản đồ và "mùa trước" như hiện tại); `LeaderboardPage` (bục thay thẻ hạng 1, bảng kẻ hàng `night-700`); `MvpPage` (chip ngày).
- [ ] **Step 4: Chạy** `npm test` → PASS.
- [ ] **Step 5: Xem trên trình duyệt** ba trang ở 320/768/1280; chụp màn hình.
- [ ] **Step 6: Commit** `feat: hall role cards, leaderboard podium and MVP date chips`.

---

### Task 9: Khai điểm và Hồ sơ

**Files:**
- Modify: `src/web/components/Character.tsx` (thêm prop tuỳ chọn), `src/web/pages/ReportPage.tsx`, `src/web/pages/ProfilePage.tsx`, `tests/web/Character.test.tsx`, `tests/web/ReportPage.test.tsx`, `tests/web/ProfilePage.test.tsx`

**Interfaces:**
- Consumes: `Character`, `RoleCard`, `PALETTE`.
- Produces: `Character` thêm `nameplate?: boolean` (mặc định `true`). `false` → không vẽ bảng tên và nhãn "Mùa trước", `aria-label` chỉ là `role.nameVi`.

- [ ] **Step 1: Viết test hỏng**:
  - `Character.test.tsx`: `test('nameplate={false} draws only the figure', …)` — không có phần tử `text` chứa tên; `getByRole('img', { name: 'Kiếm sĩ' })`.
  - `ReportPage.test.tsx`: sau khi gõ tìm, mỗi `option` gợi ý chứa một `img` tên role và chữ phe (`Phe Ngỗng`/`Phe Vịt`/`Phe thứ 3`); chọn xong thì thấy thẻ role đã chọn có `img` cùng tên. Giữ nguyên mọi test hiện có (combobox "Role", lỗi tại chỗ, ngày, buổi chơi).
  - `ProfilePage.test.tsx`: role đang giữ hiện bằng thẻ có chữ băng phe; mã thành viên vẫn chép được; hai `checkbox` nhắc giờ giữ nguyên tên.
- [ ] **Step 2: Chạy** ba file test → FAIL.
- [ ] **Step 3: Làm** prop `nameplate`; `ReportPage` theo spec §6 (Khai điểm; chip trạng thái: chờ duyệt `gold`, đã duyệt `ok`, từ chối `duck-soft`); `ProfilePage` theo spec §6 (Hồ sơ; `Switch` hiện có đã là `input type="checkbox" role="switch"` ẩn + hình vẽ bằng `peer` — giữ nguyên cấu trúc, chỉ đổi màu: tắt `night-700`, bật `gold`, núm trắng viền `night-950`, focus viền `gold`).
- [ ] **Step 4: Chạy** `npm test` → PASS.
- [ ] **Step 5: Xem trên trình duyệt** hai trang ở 320/1280 (gợi ý role với tên dài, hồ sơ có role đang giữ); chụp màn hình.
- [ ] **Step 6: Commit** `feat: report picker with mini characters and a passport-style profile`.

---

### Task 10: Trang Quản trị

**Files:**
- Modify: `src/web/pages/admin/{AdminPage,CategoriesTab,Chip,FailuresTab,MembersTab,ReviewsTab,RolesTab,SessionsTab,SettingsTab}.tsx`, các test admin tương ứng chỉ khi một khẳng định dựa vào lớp màu cũ

**Interfaces:**
- Consumes: utility `panel`, `field`, `chip`, `btn-*` (Task 2), `Character` (danh sách role trong `RolesTab` dùng `nameplate={false}`, Task 9).

- [ ] **Step 1: Ghi lại mốc** `npx vitest run tests/web/AdminPage.test.tsx tests/web/CategoriesTab.test.tsx tests/web/MembersTab.test.tsx tests/web/ReviewsTab.test.tsx tests/web/RolesTab.test.tsx tests/web/SessionsTab.test.tsx tests/web/SettingsTab.test.tsx` → PASS (trước khi sửa).
- [ ] **Step 2: Làm lại** theo spec §6 (Quản trị): thanh tab chip cuộn ngang (`overflow-x-auto`, giữ vai trò `tab`/`tablist` hiện có), bảng nền `night-800` hàng kẻ `night-700` chữ 14px, form `field`, nút xoá/huỷ/từ chối `btn-danger`, chip trạng thái theo bảng màu Task 9. Không hoạt ảnh nhân vật trong bảng (thêm lớp tắt `goose-idle`). Đổi `card` → `panel`.
- [ ] **Step 3: Chạy** lại bảy file ở Step 1 + `npm test` → PASS (không đổi khẳng định hành vi nào).
- [ ] **Step 4: Xem trên trình duyệt** mọi tab ở 320 và 1280 bằng tài khoản `demo-admin`; chụp màn hình.
- [ ] **Step 5: Commit** `feat: night-lobby admin console`.

---

### Task 11: Dọn dẹp và kiểm tra cuối

**Files:**
- Create: `tests/web/legacy-styles.test.ts`
- Modify: `src/web/styles.css` (xoá bí danh `card`), mọi file `src/web` còn sót lớp cũ, `README.md` (ảnh chụp không bắt buộc; cập nhật mô tả giao diện nếu có)

- [ ] **Step 1: Viết test hỏng** `tests/web/legacy-styles.test.ts`:

```ts
test('no light-theme or slate classes remain in the web app', () => {
  // duyệt mọi file .ts/.tsx/.css dưới src/web; không file nào khớp /\bdark:/ hay /\bslate-\d/
});
test('the old card utility is gone', () => {
  // styles.css không còn '@utility card'; không file .tsx nào có lớp 'card' đứng riêng trong chuỗi className
  // (regex: /["'`\s]card["'`\s]/ trên các dòng chứa className= hoặc cx()
});
```

- [ ] **Step 2: Chạy** → FAIL nếu còn sót; sửa cho tới khi PASS.
- [ ] **Step 3: Kiểm tra toàn bộ**: `npm run typecheck`, `npm test` (Docker), `$env:GGD_TEST_DB='embedded'; npm test`, `npm run build`, `docker build .` → tất cả PASS.
- [ ] **Step 4: Kiểm tra trên trình duyệt** với dữ liệu mẫu, mỗi trang ở 320px, 768px, 1280px: `document.documentElement.scrollWidth <= window.innerWidth`; dùng Tab đi qua header, thanh dưới và nút chính thấy viền focus vàng; bật giả lập `prefers-reduced-motion: reduce` thì nhân vật đứng yên. Ghi kết quả từng trang vào báo cáo kèm ảnh chụp.
- [ ] **Step 5: Commit** `chore: remove legacy light-theme styles and the card alias`.
