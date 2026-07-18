import { expect, it } from "vitest";
import type { Convention } from "@ht6/shared";
import type { ConventionStore } from "../src/store/conventionStore.js";
import { retrieveConventions } from "../src/retrieval/index.js";

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
