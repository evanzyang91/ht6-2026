import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { runExtraction } from "../src/pipeline.js";
import type { ExtractionPublisher, ExtractionSnapshot } from "../src/storage/types.js";

// data/raw-comments.json now holds the RawComment union (inline + review-summary +
// conversation). Only inline (code-anchored) comments should reach hunk-linking/clustering —
// this confirms the read boundary filters the other two out rather than feeding them through.
it("only extracts episodes from inline comments, ignoring review-summary and conversation entries", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "engineering-memory-pipeline-"));
  await writeFile(join(dataDir, "raw-comments.json"), JSON.stringify([
    {
      type: "inline",
      repository: "acme/api",
      pullRequest: 1,
      commentId: "c1",
      reviewer: "sam",
      body: "Controllers should never access Prisma directly",
      filePath: "src/controllers/order.ts",
      originalCommitSha: "abc",
      diffHunk: "@@ -1 +1 @@\n+return prisma.order.create({ data })",
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      type: "review-summary",
      repository: "acme/api",
      pullRequest: 1,
      commentId: "review-1",
      reviewer: "pat",
      body: "Looks good overall.",
      createdAt: "2026-01-01T00:05:00Z",
      reviewState: "APPROVED",
    },
    {
      type: "conversation",
      repository: "acme/api",
      pullRequest: 1,
      commentId: "convo-1",
      reviewer: "casey",
      body: "Do we need a migration for this?",
      createdAt: "2026-01-01T00:02:00Z",
      authorAssociation: "MEMBER",
    },
  ]));

  let published: ExtractionSnapshot | undefined;
  const publisher: ExtractionPublisher = {
    async publish(snapshot) {
      published = snapshot;
      return { repositoryCount: 1 };
    },
  };
  const result = await runExtraction(dataDir, undefined, publisher);
  expect(result.episodeCount).toBe(1);
  expect(result.publishedRepositoryCount).toBe(1);
  expect(published?.comments).toHaveLength(1);
  expect(published?.episodes).toHaveLength(1);
  expect(published?.conventions).toHaveLength(1);

  const episodes = JSON.parse(await readFile(join(dataDir, "episodes.json"), "utf8")) as Array<{ id: string }>;
  expect(episodes).toHaveLength(1);
});
