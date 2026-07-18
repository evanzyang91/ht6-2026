import type { Convention } from "@ht6/shared";
import type { ConventionStore } from "../store/conventionStore.js";
import { filterByRepo } from "./filterByRepo.js";
import { filterByScope } from "./filterByScope.js";
import { scoreByTextSimilarity } from "./textSimilarity.js";
import { rankConventions } from "./rank.js";
import { scoreByEmbeddingSimilarity } from "./embeddings.js";

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
  const textScores = scoreByTextSimilarity(scoped, query.query ?? "");
  const embeddingScores = query.query && process.env.ENGINEERING_MEMORY_EMBEDDINGS === "local"
    ? await scoreByEmbeddingSimilarity(scoped, query.query)
    : new Map<string, number>();
  return rankConventions(scoped, textScores, embeddingScores).slice(0, query.limit ?? 20);
}
