import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ensureMemoryFresh } from "../src/freshness.js";
import { loadPipelineState, markRepositoryIngested } from "../src/state.js";

it("extracts stale merged-PR memory before an MCP read", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "engineering-memory-pipeline-"));
  await writeFile(join(dataDir, "raw-comments.json"), JSON.stringify([{
    repository: "acme/api",
    pullRequest: 42,
    commentId: "comment-1",
    reviewer: "sam",
    body: "Controllers should never access Prisma directly",
    filePath: "src/controllers/order.ts",
    originalCommitSha: "abc",
    diffHunk: "@@ -1 +1 @@\n+return prisma.order.create({ data })",
    createdAt: "2026-01-01T00:00:00Z",
  }]));
  await markRepositoryIngested("acme/api", 42, dataDir);
  await ensureMemoryFresh("acme/api", dataDir);

  const conventions = JSON.parse(await readFile(join(dataDir, "conventions.json"), "utf8")) as unknown[];
  const state = await loadPipelineState(dataDir);
  expect(conventions).toHaveLength(1);
  expect(state["acme/api"]).toMatchObject({ ingestionVersion: 1, extractionVersion: 1, lastMergedPullRequest: 42 });
});
