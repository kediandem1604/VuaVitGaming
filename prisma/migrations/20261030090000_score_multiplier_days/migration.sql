-- CreateTable
-- Ngày nhân điểm (spec ngày nhân điểm §2): `day` là ngày VN; điểm cộng của lần khai có ngày chơi đúng
-- ngày này được nhân `multiplier` lúc tính. `announced_at` = đã đăng tin tạo lên #thông-báo (NULL → bộ
-- hẹn giờ đăng bù); `reminded_at` = đã đăng nhắc 9:00 đúng ngày (một lần).
CREATE TABLE "score_multiplier_days" (
    "id" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "multiplier" INTEGER NOT NULL,
    "message" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "announced_at" TIMESTAMPTZ(3),
    "reminded_at" TIMESTAMPTZ(3),

    CONSTRAINT "score_multiplier_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "score_multiplier_days_day_key" ON "score_multiplier_days"("day");

-- AddForeignKey
ALTER TABLE "score_multiplier_days" ADD CONSTRAINT "score_multiplier_days_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc dữ liệu (spec ngày nhân điểm §2): hệ số nguyên ×2–×5, lời nhắn ≤ 100 ký tự.
ALTER TABLE score_multiplier_days ADD CONSTRAINT score_multiplier_days_multiplier_range CHECK (multiplier BETWEEN 2 AND 5);
ALTER TABLE score_multiplier_days ADD CONSTRAINT score_multiplier_days_message_length CHECK (message IS NULL OR char_length(message) <= 100);
