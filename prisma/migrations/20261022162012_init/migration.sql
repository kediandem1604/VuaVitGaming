-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('member', 'mod', 'admin');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('active', 'left');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('scheduled', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('going', 'cancelled');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('pre15', 'start');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('email', 'dm');

-- CreateEnum
CREATE TYPE "CategoryScope" AS ENUM ('always', 'mode', 'optional');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "Faction" AS ENUM ('goose', 'duck', 'neutral');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "members" (
    "id" SERIAL NOT NULL,
    "discord_id" TEXT NOT NULL,
    "member_code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "email" TEXT,
    "notify_email" BOOLEAN NOT NULL DEFAULT true,
    "notify_dm" BOOLEAN NOT NULL DEFAULT true,
    "access_level" "AccessLevel" NOT NULL DEFAULT 'member',
    "status" "MemberStatus" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_sessions" (
    "id" TEXT NOT NULL,
    "member_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_modes" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "game_modes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" SERIAL NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "mode_id" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 16,
    "room_code" TEXT,
    "note" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'scheduled',
    "discord_message_id" TEXT,
    "discord_dirty" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER NOT NULL,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "session_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'going',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("session_id","member_id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "session_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "channel" "Channel" NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("session_id","member_id","kind","channel")
);

-- CreateTable
CREATE TABLE "award_categories" (
    "id" SERIAL NOT NULL,
    "scope" "CategoryScope" NOT NULL,
    "mode_id" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "award_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_rounds" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "opens_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closes_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'open',

    CONSTRAINT "vote_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_messages" (
    "round_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "discord_message_id" TEXT,

    CONSTRAINT "vote_messages_pkey" PRIMARY KEY ("round_id","category_id")
);

-- CreateTable
CREATE TABLE "votes" (
    "round_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "voter_id" INTEGER NOT NULL,
    "nominee_id" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("round_id","category_id","voter_id")
);

-- CreateTable
CREATE TABLE "awards" (
    "round_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "vote_count" INTEGER NOT NULL,

    CONSTRAINT "awards_pkey" PRIMARY KEY ("round_id","category_id","member_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "faction" "Faction" NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_vi" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metric_label" TEXT NOT NULL,
    "max_per_game" INTEGER NOT NULL,
    "map_note" TEXT,
    "mode_id" INTEGER,
    "icon" TEXT NOT NULL,
    "image" BYTEA,
    "image_mime" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stat_reports" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "session_id" INTEGER,
    "played_on" DATE NOT NULL,
    "value" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMPTZ(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stat_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "review_nudged_at" TIMESTAMPTZ(3),

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_titles" (
    "season_id" TEXT NOT NULL,
    "role_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "role_titles_pkey" PRIMARY KEY ("season_id","role_id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "scheduler_lease" (
    "id" INTEGER NOT NULL,
    "holder" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scheduler_lease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_discord_id_key" ON "members"("discord_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_member_code_key" ON "members"("member_code");

-- CreateIndex
CREATE UNIQUE INDEX "game_modes_key_key" ON "game_modes"("key");

-- CreateIndex
CREATE INDEX "game_sessions_starts_at_idx" ON "game_sessions"("starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "vote_rounds_session_id_key" ON "vote_rounds"("session_id");

-- CreateIndex
CREATE INDEX "vote_rounds_status_closes_at_idx" ON "vote_rounds"("status", "closes_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "stat_reports_role_id_status_played_on_idx" ON "stat_reports"("role_id", "status", "played_on");

-- CreateIndex
CREATE INDEX "stat_reports_member_id_created_at_idx" ON "stat_reports"("member_id", "created_at");

-- AddForeignKey
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_mode_id_fkey" FOREIGN KEY ("mode_id") REFERENCES "game_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "award_categories" ADD CONSTRAINT "award_categories_mode_id_fkey" FOREIGN KEY ("mode_id") REFERENCES "game_modes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_rounds" ADD CONSTRAINT "vote_rounds_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_messages" ADD CONSTRAINT "vote_messages_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "vote_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_messages" ADD CONSTRAINT "vote_messages_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "award_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "vote_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "award_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_nominee_id_fkey" FOREIGN KEY ("nominee_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awards" ADD CONSTRAINT "awards_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "vote_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awards" ADD CONSTRAINT "awards_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "award_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awards" ADD CONSTRAINT "awards_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_mode_id_fkey" FOREIGN KEY ("mode_id") REFERENCES "game_modes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stat_reports" ADD CONSTRAINT "stat_reports_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stat_reports" ADD CONSTRAINT "stat_reports_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stat_reports" ADD CONSTRAINT "stat_reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stat_reports" ADD CONSTRAINT "stat_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_titles" ADD CONSTRAINT "role_titles_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_titles" ADD CONSTRAINT "role_titles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_titles" ADD CONSTRAINT "role_titles_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc bổ sung ngoài khả năng của Prisma schema (spec §5)
CREATE SEQUENCE member_code_seq START 1;
ALTER TABLE votes ADD CONSTRAINT votes_no_self CHECK (voter_id <> nominee_id);
ALTER TABLE stat_reports ADD CONSTRAINT stat_reports_value_nonneg CHECK (value >= 0);
ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_capacity CHECK (capacity BETWEEN 1 AND 25);
ALTER TABLE roles ADD CONSTRAINT roles_max_per_game CHECK (max_per_game >= 1);
ALTER TABLE award_categories ADD CONSTRAINT award_categories_mode_scope CHECK ((scope = 'mode') = (mode_id IS NOT NULL));
