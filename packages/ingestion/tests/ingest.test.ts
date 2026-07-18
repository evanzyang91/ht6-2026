import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { JsonStore } from "../src/storage/jsonStore.js";

it("persists comments idempotently without mixing repositories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engineering-memory-"));
  const store = new JsonStore(join(directory, "raw-comments.json"));
  const comment = {
    repository: "acme/api", pullRequest: 1, commentId: "99", reviewer: "sam", body: "Use the service",
    filePath: "src/controller.ts", originalCommitSha: "abc", createdAt: "2026-01-01T00:00:00Z",
  };
  await store.save("acme/api", [comment, comment]);
  expect(await store.load("acme/api")).toEqual([comment]);
  expect(await store.load("other/repo")).toEqual([]);
});

it("persists RawReviewComment[] that a fresh JsonStore instance can read back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engineering-memory-"));
  const filePath = join(directory, "raw-comments.json");
  const comment = {
    repository: "acme/api", pullRequest: 2, commentId: "c1", reviewer: "alice",
    body: "use const instead of let here", filePath: "src/index.ts", originalCommitSha: "abc123",
    createdAt: "2026-01-01T00:00:00Z",
  };

  await new JsonStore(filePath).save("acme/api", [comment]);

  const freshStore = new JsonStore(filePath);
  expect(await freshStore.load("acme/api")).toEqual([comment]);
});

it("keeps two different repositories' comments separate when both have data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engineering-memory-"));
  const store = new JsonStore(join(directory, "raw-comments.json"));
  const commentA = {
    repository: "owner/repo-a", pullRequest: 1, commentId: "a1", reviewer: "alice", body: "nit",
    filePath: "src/a.ts", originalCommitSha: "sha-a", createdAt: "2026-01-01T00:00:00Z",
  };
  const commentB = {
    repository: "owner/repo-b", pullRequest: 1, commentId: "b1", reviewer: "bob", body: "nit",
    filePath: "src/b.ts", originalCommitSha: "sha-b", createdAt: "2026-01-01T00:00:00Z",
  };

  await store.save("owner/repo-a", [commentA]);
  await store.save("owner/repo-b", [commentB]);

  expect(await store.load("owner/repo-a")).toEqual([commentA]);
  expect(await store.load("owner/repo-b")).toEqual([commentB]);
});
