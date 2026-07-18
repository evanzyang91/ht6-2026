import { createHash } from "node:crypto";
import type { Convention, ConventionDetection, ReviewEpisode } from "@ht6/shared";
import { clusterEpisodes } from "./clustering/clusterConventions.js";
import { inferScope } from "./clustering/scopeInference.js";
import { extractCodeSignals } from "./semantic/codeSignals.js";
import { analyzeDeterministically } from "./semantic/deterministicSemanticAnalyzer.js";
import { semanticInputFromEpisode, type AnalyzedReviewEpisode, type SemanticAnalysis } from "./semantic/types.js";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function episodeSemantics(episode: ReviewEpisode): SemanticAnalysis {
  const persisted = episode.semanticAnalysis;
  if (persisted) {
    return {
      intent: persisted.intent,
      title: persisted.title,
      rule: persisted.rule,
      rationale: persisted.rationale,
      prohibitedSignals: persisted.prohibitedSignals,
      preferredSignals: persisted.preferredSignals,
      detection: persisted.detection,
    };
  }
  return analyzeDeterministically(semanticInputFromEpisode(episode));
}

function compileConventions(
  episodes: ReviewEpisode[],
  semantics: ReadonlyMap<string, SemanticAnalysis>
): Convention[] {
  return clusterEpisodes(episodes, semantics).map((cluster) => {
    const representative = [...cluster].sort((left, right) => {
      const leftRule = semantics.get(left.id)?.rule ?? left.reviewComment;
      const rightRule = semantics.get(right.id)?.rule ?? right.reviewComment;
      return rightRule.length - leftRule.length;
    })[0];
    const representativeSemantics = semantics.get(representative.id) ?? episodeSemantics(representative);
    const { pathScopes, languages } = inferScope(cluster);
    const explicitDetections = cluster.flatMap((episode) => {
      const detection = semantics.get(episode.id)?.detection;
      return detection ? [detection] : [];
    });
    const legacyProhibitedSignals = unique(cluster.flatMap(
      (episode) => [
        ...(semantics.get(episode.id)?.prohibitedSignals ?? []),
        ...extractCodeSignals(episode.rejectedCode),
      ]
    ));
    const legacyPreferredSignals = unique(cluster.flatMap(
      (episode) => [
        ...(semantics.get(episode.id)?.preferredSignals ?? []),
        ...extractCodeSignals(episode.acceptedCode ?? ""),
      ]
    ));
    const representativeDetection = representativeSemantics.detection;
    const compatibleDetections = representativeDetection
      ? explicitDetections.filter((item) => item.mode === representativeDetection.mode && item.matchScope === representativeDetection.matchScope)
      : [];
    const detection: ConventionDetection = representativeDetection
      ? {
        mode: representativeDetection.mode,
        semanticDescription: representativeDetection.semanticDescription || representativeSemantics.rule,
        triggerSignals: unique(compatibleDetections.flatMap((item) => item.triggerSignals)),
        forbiddenSignals: unique(compatibleDetections.flatMap((item) => item.forbiddenSignals)),
        requiredSignals: unique(compatibleDetections.flatMap((item) => item.requiredSignals)),
        matchScope: representativeDetection.matchScope,
      }
      : {
        mode: legacyProhibitedSignals.length ? "forbidden-signal" : "semantic",
        semanticDescription: representativeSemantics.rule,
        triggerSignals: [],
        forbiddenSignals: legacyProhibitedSignals,
        requiredSignals: [],
        matchScope: "file",
      };
    const prohibitedSignals = explicitDetections.length ? detection.forbiddenSignals : legacyProhibitedSignals;
    const preferredSignals = explicitDetections.length
      ? unique([...detection.requiredSignals, ...cluster.flatMap((episode) => semantics.get(episode.id)?.preferredSignals ?? [])])
      : legacyPreferredSignals;
    const distinctPrs = new Set(cluster.map((episode) => episode.pullRequest)).size;
    const acceptedCount = cluster.filter((episode) => episode.acceptedCode).length;
    const linkage = cluster.reduce(
      (sum, episode) => sum + ({ high: 1, medium: 0.6, unknown: 0.2 }[episode.acceptedFixQuality]),
      0
    ) / cluster.length;
    const confidence = Math.min(
      0.98,
      0.35 + Math.log2(distinctPrs + 1) * 0.16 + linkage * 0.25
    );
    const id = createHash("sha256")
      .update(`${representative.repository}:${representative.intent}:${representativeSemantics.rule.toLowerCase()}`)
      .digest("hex")
      .slice(0, 16);

    return {
      id,
      repository: representative.repository,
      title: representativeSemantics.title,
      rule: representativeSemantics.rule,
      rationale: `${representativeSemantics.rationale} Observed in ${distinctPrs} pull request${distinctPrs === 1 ? "" : "s"}; ${acceptedCount} include an accepted replacement.`,
      category: representativeSemantics.intent,
      pathScopes,
      languages,
      prohibitedSignals,
      preferredSignals,
      detection,
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
  }).sort((left, right) => right.confidence - left.confidence);
}

/** Backward-compatible deterministic convention compiler. */
export function buildConventions(episodes: ReviewEpisode[]): Convention[] {
  const semantics = new Map(
    episodes.map((episode) => [
      episode.id,
      episodeSemantics(episode),
    ])
  );
  return compileConventions(episodes, semantics);
}

/** Analyzer-aware compiler used by the extraction pipeline. */
export function buildConventionsFromAnalyzedEpisodes(
  analyzed: AnalyzedReviewEpisode[]
): Convention[] {
  return compileConventions(
    analyzed.map(({ episode }) => episode),
    new Map(analyzed.map(({ episode, semantics }) => [episode.id, semantics]))
  );
}
