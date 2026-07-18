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
    expect(analysis.rule).toBe("Controllers should never access Prisma directly");
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
});

