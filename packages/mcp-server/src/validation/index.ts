import type { Convention } from "@ht6/shared";

export interface PredictedFeedback {
  rule: string;
  confidence: number;
  matchedPath: string;
  reason: string;
  supportingPRs: number[];
  acceptedExamples: string[];
}

// Orchestrates parseDiff -> detectImportsCalls -> matchPathScope -> matchProhibitedSignal
// -> (optional) llmFallback. Backs the predict_review_feedback MCP tool.
export async function validateAgainstDiff(
  conventions: Convention[],
  diff: string
): Promise<PredictedFeedback[]> {
  throw new Error("not implemented");
}
