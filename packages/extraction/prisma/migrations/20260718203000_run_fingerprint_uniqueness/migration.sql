-- Track extraction implementation changes independently from semantic provider changes.
ALTER TABLE "extraction_runs"
ADD COLUMN "extractor_version" TEXT NOT NULL DEFAULT '1';

ALTER TABLE "extraction_runs"
ALTER COLUMN "extractor_version" DROP DEFAULT;

-- A failed build remains retryable, while the same successful fingerprint cannot be
-- published twice concurrently.
CREATE UNIQUE INDEX "extraction_runs_published_fingerprint_key"
ON "extraction_runs"(
  "repository_id",
  "input_digest",
  "extractor_version",
  "analyzer_provider",
  "analyzer_version"
)
WHERE "status" = 'PUBLISHED'::"ExtractionRunStatus";

-- Evidence order is part of a convention snapshot and must be unambiguous.
CREATE UNIQUE INDEX "convention_evidence_convention_id_position_key"
ON "convention_evidence"("convention_id", "position");
