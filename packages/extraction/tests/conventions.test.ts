import { describe, expect, it } from "vitest";
import type { ReviewEpisode } from "@ht6/shared";
import { buildConventions } from "../src/conventions.js";
import { scoreLinkageQuality } from "../src/linking/linkageQuality.js";

const episode = (id: string, pr: number, comment: string, rejectedCode: string, acceptedCode: string): ReviewEpisode => ({
  id, repository: "acme/api", pullRequest: pr, reviewer: "sam", filePath: `src/controllers/${id}.ts`,
  reviewComment: comment, rejectedCode, acceptedCode, acceptedFixQuality: "high", intent: "architecture", createdAt: "2026-01-01T00:00:00Z",
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
});
