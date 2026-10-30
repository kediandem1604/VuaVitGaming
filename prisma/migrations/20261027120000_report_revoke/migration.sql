-- AlterEnum
ALTER TYPE "ReportStatus" ADD VALUE 'revoked';

-- AlterTable
ALTER TABLE "stat_reports" ADD COLUMN     "revoked_at" TIMESTAMPTZ(3),
ADD COLUMN     "revoked_by" INTEGER;

-- AddForeignKey
ALTER TABLE "stat_reports" ADD CONSTRAINT "stat_reports_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Lần khai bị huỷ duyệt phải có đủ người huỷ, giờ huỷ và lý do (spec huỷ duyệt §4). So sánh qua
-- `::text` vì giá trị enum vừa thêm chưa dùng được trong cùng giao dịch với ADD VALUE.
-- `reviewed_by`/`reviewed_at` (ai đã duyệt ban đầu) giữ nguyên khi huỷ.
ALTER TABLE stat_reports ADD CONSTRAINT stat_reports_revoked_complete CHECK (
  status::text <> 'revoked' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND reject_reason IS NOT NULL)
);
