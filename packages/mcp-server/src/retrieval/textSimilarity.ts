import type { Convention } from "@ht6/shared";

// TODO: score conventions against a free-text query (e.g. BM25/TF-IDF over rule + rationale).
export function scoreByTextSimilarity(conventions: Convention[], query: string): Map<string, number> {
  throw new Error("not implemented");
}
