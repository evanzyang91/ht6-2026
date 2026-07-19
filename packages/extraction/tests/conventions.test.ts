import { describe, expect, it } from "vitest";
import type { ReviewEpisode } from "@ht6/shared";
import { buildConventions } from "../src/conventions.js";
import { extractComments } from "../src/extract.js";
import { scoreLinkageQuality } from "../src/linking/linkageQuality.js";
import type { SemanticAnalyzer } from "../src/semantic/types.js";

const episode = (id: string, pr: number, comment: string, rejectedCode: string, acceptedCode: string): ReviewEpisode => ({
  id, repository: "acme/api", pullRequest: pr, reviewer: "sam", filePath: `src/controllers/${id}.ts`,
  reviewComment: comment, rejectedCode, acceptedCode, acceptedFixQuality: "high", intent: "architecture",
  semanticAnalysis: {
    provider: "fixture", version: "1", intent: "architecture", title: comment, rule: comment,
    rationale: "Test fixture", prohibitedSignals: [], preferredSignals: [],
  },
  createdAt: "2026-01-01T00:00:00Z",
});

describe("engineering-memory extraction", () => {
  it("clusters repeated review episodes into an evidence-backed convention", () => {
    const conventions = buildConventions([
      episode("a", 10, "Controllers should never access Prisma directly", "prisma.user.findMany()", "userService.list()"),
      episode("b", 22, "Never access Prisma directly from controllers", "prisma.order.findMany()", "orderService.list()"),
    ]);
    expect(conventions).toHaveLength(1);
    expect(conventions[0].supportingEpisodes).toHaveLength(2);
    expect(conventions[0].evidence.map((item) => item.pullRequest)).toEqual([10, 22]);
    expect(conventions[0].prohibitedSignals).toContain("prisma.user.findMany");
  });

  it("returns unknown when no accepted fix is found", () => {
    expect(scoreLinkageQuality("prisma.user.findMany()")) .toBe("unknown");
  });

  it("marks a changed implementation found in the merged patch as high quality", () => {
    expect(scoreLinkageQuality("oldCall()", "newCall()", { matchedInMergedPatch: true })).toBe("high");
  });

  it("does not claim high-quality linkage without an exact merged-patch match", () => {
    expect(scoreLinkageQuality("oldCall()", "newCall()", { matchedInMergedPatch: false })).toBe("medium");
  });

  it("uses the supplied semantic analyzer without changing the output contracts", async () => {
    const analyzer: SemanticAnalyzer = {
      provider: "test-provider",
      version: "1",
      async analyze(input) {
        return {
          intent: "architecture",
          title: "Use the service layer",
          rule: "Controllers must use the service layer.",
          rationale: `Normalized from ${input.filePath}.`,
          prohibitedSignals: ["prisma.user.findMany"],
          preferredSignals: ["userService.list"],
        };
      },
    };
    const result = await extractComments([{
      repository: "acme/api",
      pullRequest: 12,
      commentId: "99",
      reviewer: "sam",
      body: "Fix this",
      filePath: "src/controllers/users.ts",
      originalCommitSha: "before",
      mergedCommitSha: "after",
      diffHunk: "@@ -1 +1 @@\n+prisma.user.findMany()",
      acceptedFilePatch: "@@ -1 +1 @@\n-prisma.user.findMany()\n+userService.list()",
      createdAt: "2026-01-01T00:00:00Z",
    }], analyzer);

    expect(result.episodes[0].intent).toBe("architecture");
    expect(result.episodes[0].acceptedFixQuality).toBe("high");
    expect(result.episodes[0].semanticAnalysis).toMatchObject({
      provider: "test-provider",
      version: "1",
      rule: "Controllers must use the service layer.",
    });
    expect(result.conventions[0]).toMatchObject({
      title: "Use the service layer",
      rule: "Controllers must use the service layer.",
      prohibitedSignals: ["prisma.user.findMany"],
      preferredSignals: ["userService.list"],
    });
  });

  it("keeps missing-required signals exact and splits incompatible detection clusters", () => {
    const missing = episode(
      "missing",
      31,
      "Order routes require authentication",
      "router.post('/orders', createOrder)",
      "router.post('/orders', requireAuth, createOrder)",
    );
    missing.semanticAnalysis.preferredSignals = ["requireAuth", "descriptive-extra"];
    missing.semanticAnalysis.detection = {
      mode: "missing-required-signal",
      semanticDescription: "An order route is missing authentication.",
      triggerSignals: ["router.post"],
      forbiddenSignals: [],
      requiredSignals: ["requireAuth"],
      matchScope: "file",
    };
    const forbidden = episode(
      "forbidden",
      32,
      "Order routes require authentication",
      "router.post('/orders', createOrder)",
      "secureRouter.post('/orders', createOrder)",
    );
    forbidden.semanticAnalysis.prohibitedSignals = ["router.post"];
    forbidden.semanticAnalysis.detection = {
      mode: "forbidden-signal",
      semanticDescription: "The unguarded router is forbidden.",
      triggerSignals: [],
      forbiddenSignals: ["router.post"],
      requiredSignals: [],
      matchScope: "file",
    };

    const conventions = buildConventions([missing, forbidden]);

    expect(conventions).toHaveLength(2);
    expect(conventions.find((item) => item.detection?.mode === "missing-required-signal")?.preferredSignals)
      .toEqual(["requireAuth"]);
  });

  it("preserves grounded descriptive signals for semantic conventions", () => {
    const semantic = episode(
      "semantic",
      40,
      "Prefer intention-revealing names",
      "const x = order.total",
      "const orderTotal = order.total",
    );
    semantic.semanticAnalysis.prohibitedSignals = ["x"];
    semantic.semanticAnalysis.preferredSignals = ["orderTotal"];
    semantic.semanticAnalysis.detection = {
      mode: "semantic",
      semanticDescription: "A local variable name does not communicate its meaning.",
      triggerSignals: [],
      forbiddenSignals: [],
      requiredSignals: [],
      matchScope: "line",
    };

    expect(buildConventions([semantic])[0]).toMatchObject({
      prohibitedSignals: ["x"],
      preferredSignals: ["orderTotal"],
      detection: { mode: "semantic", matchScope: "line" },
    });
  });
});
