import type { ReviewEpisode } from "@ht6/shared";

// TODO: group ReviewEpisodes that represent the same underlying convention, so
// buildConventions() can turn each cluster into one Convention with confidence =
// f(cluster size, linkage quality).
//
// Cluster on reviewComment + rejectedCode/acceptedCode together, not comment text alone.
// Some comments are self-contained ("never use function B for verification") and cluster
// fine on text; others are context-dependent ("fix this", "same as above") and are only
// distinguishable by the code pattern they're attached to. Embedding/comparing the pair
// jointly handles both cases without needing to classify comment type up front.
export function clusterEpisodes(episodes: ReviewEpisode[]): ReviewEpisode[][] {
  throw new Error("not implemented");
}
