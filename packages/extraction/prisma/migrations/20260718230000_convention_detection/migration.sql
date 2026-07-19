-- Preserve contextual convention detection across the extraction -> retrieval boundary.
-- Nullable keeps convention snapshots published before contextual detection readable.
ALTER TABLE "conventions"
ADD COLUMN "detection" JSONB;
