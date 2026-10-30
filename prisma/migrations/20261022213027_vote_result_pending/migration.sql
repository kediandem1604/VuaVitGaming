-- AlterTable
ALTER TABLE "vote_messages" ADD COLUMN     "result_pending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "vote_rounds" ADD COLUMN     "announce_pending" BOOLEAN NOT NULL DEFAULT false;
