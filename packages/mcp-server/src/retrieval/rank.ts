import type { Convention } from "@ht6/shared";

// Combines task similarity, extraction confidence, and historical support.
export function rankConventions(
  conventions: Convention[],
  similarityScores: Map<string, number>
): Convention[] {
  return [...conventions].sort((a, b) => {
    const score = (item: Convention) =>
      (similarityScores.get(item.id) ?? 0) * 0.55 + item.confidence * 0.35 + Math.min(item.supportingEpisodes.length / 5, 1) * 0.1;
    return score(b) - score(a);
  });
}
