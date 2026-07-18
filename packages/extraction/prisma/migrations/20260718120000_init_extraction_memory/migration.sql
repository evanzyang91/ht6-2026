-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ExtractionRunStatus" AS ENUM ('BUILDING', 'PUBLISHED', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "LinkageQuality" AS ENUM ('HIGH', 'MEDIUM', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CommentIntent" AS ENUM ('ACTIONABLE', 'ARCHITECTURE', 'TESTING', 'SECURITY', 'STYLE', 'QUESTION');

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "active_extraction_run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_runs" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "status" "ExtractionRunStatus" NOT NULL DEFAULT 'BUILDING',
    "input_digest" TEXT NOT NULL,
    "input_comment_count" INTEGER NOT NULL,
    "analyzer_provider" TEXT NOT NULL,
    "analyzer_version" TEXT NOT NULL,
    "episode_count" INTEGER NOT NULL DEFAULT 0,
    "convention_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_episodes" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "episode_key" TEXT NOT NULL,
    "pull_request" INTEGER NOT NULL,
    "reviewer" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "review_comment" TEXT NOT NULL,
    "rejected_code" TEXT NOT NULL,
    "accepted_code" TEXT,
    "accepted_fix_quality" "LinkageQuality" NOT NULL,
    "intent" "CommentIntent" NOT NULL,
    "semantic_title" TEXT NOT NULL,
    "semantic_rule" TEXT NOT NULL,
    "semantic_rationale" TEXT NOT NULL,
    "prohibited_signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferred_signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "semantic_snapshot" JSONB NOT NULL,
    "source_created_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conventions" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "convention_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "category" "CommentIntent" NOT NULL,
    "path_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prohibited_signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferred_signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convention_evidence" (
    "convention_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "convention_evidence_pkey" PRIMARY KEY ("convention_id", "episode_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_slug_key" ON "repositories"("slug");
CREATE UNIQUE INDEX "repositories_active_extraction_run_id_key" ON "repositories"("active_extraction_run_id");
CREATE INDEX "extraction_runs_repository_id_status_idx" ON "extraction_runs"("repository_id", "status");
CREATE INDEX "extraction_runs_repository_id_started_at_idx" ON "extraction_runs"("repository_id", "started_at" DESC);
CREATE INDEX "review_episodes_run_id_pull_request_idx" ON "review_episodes"("run_id", "pull_request");
CREATE UNIQUE INDEX "review_episodes_run_id_episode_key_key" ON "review_episodes"("run_id", "episode_key");
CREATE INDEX "conventions_run_id_category_idx" ON "conventions"("run_id", "category");
CREATE UNIQUE INDEX "conventions_run_id_convention_key_key" ON "conventions"("run_id", "convention_key");
CREATE INDEX "convention_evidence_episode_id_idx" ON "convention_evidence"("episode_id");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_active_extraction_run_id_fkey" FOREIGN KEY ("active_extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_episodes" ADD CONSTRAINT "review_episodes_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "convention_evidence" ADD CONSTRAINT "convention_evidence_convention_id_fkey" FOREIGN KEY ("convention_id") REFERENCES "conventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "convention_evidence" ADD CONSTRAINT "convention_evidence_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "review_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
