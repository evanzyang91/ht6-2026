import type { ConventionDetection } from "./convention.js";
import type { CommentIntent, LinkageQuality } from "./enums.js";

export type ReviewSymbolKind = "function" | "method" | "class" | "component" | "module" | "unknown";

/** Bounded historical source context surrounding an inline review comment. */
export interface ReviewCodeContext {
  source: "historical-file" | "diff-hunk";
  language: string;
  commentLine?: number;
  enclosingSymbol?: {
    name?: string;
    kind: ReviewSymbolKind;
    startLine: number;
    endLine: number;
  };
  imports: string[];
  reviewedContext: string;
  acceptedContext?: string;
  truncated: boolean;
}

export interface ReviewEpisodeSemanticAnalysis {
  provider: string;
  version: string;
  intent: CommentIntent;
  title: string;
  rule: string;
  rationale: string;
  prohibitedSignals: string[];
  preferredSignals: string[];
  detection?: ConventionDetection;
}

// Stage 2 (extraction) intermediate output. A RawReviewComment linked to the code it was left
// on and (if found) the code that replaced it. Persisted to data/episodes.json.
export interface ReviewEpisode {
  id: string;
  repository: string;
  pullRequest: number;
  reviewer: string;
  /** Absent for episodes built from a PR-level comment (review-summary/conversation) — no file to anchor to. */
  filePath?: string;
  reviewComment: string;
  /** Absent for episodes built from a PR-level comment — there's no diff hunk to link a rejected code snippet from. */
  rejectedCode?: string;
  acceptedCode?: string;
  codeContext?: ReviewCodeContext;
  acceptedFixQuality: LinkageQuality;
  intent: CommentIntent;
  /** Persisted analyzer output so convention compilation is reproducible and auditable. */
  semanticAnalysis: ReviewEpisodeSemanticAnalysis;
  createdAt: string;
}
