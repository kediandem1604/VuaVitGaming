-- CreateEnum
CREATE TYPE "BountyClaimStatus" AS ENUM ('pending', 'approved', 'rejected', 'revoked');

-- CreateEnum
CREATE TYPE "BountyClaimSource" AS ENUM ('web', 'discord');

-- AlterTable
-- Tin treo thưởng của buổi trong `#treo-thưởng` (kênh + id tin) và cờ `bounty_dirty` (tin cần đăng/sửa
-- bù — bộ hẹn giờ xử lý như `discord_dirty`).
ALTER TABLE "game_sessions" ADD COLUMN     "bounty_channel_id" TEXT,
ADD COLUMN     "bounty_dirty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bounty_message_id" TEXT;

-- CreateTable
-- Mục treo thưởng (spec treo thưởng §3): `session_id` NULL = mọi buổi; `role_id` NULL = không gắn role.
CREATE TABLE "bounties" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "points" INTEGER NOT NULL,
    "role_id" INTEGER,
    "session_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bounties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Lần nhận treo thưởng: `role_id` và `points` chép từ mục lúc nhận (sửa mục sau đó không đổi lần nhận
-- đã có); `played_on` = ngày VN của buổi.
CREATE TABLE "bounty_claims" (
    "id" SERIAL NOT NULL,
    "bounty_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "played_on" DATE NOT NULL,
    "role_id" INTEGER,
    "points" INTEGER NOT NULL,
    "status" "BountyClaimStatus" NOT NULL DEFAULT 'pending',
    "reject_reason" TEXT,
    "source" "BountyClaimSource" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMPTZ(3),
    "revoked_by" INTEGER,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "bounty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bounties_session_id_idx" ON "bounties"("session_id");

-- CreateIndex
CREATE INDEX "bounty_claims_status_played_on_idx" ON "bounty_claims"("status", "played_on");

-- CreateIndex
CREATE INDEX "bounty_claims_member_id_played_on_idx" ON "bounty_claims"("member_id", "played_on");

-- CreateIndex
CREATE UNIQUE INDEX "bounty_claims_bounty_id_member_id_session_id_key" ON "bounty_claims"("bounty_id", "member_id", "session_id");

-- AddForeignKey
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "bounties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ràng buộc dữ liệu (spec treo thưởng §3): tên 1–80 ký tự, mô tả ≤ 200, điểm 1..50 (cả trên lần nhận
-- vì chép từ mục).
ALTER TABLE bounties ADD CONSTRAINT bounties_title_length CHECK (char_length(title) BETWEEN 1 AND 80);
ALTER TABLE bounties ADD CONSTRAINT bounties_description_length CHECK (description IS NULL OR char_length(description) <= 200);
ALTER TABLE bounties ADD CONSTRAINT bounties_points_range CHECK (points BETWEEN 1 AND 50);
ALTER TABLE bounty_claims ADD CONSTRAINT bounty_claims_points_range CHECK (points BETWEEN 1 AND 50);
-- Lần nhận bị từ chối phải có lý do; bị huỷ duyệt phải có đủ người huỷ, giờ huỷ và lý do (như lần khai).
ALTER TABLE bounty_claims ADD CONSTRAINT bounty_claims_rejected_reason CHECK (
  status <> 'rejected' OR reject_reason IS NOT NULL
);
ALTER TABLE bounty_claims ADD CONSTRAINT bounty_claims_revoked_complete CHECK (
  status <> 'revoked' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND reject_reason IS NOT NULL)
);
