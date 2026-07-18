import type { Convention, ReviewEpisode } from "@ht6/shared";
import { createHash } from "node:crypto";
import { clusterEpisodes } from "./clustering/clusterConventions.js";
import { inferScope } from "./clustering/scopeInference.js";

// Clusters equivalent ReviewEpisodes and produces Convention records with confidence and
// supportingEpisodes populated. See clustering/clusterConventions.ts and
// clustering/scopeInference.ts for the pieces this composes.
//
// When synthesizing Convention.rule from a cluster, use the comment text *and* the
// rejectedCode/acceptedCode pair — don't derive the rule from comment text in isolation.
// Self-contained comments will nearly hand you the rule verbatim; context-dependent ones
// only generalize correctly once you look at what the code actually changed to.
export function buildConventions(episodes: ReviewEpisode[]): Convention[] {
  return clusterEpisodes(episodes).map((cluster) => {
    const representative = [...cluster].sort((a, b) => b.reviewComment.length - a.reviewComment.length)[0];
    const { pathScopes, languages } = inferScope(cluster);
    const extractSignals = (code: string) => {
      const imports = [...code.matchAll(/(?:from\s+|require\s*\(\s*['"])([@\w./-]+)/g)].map((match) => match[1]);
      const calls = [...code.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)].map((match) => match[1]);
      return [...new Set([...imports, ...calls])].slice(0, 12);
    };
    const prohibitedSignals = [...new Set(cluster.flatMap((episode) => extractSignals(episode.rejectedCode)))];
    const preferredSignals = [...new Set(cluster.flatMap((episode) => extractSignals(episode.acceptedCode ?? "")))];
    const rule = representative.reviewComment.replace(/^\s*(nit|suggestion|question)\s*:\s*/i, "").trim();
    const title = rule.split(/[.!?\n]/)[0].slice(0, 80) || `${representative.intent} convention`;
    const distinctPrs = new Set(cluster.map((episode) => episode.pullRequest)).size;
    const linkage = cluster.reduce((sum, episode) => sum + ({ high: 1, medium: 0.6, unknown: 0.2 }[episode.acceptedFixQuality]), 0) / cluster.length;
    const confidence = Math.min(0.98, 0.35 + Math.log2(distinctPrs + 1) * 0.16 + linkage * 0.25);
    const id = createHash("sha256").update(`${representative.repository}:${representative.intent}:${title.toLowerCase()}`).digest("hex").slice(0, 16);
    return {
      id,
      repository: representative.repository,
      title,
      rule,
      rationale: `Observed in ${distinctPrs} pull request${distinctPrs === 1 ? "" : "s"}; ${cluster.filter((e) => e.acceptedCode).length} include an accepted replacement.`,
      category: representative.intent,
      pathScopes,
      languages,
      prohibitedSignals,
      preferredSignals,
      confidence: Number(confidence.toFixed(3)),
      supportingEpisodes: cluster.map((episode) => episode.id),
      evidence: cluster.slice(0, 5).map((episode) => ({
        episodeId: episode.id,
        pullRequest: episode.pullRequest,
        reviewer: episode.reviewer,
        filePath: episode.filePath,
        reviewComment: episode.reviewComment,
        rejectedCode: episode.rejectedCode,
        acceptedCode: episode.acceptedCode,
      })),
    };
  }).sort((a, b) => b.confidence - a.confidence);
}
