import type { CommentIntent, ConventionDetection, ReviewCodeContext, ReviewEpisode } from "@ht6/shared";

/** Factual evidence presented to a semantic processor. */
export interface SemanticInput {
  repository: string;
  pullRequest: number;
  filePath: string;
  reviewComment: string;
  rejectedCode: string;
  acceptedCode?: string;
  codeContext?: ReviewCodeContext;
}

/** Normalized meaning used to cluster episodes and compile conventions. */
export interface SemanticAnalysis {
  intent: CommentIntent;
  title: string;
  rule: string;
  rationale: string;
  prohibitedSignals: string[];
  preferredSignals: string[];
  detection?: ConventionDetection;
}

/**
 * Provider-neutral boundary for deterministic, hosted-LLM, and post-trained analyzers.
 * Implementations must only interpret the supplied evidence; they must not perform I/O
 * to discover commits or manufacture accepted code.
 */
export interface SemanticAnalyzer {
  readonly provider: string;
  readonly version: string;
  analyze(input: SemanticInput): Promise<SemanticAnalysis>;
}

export interface AnalyzedReviewEpisode {
  episode: ReviewEpisode;
  semantics: SemanticAnalysis;
}

export function semanticInputFromEpisode(episode: ReviewEpisode): SemanticInput {
  return {
    repository: episode.repository,
    pullRequest: episode.pullRequest,
    filePath: episode.filePath,
    reviewComment: episode.reviewComment,
    rejectedCode: episode.rejectedCode,
    acceptedCode: episode.acceptedCode,
    codeContext: episode.codeContext,
  };
}
