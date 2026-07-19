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

  it("keeps missing-required convention fields canonical", () => {
    const value = episode(
      "feature-flag",
      310,
      "New public endpoints must be guarded by a feature flag.",
      "router.get('/reports', reportsController)",
      "router.get('/reports', requireFeature('reports'), reportsController)",
    );
    value.semanticAnalysis = {
      provider: "freesolo",
      version: "v2",
      intent: "architecture",
      title: "Feature-flag public endpoints",
      rule: "New public endpoints require a feature flag.",
      rationale: "The accepted route adds the missing feature gate.",
      prohibitedSignals: [],
      preferredSignals: ["requireFeature"],
      detection: {
        mode: "missing-required-signal",
        semanticDescription: "A public endpoint is registered without its feature gate.",
        triggerSignals: ["reportsController"],
        forbiddenSignals: [],
        requiredSignals: ["requireFeature"],
        matchScope: "line",
      },
    };

    const [convention] = buildConventions([value]);
    expect(convention.prohibitedSignals).toEqual([]);
    expect(convention.preferredSignals).toEqual(["requireFeature"]);
    expect(convention.detection).toEqual(value.semanticAnalysis.detection);
  });

  it("preserves descriptive signals for semantic-only conventions", () => {
    const value = episode(
      "boolean-name",
      145,
      "Rename loading to isLoading.",
      "const loading = query.status === 'loading'",
      "const isLoading = query.status === 'loading'",
    );
    value.semanticAnalysis = {
      provider: "freesolo",
      version: "v2",
      intent: "style",
      title: "Name booleans as predicates",
      rule: "Boolean variables should use predicate-style names.",
      rationale: "The accepted code uses isLoading.",
      prohibitedSignals: ["loading"],
      preferredSignals: ["isLoading"],
      detection: {
        mode: "semantic",
        semanticDescription: "A boolean name is not predicate-style.",
        triggerSignals: [],
        forbiddenSignals: [],
        requiredSignals: [],
        matchScope: "line",
      },
    };

    const [convention] = buildConventions([value]);
    expect(convention.prohibitedSignals).toEqual(["loading"]);
    expect(convention.preferredSignals).toEqual(["isLoading"]);
    expect(convention.detection?.mode).toBe("semantic");
  });
});
