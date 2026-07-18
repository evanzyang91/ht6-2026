import type { ConventionDetection } from "@ht6/shared";
import type { ConventionStore } from "../store/conventionStore.js";
import { retrieveConventions, type RetrievalQuery } from "../retrieval/index.js";

export interface RepoConventionResult {
  id: string;
  title: string;
  rule: string;
  rationale: string;
  category: string;
  confidence: number;
  scope: { paths: string[]; languages: string[] };
  supportCount: number;
  supportingPRs: number[];
  prohibitedSignals: string[];
  preferredSignals: string[];
  detection?: ConventionDetection;
  acceptedExamples: string[];
}

export async function getRepoConventions(store: ConventionStore, input: RetrievalQuery) {
  const conventions = await retrieveConventions(store, input);
  return conventions.map((convention): RepoConventionResult => ({
    id: convention.id,
    title: convention.title,
    rule: convention.rule,
    rationale: convention.rationale,
    category: convention.category,
    confidence: convention.confidence,
    scope: { paths: convention.pathScopes, languages: convention.languages },
    supportCount: convention.supportingEpisodes.length,
    supportingPRs: [...new Set(convention.evidence.map((evidence) => evidence.pullRequest))],
    prohibitedSignals: convention.prohibitedSignals,
    preferredSignals: convention.preferredSignals,
    detection: convention.detection,
    acceptedExamples: convention.evidence.flatMap((evidence) => evidence.acceptedCode ? [evidence.acceptedCode] : []).slice(0, 3),
  }));
}
