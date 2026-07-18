import { describe, expect, it } from "vitest";
import type { PredictedFeedback } from "@ht6/mcp-server/api";
import { applySafeguards } from "../src/safeguards.js";
import { repositoryFromRemote } from "../src/git.js";
import { shouldShowPopup } from "../src/popupPolicy.js";

const finding = (overrides: Partial<PredictedFeedback> = {}): PredictedFeedback => ({
  conventionId: "no-prisma",
  rule: "Controllers use services",
  confidence: 0.9,
  supportCount: 3,
  matchedPath: "src/controllers/order.ts",
  matchedLine: 12,
  matchedSignal: "prisma.order.create",
  reason: "Historically rejected signal",
  supportingPRs: [1, 2, 3],
  acceptedExamples: ["orderService.create(data)"],
  ...overrides,
});

const settings = {
  minimumConfidence: 0.8,
  minimumPullRequestSupport: 2,
  maximumDiagnosticsPerFile: 2,
  mutedConventionIds: [] as string[],
};

describe("editor false-positive safeguards", () => {
  it("requires confidence and distinct PR support", () => {
    expect(applySafeguards([finding({ confidence: 0.79 }), finding({ conventionId: "single", supportCount: 1 })], settings)).toEqual([]);
  });

  it("deduplicates, honors mutes, and caps each file", () => {
    const results = applySafeguards([
      finding(), finding(),
      finding({ conventionId: "muted", matchedLine: 13 }),
      finding({ conventionId: "second", matchedLine: 14 }),
      finding({ conventionId: "third", matchedLine: 15 }),
    ], { ...settings, mutedConventionIds: ["muted"] });
    expect(results.map((item) => item.conventionId)).toEqual(["no-prisma", "second"]);
  });

  it("infers GitHub repository slugs without prompting", () => {
    expect(repositoryFromRemote("git@github.com:acme/api.git")).toBe("acme/api");
    expect(repositoryFromRemote("https://github.com/acme/api.git")).toBe("acme/api");
  });

  it("shows one popup for new findings and suppresses identical findings during cooldown", () => {
    const first = shouldShowPopup([finding()], undefined, 1_000, 300_000);
    expect(first.show).toBe(true);
    expect(shouldShowPopup([finding()], first.record, 2_000, 300_000).show).toBe(false);
    expect(shouldShowPopup([finding({ matchedLine: 99 })], first.record, 2_000, 300_000).show).toBe(true);
    expect(shouldShowPopup([finding()], first.record, 301_001, 300_000).show).toBe(true);
  });
});
