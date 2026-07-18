import type { Convention, ReviewEpisode } from "@ht6/shared";

// Clusters equivalent ReviewEpisodes and produces Convention records with confidence and
// supportingEpisodes populated. See clustering/clusterConventions.ts and
// clustering/scopeInference.ts for the pieces this composes.
//
// When synthesizing Convention.rule from a cluster, use the comment text *and* the
// rejectedCode/acceptedCode pair — don't derive the rule from comment text in isolation.
// Self-contained comments will nearly hand you the rule verbatim; context-dependent ones
// only generalize correctly once you look at what the code actually changed to.
export function buildConventions(episodes: ReviewEpisode[]): Convention[] {
  throw new Error("not implemented");
}
