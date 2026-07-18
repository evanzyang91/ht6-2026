import type { RawReviewComment } from "@ht6/shared";
import { expect, it } from "vitest";
import { inputDigest } from "../src/storage/inputDigest.js";

const first: RawReviewComment = {
  repository: "acme/api", pullRequest: 1, commentId: "a", reviewer: "sam",
  body: "Use a service", filePath: "src/a.ts", originalCommitSha: "abc",
  createdAt: "2026-01-01T00:00:00Z",
};
const second: RawReviewComment = {
  repository: "acme/api", pullRequest: 2, commentId: "b", reviewer: "pat",
  body: "Add a test", filePath: "src/b.ts", originalCommitSha: "def",
  createdAt: "2026-01-02T00:00:00Z",
};

it("produces the same digest regardless of comment and object-key order", () => {
  const reorderedKeys = Object.fromEntries(Object.entries(first).reverse()) as unknown as RawReviewComment;
  expect(inputDigest([first, second])).toBe(inputDigest([second, reorderedKeys]));
});

it("changes when source evidence changes", () => {
  expect(inputDigest([first])).not.toBe(inputDigest([{ ...first, body: "Use the repository layer" }]));
});
