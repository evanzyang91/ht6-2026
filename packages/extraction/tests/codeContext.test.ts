import { describe, expect, it } from "vitest";
import type { RawReviewComment } from "@ht6/shared";
import { buildReviewCodeContext } from "../src/context/buildReviewCodeContext.js";

const base: RawReviewComment = {
  type: "inline",
  repository: "acme/api",
  pullRequest: 12,
  commentId: "99",
  reviewer: "sam",
  body: "Use the service layer",
  filePath: "src/controllers/order.ts",
  originalCommitSha: "before",
  line: 9,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("historical symbol context", () => {
  it("extracts the enclosing symbol, imports, and accepted symbol without unrelated functions", () => {
    const reviewedFileContent = [
      'import { prisma } from "../db";',
      "",
      "function unrelated() {",
      "  return true;",
      "}",
      "",
      "export async function createOrder(data: Input) {",
      "  const draft = normalize(data);",
      "  return prisma.order.create({ data: draft });",
      "}",
    ].join("\n");
    const mergedFileContent = reviewedFileContent.replace(
      "return prisma.order.create({ data: draft });",
      "return orderService.create(draft);",
    );
    const context = buildReviewCodeContext(
      { ...base, reviewedFileContent, mergedFileContent },
      "return orderService.create(draft);",
    );
    expect(context).toMatchObject({
      source: "historical-file",
      language: "typescript",
      commentLine: 9,
      enclosingSymbol: { name: "createOrder", kind: "function", startLine: 7, endLine: 10 },
      imports: ['import { prisma } from "../db";'],
      truncated: false,
    });
    expect(context?.reviewedContext).toContain("prisma.order.create");
    expect(context?.reviewedContext).not.toContain("unrelated");
    expect(context?.acceptedContext).toContain("orderService.create");
  });

  it("falls back to the bounded diff hunk when historical content is unavailable", () => {
    const context = buildReviewCodeContext({
      ...base,
      diffHunk: "@@ -1 +1 @@\n+return prisma.order.create(data)",
    });
    expect(context).toMatchObject({ source: "diff-hunk", language: "typescript", imports: [] });
    expect(context?.reviewedContext).toContain("prisma.order.create");
  });
});
