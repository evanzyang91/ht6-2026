import type { CommentIntent, LinkageQuality } from "./enums.js";

export interface ReviewEpisodeSemanticAnalysis {
  provider: string;
  version: string;
  intent: CommentIntent;
  title: string;
  rule: string;
  rationale: string;
  prohibitedSignals: string[];
  preferredSignals: string[];
}

// Stage 2 (extraction) intermediate output. A RawReviewComment linked to the code it was left
// on and (if found) the code that replaced it. Persisted to data/episodes.json.
export interface ReviewEpisode {
  id: string;
  repository: string;
  pullRequest: number;
  reviewer: string;
  filePath: string;
  reviewComment: string;
  rejectedCode: string;
  acceptedCode?: string;
  acceptedFixQuality: LinkageQuality;
  intent: CommentIntent;
  /** Persisted analyzer output so convention compilation is reproducible and auditable. */
  semanticAnalysis: ReviewEpisodeSemanticAnalysis;
  createdAt: string;
}
