import type { ReviewEpisode } from "@ht6/shared";
import type { SemanticAnalysis } from "../semantic/types.js";

// Groups ReviewEpisodes that represent the same underlying convention, so
// buildConventions() can turn each cluster into one Convention with confidence =
// f(cluster size, linkage quality).
//
// Cluster on reviewComment + rejectedCode/acceptedCode together, not comment text alone.
// Some comments are self-contained ("never use function B for verification") and cluster
// fine on text; others are context-dependent ("fix this", "same as above") and are only
// distinguishable by the code pattern they're attached to. Embedding/comparing the pair
// jointly handles both cases without needing to classify comment type up front.
export function clusterEpisodes(
  episodes: ReviewEpisode[],
  semantics: ReadonlyMap<string, SemanticAnalysis> = new Map()
): ReviewEpisode[][] {
  const stop = new Set(["this", "that", "with", "from", "have", "should", "could", "would", "please", "here", "there", "instead"]);
  const tokens = (episode: ReviewEpisode) => new Set(
    `${semantics.get(episode.id)?.rule ?? episode.reviewComment} ${episode.rejectedCode} ${episode.acceptedCode ?? ""}`
      .toLowerCase().match(/[a-z_$][\w$]{2,}/g)
      ?.filter((word) => !stop.has(word)) ?? []
  );
  const similarity = (a: Set<string>, b: Set<string>) => {
    const intersection = [...a].filter((token) => b.has(token)).length;
    return intersection / Math.max(1, Math.min(a.size, b.size));
  };
  const clusters: ReviewEpisode[][] = [];
  for (const episode of episodes.filter((item) => item.intent !== "question-nonactionable")) {
    const episodeTokens = tokens(episode);
    const match = clusters.find((cluster) =>
      cluster[0].repository === episode.repository &&
      cluster[0].intent === episode.intent &&
      cluster.some((candidate) => similarity(tokens(candidate), episodeTokens) >= 0.35)
    );
    if (match) match.push(episode); else clusters.push([episode]);
  }
  return clusters;
}
