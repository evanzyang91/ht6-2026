import type { Convention } from "@ht6/shared";
import type { ConventionStore } from "../store/conventionStore.js";
import { filterByRepo } from "./filterByRepo.js";
import { filterByScope } from "./filterByScope.js";
import { scoreByTextSimilarity } from "./textSimilarity.js";
import { rankConventions } from "./rank.js";

export interface RetrievalQuery {
  repository: string;
  path?: string;
  language?: string;
  query?: string;
  limit?: number;
}

// Orchestrates filterByRepo -> filterByScope -> textSimilarity/embeddings -> rank.
// Backs the get_repo_conventions MCP tool.
export async function retrieveConventions(
  store: ConventionStore,
  query: RetrievalQuery
): Promise<Convention[]> {
  const stored = await store.all(query.repository);
  const scoped = filterByScope(filterByRepo(stored, query.repository), query);
  const scores = scoreByTextSimilarity(scoped, query.query ?? "");
  return rankConventions(scoped, scores).slice(0, query.limit ?? 20);
}
