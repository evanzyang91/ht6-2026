import type { CommentIntent } from "@ht6/shared";

// TODO: classify a review comment's intent. Likely a keyword/heuristic pass first,
// optionally an LLM classifier for ambiguous cases.
export function classifyIntent(commentBody: string): CommentIntent {
  throw new Error("not implemented");
}
