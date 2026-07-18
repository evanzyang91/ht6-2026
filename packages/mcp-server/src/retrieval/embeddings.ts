import type { Convention } from "@ht6/shared";

// TODO (optional/stretch): score conventions against a query using embedding similarity
// instead of/alongside textSimilarity.ts.
export async function scoreByEmbeddingSimilarity(
  conventions: Convention[],
  query: string
): Promise<Map<string, number>> {
  throw new Error("not implemented");
}
