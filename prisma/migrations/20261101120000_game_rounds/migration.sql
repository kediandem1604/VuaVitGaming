-- Tính điểm theo ván (spec 2026-11-01 game rounds §2).

-- AlterTable
-- Số ván lớn nhất từng cấp cho buổi: ván mới lấy `round_seq + 1` (cập nhật có khoá dòng), nên xoá ván
-- cuối thì số đó không bị cấp lại, xoá ván giữa thì các ván khác giữ số.
ALTER TABLE "game_sessions" ADD COLUMN     "round_seq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
-- Ván của lần khai; NULL = lần khai theo ngày (mùa ≤ 2026-10) — giữ công thức điểm cũ.
ALTER TABLE "stat_reports" ADD COLUMN     "round_id" INTEGER;

-- CreateTable
-- Ván: ảnh kết quả (PNG/JPG/WebP ≤ 5 MB, lưu trong DB) và phe thắng (NULL = chưa chọn).
CREATE TABLE "game_rounds" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "image" BYTEA NOT NULL,
    "image_mime" TEXT NOT NULL,
    "image_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "winner_faction" "Faction",
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Người thắng của ván khi Phe thứ 3 thắng (chỉ dùng khi `winner_faction = neutral`).
CREATE TABLE "game_round_winners" (
    "round_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,

    CONSTRAINT "game_round_winners_pkey" PRIMARY KEY ("round_id","member_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_session_id_number_key" ON "game_rounds"("session_id", "number");

-- CreateIndex
CREATE INDEX "game_round_winners_member_id_idx" ON "game_round_winners"("member_id");

-- CreateIndex
CREATE INDEX "stat_reports_round_id_idx" ON "stat_reports"("round_id");

-- AddForeignKey
ALTER TABLE "stat_reports" ADD CONSTRAINT "stat_reports_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "game_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_round_winners" ADD CONSTRAINT "game_round_winners_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "game_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_round_winners" ADD CONSTRAINT "game_round_winners_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc dữ liệu: số ván từ 1, ảnh đúng ba loại được nhận, `round_seq` không âm.
ALTER TABLE game_rounds ADD CONSTRAINT game_rounds_number_positive CHECK (number >= 1);
ALTER TABLE game_rounds ADD CONSTRAINT game_rounds_image_mime_known CHECK (image_mime IN ('image/png', 'image/jpeg', 'image/webp'));
ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_round_seq_nonnegative CHECK (round_seq >= 0);

-- Mỗi (ván, người) chỉ một lần khai còn hiệu lực (spec ván §2) — kể cả hai lần gửi song song (web +
-- Discord). Index một phần: Prisma 6 không mô tả được trong schema.prisma, nên chỉ có ở đây
-- (`prisma migrate diff` không thấy nó; đừng xoá khi tạo migration sau).
CREATE UNIQUE INDEX "stat_reports_round_member_active_key" ON "stat_reports"("round_id", "member_id")
  WHERE "round_id" IS NOT NULL AND "source" = 'self' AND "status" IN ('pending', 'approved');
