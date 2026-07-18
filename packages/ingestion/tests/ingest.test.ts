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
