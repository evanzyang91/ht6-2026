import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { runExtraction } from "../src/pipeline.js";
import type { ExtractionPublisher, ExtractionSnapshot } from "../src/storage/types.js";

// data/raw-comments.json holds the RawComment union (inline + review-summary + conversation).
// All three now reach episode-building: inline goes through hunk-linking as before; review-summary
// and conversation (no file/diff to anchor to) go through the PR-level path and land as episodes
// with filePath/rejectedCode undefined, acceptedFixQuality "unknown", and a "semantic" detection
// mode (no code to derive forbidden/required signals from).
it("extracts episodes from inline, review-summary, and conversation comments alike", async () => {
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
  expect(result.episodeCount).toBe(3);
  expect(result.publishedRepositoryCount).toBe(1);
  expect(published?.comments).toHaveLength(3);
  expect(published?.episodes).toHaveLength(3);

  const episodes = JSON.parse(await readFile(join(dataDir, "episodes.json"), "utf8")) as Array<{
    id: string;
    reviewComment: string;
    filePath?: string;
    rejectedCode?: string;
    acceptedFixQuality: string;
    semanticAnalysis: { detection?: { mode: string } };
  }>;
  expect(episodes).toHaveLength(3);

  const prLevelEpisodes = episodes.filter((episode) => episode.reviewComment !== "Controllers should never access Prisma directly");
  expect(prLevelEpisodes).toHaveLength(2);
  for (const episode of prLevelEpisodes) {
    expect(episode.filePath).toBeUndefined();
    expect(episode.rejectedCode).toBeUndefined();
    expect(episode.acceptedFixQuality).toBe("unknown");
    expect(episode.semanticAnalysis.detection?.mode).toBe("semantic");
  }

  const inlineEpisode = episodes.find((episode) => episode.reviewComment === "Controllers should never access Prisma directly");
  expect(inlineEpisode?.filePath).toBe("src/controllers/order.ts");
});
