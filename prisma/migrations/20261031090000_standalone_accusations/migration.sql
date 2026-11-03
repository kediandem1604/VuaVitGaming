-- Báo cáo người chơi tách riêng (spec 2026-10-31 §B): báo cáo mới không gắn lần khai.

-- AlterEnum
ALTER TYPE "AccusationStatus" ADD VALUE 'revoked';

-- AlterTable
-- `report_id` NULL = báo cáo độc lập; UNIQUE giữ nguyên (PostgreSQL cho nhiều NULL trong UNIQUE).
-- `session_id`, `note`: buổi và ghi chú của báo cáo độc lập; `revoked_by`/`revoked_at`: huỷ duyệt.
ALTER TABLE "player_accusations" ALTER COLUMN "report_id" DROP NOT NULL,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "revoked_at" TIMESTAMPTZ(3),
ADD COLUMN     "revoked_by" INTEGER,
ADD COLUMN     "session_id" INTEGER;

-- CreateIndex
CREATE INDEX "player_accusations_reporter_id_created_at_idx" ON "player_accusations"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "player_accusations_status_played_on_idx" ON "player_accusations"("status", "played_on");

-- AddForeignKey
ALTER TABLE "player_accusations" ADD CONSTRAINT "player_accusations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_accusations" ADD CONSTRAINT "player_accusations_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ghi chú tối đa 300 ký tự (như lần khai). Báo cáo bị huỷ duyệt phải có đủ người huỷ, giờ huỷ và lý
-- do — so qua `::text` vì giá trị enum vừa thêm chưa dùng được trong cùng giao dịch với ADD VALUE.
ALTER TABLE player_accusations ADD CONSTRAINT player_accusations_note_length CHECK (note IS NULL OR char_length(note) <= 300);
ALTER TABLE player_accusations ADD CONSTRAINT player_accusations_revoked_complete CHECK (
  status::text <> 'revoked' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND reject_reason IS NOT NULL)
);
