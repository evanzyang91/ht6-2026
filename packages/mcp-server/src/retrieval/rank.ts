import type { Convention } from "@ht6/shared";

// Combines task similarity, extraction confidence, and historical support.
export function rankConventions(
  conventions: Convention[],
  textScores: Map<string, number>,
  embeddingScores = new Map<string, number>()
): Convention[] {
  return [...conventions].sort((a, b) => {
    const score = (item: Convention) =>
      (textScores.get(item.id) ?? 0) * 0.4 +
      (embeddingScores.get(item.id) ?? 0) * 0.15 +
      item.confidence * 0.35 +
      Math.min(item.supportingEpisodes.length / 5, 1) * 0.1;
    return score(b) - score(a);
  });
}
