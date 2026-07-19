// Stage 2 (extraction) final output / stage 3 (mcp-server) input. A generalized rule inferred
// from one or more ReviewEpisodes. Persisted to data/conventions.json.
export interface ConventionEvidence {
  episodeId: string;
  pullRequest: number;
  reviewer: string;
  /** Absent for evidence derived from a PR-level comment (review-summary/conversation) with no file to anchor to. */
  filePath?: string;
  reviewComment: string;
  /** Absent for evidence derived from a PR-level comment — there's no diff hunk to link a rejected code snippet from. */
  rejectedCode?: string;
  acceptedCode?: string;
}

export type ConventionDetectionMode = "forbidden-signal" | "missing-required-signal" | "semantic";
export type ConventionSignalMatchScope = "line" | "file";

/**
 * Hybrid detection metadata. The English description explains the condition while the signal
 * fields make common cases deterministic. `triggerSignals` establish context; forbidden signals
 * are disallowed only in that context, while required signals must be present in that context.
 */
export interface ConventionDetection {
  mode: ConventionDetectionMode;
  semanticDescription: string;
  triggerSignals: string[];
  forbiddenSignals: string[];
  requiredSignals: string[];
  matchScope: ConventionSignalMatchScope;
}

export interface Convention {
  id: string;
  repository: string;
  title: string;
  rule: string;
  rationale: string;
  category: string;
  pathScopes: string[];
  languages: string[];
  prohibitedSignals: string[];
  preferredSignals: string[];
  /** Optional for backward compatibility with convention files written before contextual detection. */
  detection?: ConventionDetection;
  confidence: number;
  supportingEpisodes: string[];
  /** Embedded, compact provenance so MCP responses never need to expose raw GitHub data. */
  evidence: ConventionEvidence[];
}
