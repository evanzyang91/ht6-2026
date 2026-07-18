import type { Convention } from "@ht6/shared";

// TODO: combine similarity score(s) with Convention.confidence and supportingEpisodes.length
// into a final ranking for get_repo_conventions results.
export function rankConventions(
  conventions: Convention[],
  similarityScores: Map<string, number>
): Convention[] {
  throw new Error("not implemented");
}
