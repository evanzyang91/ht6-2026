import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { loadPipelineState, markRepositoryIngested } from "@ht6/pipeline";

const rawComment = {
  type: "inline" as const,
  repository: "acme/api",
  pullRequest: 7,
  commentId: "c1",
  reviewer: "sam",
  body: "Use the service layer instead of Prisma directly.",
  filePath: "src/controllers/order.ts",
  originalCommitSha: "abc123",
  line: 4,
  diffHunk: '@@ -1,3 +1,4 @@\n+import { prisma } from "../db";',
  createdAt: new Date().toISOString(),
};

vi.mock("@ht6/ingestion", () => ({
  ingest: vi.fn(async (repository: string, options: { dataDirectory: string }) => {
    // Mirrors what a real ingest() does: persist the new comment and bump ingestionVersion —
    // refreshRepositoryMemory's ensureMemoryFresh call depends on that version bump to notice
    // there's something new to compile.
    await writeFile(join(options.dataDirectory, "raw-comments.json"), JSON.stringify([rawComment]));
    await markRepositoryIngested(repository, 7, options.dataDirectory, { changed: true });
    return [rawComment];
  }),
}));

afterEach(() => vi.restoreAllMocks());

it("compiles conventions immediately after a sync ingests something new, not just on the next read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engineering-memory-refresh-"));
  const { refreshRepositoryMemory, inspectRepositoryMemory } = await import("../src/api.js");

  const before = await inspectRepositoryMemory("acme/api", { dataDirectory: directory });
  expect(before.status).toBe("unprocessed");

  const result = await refreshRepositoryMemory("acme/api", { token: "fake-token", dataDirectory: directory });
  expect(result).toEqual({ repository: "acme/api", commentCount: 1 });

  // The precise, clustering-independent proof that extraction actually ran: pipeline-state's
  // extractionVersion caught up to ingestionVersion within this same call, rather than being left
  // stale for the next read to notice.
  const state = await loadPipelineState(directory);
  expect(state["acme/api"].extractionVersion).toBeGreaterThanOrEqual(state["acme/api"].ingestionVersion);

  const after = await inspectRepositoryMemory("acme/api", { dataDirectory: directory });
  expect(after.status).not.toBe("stale");
});

it("does not run extraction when nothing new was ingested", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engineering-memory-refresh-"));
  const { ingest } = await import("@ht6/ingestion");
  vi.mocked(ingest).mockImplementationOnce(async () => []);

  const { refreshRepositoryMemory } = await import("../src/api.js");
  const result = await refreshRepositoryMemory("acme/api", { token: "fake-token", dataDirectory: directory });
  expect(result).toEqual({ repository: "acme/api", commentCount: 0 });

  // No repository state exists at all yet — ensureMemoryFresh should have returned immediately
  // rather than attempting to extract a repository with no pipeline state.
  const state = await loadPipelineState(directory);
  expect(state["acme/api"]).toBeUndefined();
});
