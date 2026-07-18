import type { Convention } from "@ht6/shared";
import type { ConventionStore } from "../store/conventionStore.js";

export interface RetrievalQuery {
  repository: string;
  path?: string;
  language?: string;
  query?: string;
}

// Orchestrates filterByRepo -> filterByScope -> textSimilarity/embeddings -> rank.
// Backs the get_repo_conventions MCP tool.
export async function retrieveConventions(
  store: ConventionStore,
  query: RetrievalQuery
): Promise<Convention[]> {
  throw new Error("not implemented");
}
