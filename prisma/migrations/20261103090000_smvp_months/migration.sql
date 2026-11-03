-- SMVP tháng = hạng 1 bảng "Cả 3 phe", trao 00:05 ngày 1 tháng sau (quyết định 2026-11-03).
-- Dòng của tháng là chốt chặn trao một lần; announce_pending giữ nợ lời chúc khi Discord lỗi.

-- CreateTable
CREATE TABLE "smvp_months" (
    "period_id" TEXT NOT NULL,
    "member_id" INTEGER,
    "points" INTEGER,
    "awarded_at" TIMESTAMPTZ(3) NOT NULL,
    "announce_pending" BOOLEAN NOT NULL,

    CONSTRAINT "smvp_months_pkey" PRIMARY KEY ("period_id")
);

-- CreateIndex
CREATE INDEX "smvp_months_member_id_idx" ON "smvp_months"("member_id");

-- AddForeignKey
ALTER TABLE "smvp_months" ADD CONSTRAINT "smvp_months_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
