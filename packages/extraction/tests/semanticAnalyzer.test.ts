import { describe, expect, it } from "vitest";
import { DeterministicSemanticAnalyzer } from "../src/semantic/deterministicSemanticAnalyzer.js";

describe("DeterministicSemanticAnalyzer", () => {
  it("classifies and extracts signals from explicit feedback", async () => {
    const analyzer = new DeterministicSemanticAnalyzer();
    const analysis = await analyzer.analyze({
      repository: "acme/api",
      pullRequest: 1,
      filePath: "src/controllers/users.ts",
      reviewComment: "Controllers should never access Prisma directly",
      rejectedCode: "prisma.user.findMany()",
      acceptedCode: "userService.list()",
    });

    expect(analysis.intent).toBe("architecture");
    expect(analysis.rule).not.toBe("Controllers should never access Prisma directly");
    expect(analysis.rule).toContain("Controllers");
    expect(analysis.rule).toContain("userService.list");
    expect(analysis.rule).toContain("prisma.user.findMany");
    expect(analysis.prohibitedSignals).toContain("prisma.user.findMany");
    expect(analysis.preferredSignals).toContain("userService.list");
  });

  it("derives a rule from code evidence for context-dependent comments", async () => {
    const analyzer = new DeterministicSemanticAnalyzer();
    const analysis = await analyzer.analyze({
      repository: "acme/api",
      pullRequest: 2,
      filePath: "src/controllers/orders.ts",
      reviewComment: "Fix this",
      rejectedCode: "prisma.order.create(data)",
      acceptedCode: "orderService.create(data)",
    });

    expect(analysis.rule).toContain("orderService.create");
    expect(analysis.rule).toContain("prisma.order.create");
  });

  it("turns a known review question into declarative repository knowledge", async () => {
    const analyzer = new DeterministicSemanticAnalyzer();
    const analysis = await analyzer.analyze({
      repository: "acme/api",
      pullRequest: 3,
      filePath: "README.md",
      reviewComment: "Would an example health-check request help contributors confirm that their local server started successfully?",
      rejectedCode: "npm run dev",
      acceptedCode: "",
    });

    expect(analysis.rule).toBe("Contributor setup documentation should include a health-check request that verifies the local server is ready.");
    expect(analysis.rule).not.toContain("Would");
    expect(analysis.rule).not.toMatch(/[?]$/);
  });

  it("paraphrases a question-phrased comment into an actionable rule instead of a placeholder", async () => {
    // classifyIntent already drops genuinely non-actionable questions before an episode ever
    // reaches clustering — a question that survived to here (analyzer.analyze is only called on
    // real episodes) has real content, so it should be paraphrased like any other comment, not
    // replaced with a generic "no established convention" placeholder that hides what was asked.
    const analyzer = new DeterministicSemanticAnalyzer();
    const reviewComment = "Should widgets remain visible after archival, or disappear immediately?";
    const analysis = await analyzer.analyze({
      repository: "acme/api",
      pullRequest: 4,
      filePath: "src/domain/widgets.ts",
      reviewComment,
      rejectedCode: "return widget.archived",
      acceptedCode: "",
    });

    expect(analysis.rule).not.toBe(reviewComment);
    expect(analysis.rule).not.toContain("explicit repository decision");
    expect(analysis.rule).not.toContain("should should");
    expect(analysis.rule).toBe("Repository code should widgets remain visible after archival, or disappear immediately.");
    expect(analysis.rule).not.toMatch(/[?]$/);
  });
});
