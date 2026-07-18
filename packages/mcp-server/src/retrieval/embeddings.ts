import type { Convention } from "@ht6/shared";

// Optional provider seam. Retrieval does not call it unless an embedding provider is configured.
export async function scoreByEmbeddingSimilarity(
  conventions: Convention[],
  query: string
): Promise<Map<string, number>> {
  void query;
  return new Map(conventions.map((convention) => [convention.id, 0]));
}
