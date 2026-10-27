-- CreateEnum
CREATE TYPE "ReportSource" AS ENUM ('self', 'accusation');

-- CreateEnum
CREATE TYPE "AccusationStatus" AS ENUM ('pending', 'approved', 'rejected', 'superseded');

-- AlterTable
-- `points`: điểm mỗi đơn vị chỉ số chính (thay luật ×5 cũ trong code); ba cột `penalty_*` là chỉ số
-- phạt tuỳ chọn, bị TRỪ `penalty_points` mỗi đơn vị (spec điểm role §3–4).
ALTER TABLE "roles" ADD COLUMN     "penalty_max_per_game" INTEGER,
ADD COLUMN     "penalty_metric_label" TEXT,
ADD COLUMN     "penalty_points" INTEGER,
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
-- `penalty_value`: giá trị chỉ số phạt của lần khai; `bonus_points`: +1 khi báo cáo kèm theo được
-- duyệt đúng; `source`: `self` do người chơi khai, `accusation` là mục trừ điểm tạo khi duyệt báo cáo.
ALTER TABLE "stat_reports" ADD COLUMN     "bonus_points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "penalty_value" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" "ReportSource" NOT NULL DEFAULT 'self';

-- CreateTable
CREATE TABLE "player_accusations" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "reporter_id" INTEGER NOT NULL,
    "accused_id" INTEGER NOT NULL,
    "accused_role_id" INTEGER NOT NULL,
    "victim_id" INTEGER NOT NULL,
    "victim_faction" "Faction" NOT NULL,
    "played_on" DATE NOT NULL,
    "status" "AccusationStatus" NOT NULL DEFAULT 'pending',
    "reject_reason" TEXT,
    "penalty_report_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "player_accusations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "player_accusations_report_id_key" ON "player_accusations"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_accusations_penalty_report_id_key" ON "player_accusations"("penalty_report_id");

-- CreateIndex
CREATE INDEX "player_accusations_accused_id_accused_role_id_victim_id_pla_idx" ON "player_accusations"("accused_id", "accused_role_id", "victim_id", "played_on", "status");

-- AddForeignKey
ALTER TABLE "player_accusations" ADD CONSTRAINT "player_accusations_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "stat_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_accusations" ADD CONSTRAINT "player_accusations_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_accusations" ADD CONSTRAINT "player_accusations_accused_id_fkey" FOREIGN KEY ("accused_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_accusations" ADD CONSTRAINT "player_accusations_accused_role_id_fkey" FOREIGN KEY ("accused_role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_accusations" ADD CONSTRAINT "player_accusations_victim_id_fkey" FOREIGN KEY ("victim_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_accusations" ADD CONSTRAINT "player_accusations_penalty_report_id_fkey" FOREIGN KEY ("penalty_report_id") REFERENCES "stat_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_accusations" ADD CONSTRAINT "player_accusations_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ràng buộc dữ liệu (spec điểm role §4). `points` 1..100; chỉ số phạt ba cột cùng null hoặc cùng
-- có, `penalty_points` 1..100.
ALTER TABLE roles ADD CONSTRAINT roles_points_range CHECK (points BETWEEN 1 AND 100);
ALTER TABLE roles ADD CONSTRAINT roles_penalty_metric_all_or_none CHECK (
  (penalty_metric_label IS NULL AND penalty_max_per_game IS NULL AND penalty_points IS NULL)
  OR (penalty_metric_label IS NOT NULL AND penalty_max_per_game IS NOT NULL AND penalty_points IS NOT NULL)
);
ALTER TABLE roles ADD CONSTRAINT roles_penalty_points_range CHECK (penalty_points IS NULL OR penalty_points BETWEEN 1 AND 100);
-- Lần khai: chỉ số phạt không âm, bonus 0 hoặc 1.
ALTER TABLE stat_reports ADD CONSTRAINT stat_reports_penalty_value_nonneg CHECK (penalty_value >= 0);
ALTER TABLE stat_reports ADD CONSTRAINT stat_reports_bonus_points_range CHECK (bonus_points BETWEEN 0 AND 1);
-- Báo cáo: không tự báo cáo mình; người bị bắn khác người bị báo cáo.
ALTER TABLE player_accusations ADD CONSTRAINT player_accusations_not_self CHECK (accused_id <> reporter_id);
ALTER TABLE player_accusations ADD CONSTRAINT player_accusations_victim_not_accused CHECK (victim_id <> accused_id);

-- Điểm khởi đầu theo `key` (spec điểm role §4). Seed không ghi đè role đã có nên DB thật chỉ đổi
-- qua đây; `role_titles` của mùa đã chốt không đụng. Câu chung đi trước, hai câu riêng ghi đè sau:
-- 1) mọi role tối đa 1 mỗi trận: 5 điểm mỗi lần (thay luật ×5 cũ, không nhân đôi vì code đã bỏ hệ số);
UPDATE "roles" SET "points" = 5 WHERE "max_per_game" = 1;
-- 2) Dân phòng: 5 điểm mỗi phát trúng, phạt "Số phát bắn sai" tối đa 1, −3 mỗi lần;
UPDATE "roles"
SET "points" = 5,
    "penalty_metric_label" = 'Số phát bắn sai',
    "penalty_max_per_game" = 1,
    "penalty_points" = 3
WHERE "key" = 'vigilante';
-- 3) các role bắn khác của phe Ngỗng: 3 điểm mỗi phát trúng, phạt tối đa = max_per_game hiện tại, −1 mỗi lần.
UPDATE "roles"
SET "points" = 3,
    "penalty_metric_label" = 'Số phát bắn sai',
    "penalty_max_per_game" = "max_per_game",
    "penalty_points" = 1
WHERE "key" IN ('lobbyist', 'soldier', 'sheriff', 'avenger');
