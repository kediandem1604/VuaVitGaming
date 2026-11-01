-- CreateTable
-- Tổ chức offline (spec offline): sự kiện gặp mặt ngoài đời. `starts_at`/`vote_deadline` lưu UTC;
-- `announced_at` = đã đăng tin tạo lên #thông-báo (NULL → bộ hẹn giờ đăng bù khi chưa diễn ra).
CREATE TABLE "offline_events" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "place" TEXT NOT NULL,
    "description" TEXT,
    "vote_deadline" TIMESTAMPTZ(3),
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "announced_at" TIMESTAMPTZ(3),
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Vote đi được / không đi được: mỗi thành viên một dòng cho mỗi sự kiện.
CREATE TABLE "offline_votes" (
    "event_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "going" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_votes_pkey" PRIMARY KEY ("event_id","member_id")
);

-- CreateIndex
CREATE INDEX "offline_events_starts_at_idx" ON "offline_events"("starts_at");

-- CreateIndex
CREATE INDEX "offline_votes_member_id_idx" ON "offline_votes"("member_id");

-- AddForeignKey
ALTER TABLE "offline_events" ADD CONSTRAINT "offline_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_votes" ADD CONSTRAINT "offline_votes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "offline_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_votes" ADD CONSTRAINT "offline_votes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc dữ liệu (spec offline): tên 1–80, địa điểm 1–120, mô tả ≤ 500 ký tự, hạn vote ≤ giờ sự kiện.
ALTER TABLE offline_events ADD CONSTRAINT offline_events_title_length CHECK (char_length(title) BETWEEN 1 AND 80);
ALTER TABLE offline_events ADD CONSTRAINT offline_events_place_length CHECK (char_length(place) BETWEEN 1 AND 120);
ALTER TABLE offline_events ADD CONSTRAINT offline_events_description_length CHECK (description IS NULL OR char_length(description) <= 500);
ALTER TABLE offline_events ADD CONSTRAINT offline_events_deadline_before_start CHECK (vote_deadline IS NULL OR vote_deadline <= starts_at);
