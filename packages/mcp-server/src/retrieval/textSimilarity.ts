import type { Convention } from "@ht6/shared";

// Lightweight lexical score over the compiled convention, suitable for the demo corpus.
export function scoreByTextSimilarity(conventions: Convention[], query: string): Map<string, number> {
  const tokenize = (value: string) => new Set(value.toLowerCase().match(/[a-z_$][\w$]{2,}/g) ?? []);
  const queryTokens = tokenize(query);
  return new Map(conventions.map((convention) => {
    const document = tokenize(`${convention.title} ${convention.rule} ${convention.rationale} ${convention.category} ${convention.prohibitedSignals.join(" ")}`);
    const overlap = [...queryTokens].filter((token) => document.has(token)).length;
    return [convention.id, queryTokens.size ? overlap / queryTokens.size : 1];
  }));
}
