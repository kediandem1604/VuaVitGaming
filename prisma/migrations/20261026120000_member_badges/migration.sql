-- CreateEnum
CREATE TYPE "BadgeGroup" AS ENUM ('mvp', 'fun', 'none');

-- AlterTable
ALTER TABLE "award_categories" ADD COLUMN     "badge_group" "BadgeGroup" NOT NULL DEFAULT 'none';

-- CreateTable
CREATE TABLE "member_badges" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "badge_key" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "awarded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "member_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_months" (
    "period_id" TEXT NOT NULL,
    "awarded_at" TIMESTAMPTZ(3) NOT NULL,
    "announce_pending" BOOLEAN NOT NULL,

    CONSTRAINT "badge_months_pkey" PRIMARY KEY ("period_id")
);

-- CreateIndex
CREATE INDEX "member_badges_awarded_at_id_idx" ON "member_badges"("awarded_at", "id");

-- CreateIndex
CREATE INDEX "member_badges_member_id_awarded_at_idx" ON "member_badges"("member_id", "awarded_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_badges_badge_key_period_id_member_id_key" ON "member_badges"("badge_key", "period_id", "member_id");

-- AddForeignKey
ALTER TABLE "member_badges" ADD CONSTRAINT "member_badges_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Gán nhóm tính cho danh hiệu cho hạng mục có sẵn theo tên (spec huy hiệu §4).
-- Seed chỉ chạy khi bảng còn trống, nên dòng trên DB thật chỉ nhận nhóm từ đây;
-- hạng mục admin đã đổi tên hoặc thêm sau giữ mặc định 'none', admin chỉnh ở trang quản trị.
UPDATE "award_categories" SET "badge_group" = 'mvp' WHERE "name" IN ('Giết nhiều nhất', 'Ngỗng chạy giỏi nhất');
UPDATE "award_categories" SET "badge_group" = 'fun' WHERE "name" IN ('Pha xử lý ngu nhất', 'Pha dí người ngu nhất', 'Pha đẻ trứng lộ liễu nhất (Cò gáy)', 'Pha chém lố nhất (Kiếm sĩ)');
