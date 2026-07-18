import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RawReviewComment } from "@ht6/shared";
import { JsonStore } from "../src/storage/jsonStore.js";

// These test the Store directly with hand-written fixtures rather than mocking the whole
// GitHub client — the success criterion ("another teammate can query persisted review comments
// without making GitHub API calls") is fundamentally a guarantee about the Store, not about how
// ingest() happens to populate it.
function makeComment(overrides: Partial<RawReviewComment> = {}): RawReviewComment {
  return {
    repository: "owner/repo",
    pullRequest: 1,
    commentId: "c1",
    reviewer: "alice",
    body: "use const instead of let here",
    filePath: "src/index.ts",
    originalCommitSha: "abc123",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("JsonStore", () => {
  let dataDir: string;
  let originalDataDir: string | undefined;

  beforeEach(async () => {
    originalDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(path.join(tmpdir(), "ht6-ingestion-test-"));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    process.env.DATA_DIR = originalDataDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("persists RawReviewComment[] that a fresh Store.load() can read back", async () => {
    const store = new JsonStore();
    const comments = [makeComment({ commentId: "c1" }), makeComment({ commentId: "c2" })];

    await store.save("owner/repo", comments);

    const freshStore = new JsonStore();
    const loaded = await freshStore.load("owner/repo");

    expect(loaded).toHaveLength(2);
    expect(loaded.map((c) => c.commentId).sort()).toEqual(["c1", "c2"]);
  });

  it("re-running save() for the same repo does not duplicate records (idempotent)", async () => {
    const store = new JsonStore();
    const comment = makeComment({ commentId: "c1" });

    await store.save("owner/repo", [comment]);
    await store.save("owner/repo", [comment, makeComment({ commentId: "c2" })]);

    const loaded = await store.load("owner/repo");
    expect(loaded).toHaveLength(2);
    expect(loaded.filter((c) => c.commentId === "c1")).toHaveLength(1);
  });

  it("keeps other repositories' data untouched when saving one repo", async () => {
    const store = new JsonStore();
    await store.save("owner/repo-a", [
      makeComment({ repository: "owner/repo-a", commentId: "a1" }),
    ]);
    await store.save("owner/repo-b", [
      makeComment({ repository: "owner/repo-b", commentId: "b1" }),
    ]);

    expect((await store.load("owner/repo-a")).map((c) => c.commentId)).toEqual(["a1"]);
    expect((await store.load("owner/repo-b")).map((c) => c.commentId)).toEqual(["b1"]);
  });
});
