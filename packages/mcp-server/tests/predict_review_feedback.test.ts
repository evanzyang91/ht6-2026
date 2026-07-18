import { expect, it } from "vitest";
import type { Convention } from "@ht6/shared";
import { validateAgainstDiff } from "../src/validation/index.js";

const memory: Convention = {
  id: "prisma", repository: "acme/api", title: "No Prisma in controllers", rule: "Controllers must not access Prisma directly",
  rationale: "Keep persistence behind services", category: "architecture", pathScopes: ["src/controllers/**"], languages: ["typescript"],
  prohibitedSignals: ["prisma.user.findMany"], preferredSignals: ["userService.list"], confidence: 0.91,
  supportingEpisodes: ["a", "b"], evidence: [{ episodeId: "a", pullRequest: 12, reviewer: "sam", filePath: "src/controllers/a.ts", reviewComment: "Use a service", rejectedCode: "prisma.user.findMany()", acceptedCode: "userService.list()" }],
};

it("flags a scoped added line and returns historical evidence", async () => {
  const diff = "diff --git a/src/controllers/user.ts b/src/controllers/user.ts\n+++ b/src/controllers/user.ts\n@@ -10 +10 @@\n+const users = await prisma.user.findMany();";
  const findings = await validateAgainstDiff([memory], diff);
  expect(findings[0]).toMatchObject({ conventionId: "prisma", matchedPath: "src/controllers/user.ts", matchedLine: 10, supportCount: 1, supportingPRs: [12] });
});

it("does not flag unrelated code", async () => {
  const diff = "+++ b/src/controllers/user.ts\n+return userService.list();";
  expect(await validateAgainstDiff([memory], diff)).toEqual([]);
});

it("does not apply a convention to a different language", async () => {
  const diff = "+++ b/src/controllers/user.py\n@@ -1 +1 @@\n+prisma.user.findMany()";
  expect(await validateAgainstDiff([memory], diff)).toEqual([]);
});

it("supports an injected semantic fallback for conventions without executable signals", async () => {
  const semanticOnly = { ...memory, prohibitedSignals: [] };
  const diff = "+++ b/src/controllers/user.ts\n+const result = doSomethingNovel();";
  const findings = await validateAgainstDiff([semanticOnly], diff, { llmFallback: async () => true });
  expect(findings[0].reason).toContain("semantic validator");
});
