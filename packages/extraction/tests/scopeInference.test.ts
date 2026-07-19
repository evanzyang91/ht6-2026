import { expect, it } from "vitest";
import type { ReviewEpisode } from "@ht6/shared";
import { inferScope } from "../src/clustering/scopeInference.js";

function episode(overrides: Partial<ReviewEpisode>): ReviewEpisode {
  return {
    id: "id",
    repository: "acme/api",
    pullRequest: 1,
    reviewer: "sam",
    reviewComment: "review",
    acceptedFixQuality: "unknown",
    intent: "actionable-change",
    semanticAnalysis: {
      provider: "deterministic",
      version: "1",
      intent: "actionable-change",
      title: "title",
      rule: "rule",
      rationale: "rationale",
      prohibitedSignals: [],
      preferredSignals: [],
    },
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

it("infers a real path scope from an all-inline cluster", () => {
  const { pathScopes } = inferScope([
    episode({ filePath: "src/controllers/order.ts" }),
    episode({ filePath: "src/controllers/user.ts" }),
  ]);
  expect(pathScopes).toEqual(["src/controllers/**"]);
});

it("degrades to a wildcard scope for an all-PR-level cluster", () => {
  const { pathScopes, languages } = inferScope([
    episode({ filePath: undefined }),
    episode({ filePath: undefined }),
  ]);
  expect(pathScopes).toEqual(["**"]);
  expect(languages).toEqual([]);
});

it("does not let one PR-level episode collapse scope inferred from its inline cluster-mates", () => {
  const { pathScopes } = inferScope([
    episode({ filePath: "src/controllers/order.ts" }),
    episode({ filePath: "src/controllers/user.ts" }),
    episode({ filePath: undefined }),
  ]);
  expect(pathScopes).toEqual(["src/controllers/**"]);
});
