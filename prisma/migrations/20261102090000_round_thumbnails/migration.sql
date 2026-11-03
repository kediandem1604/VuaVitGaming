-- Ảnh nhỏ của ván (web thu nhỏ trong trình duyệt rồi up sau ảnh gốc). NULL = chưa có → dùng ảnh gốc.

-- AlterTable
ALTER TABLE "game_rounds" ADD COLUMN     "thumb" BYTEA,
ADD COLUMN     "thumb_mime" TEXT;

-- Ảnh nhỏ đúng ba loại được nhận; ảnh và mime luôn cùng có hoặc cùng NULL.
ALTER TABLE game_rounds ADD CONSTRAINT game_rounds_thumb_mime_known CHECK (thumb_mime IS NULL OR thumb_mime IN ('image/png', 'image/jpeg', 'image/webp'));
ALTER TABLE game_rounds ADD CONSTRAINT game_rounds_thumb_pair CHECK ((thumb IS NULL) = (thumb_mime IS NULL));
