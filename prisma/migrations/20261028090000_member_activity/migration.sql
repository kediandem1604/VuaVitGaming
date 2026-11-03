-- AlterTable
-- `guild_joined_at`: ngày vào server theo Discord (`GuildMember.joinedAt`), khác `joined_at` là lúc app
-- thấy người đó lần đầu. Không backfill ở đây: lần đồng bộ guild khi bot khởi động sẽ điền.
-- `games_adjustment`: phần admin chỉnh cộng vào số buổi tự đếm (có thể âm; tổng hiển thị không dưới 0).
ALTER TABLE "members" ADD COLUMN     "guild_joined_at" TIMESTAMPTZ(3),
ADD COLUMN     "games_adjustment" INTEGER NOT NULL DEFAULT 0;
