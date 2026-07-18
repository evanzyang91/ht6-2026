import { expect, it } from "vitest";
import type { Convention } from "@ht6/shared";
import type { ConventionStore } from "../src/store/conventionStore.js";
import { retrieveConventions } from "../src/retrieval/index.js";
import { getRepoConventions } from "../src/tools/get_repo_conventions.js";

const convention = (id: string, repository: string, confidence: number, support: number): Convention => ({
  id, repository, title: id, rule: "Controllers must use services", rationale: "Repeated review feedback",
  category: "architecture", pathScopes: ["src/controllers/**"], languages: ["typescript"],
  prohibitedSignals: ["prisma.user.findMany"], preferredSignals: ["userService.list"], confidence,
  supportingEpisodes: Array.from({ length: support }, (_, index) => `${id}-${index}`), evidence: [],
});

it("retrieves only scoped repository conventions and ranks confidence/support", async () => {
  const values = [convention("low", "acme/api", 0.5, 1), convention("high", "acme/api", 0.9, 3), convention("other", "else/web", 1, 5)];
  const store: ConventionStore = { all: async () => values };
  const result = await retrieveConventions(store, { repository: "acme/api", path: "src/controllers/user.ts", query: "services" });
  expect(result.map((item) => item.id)).toEqual(["high", "low"]);
});

it("returns a compact agent-facing convention with PR evidence", async () => {
  const value = convention("one", "acme/api", 0.9, 2);
  value.evidence = [{ episodeId: "episode", pullRequest: 142, reviewer: "sam", filePath: "src/controllers/user.ts", reviewComment: "Use services", rejectedCode: "prisma.user.findMany()", acceptedCode: "userService.list()" }];
  const store: ConventionStore = { all: async () => [value] };
  const [result] = await getRepoConventions(store, { repository: "acme/api" });
  expect(result).toMatchObject({ supportCount: 2, supportingPRs: [142], acceptedExamples: ["userService.list()"] });
  expect(result).not.toHaveProperty("evidence");
  expect(result).not.toHaveProperty("supportingEpisodes");
});
