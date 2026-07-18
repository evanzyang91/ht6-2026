// MCP tool: predict_review_feedback
// Input: { repository: string, diff: string }
// Output: PredictedFeedback[] (see validation/index.ts) — compact, evidence-backed findings
// like { rule, confidence, matchedPath, reason, supportingPRs, acceptedExamples }.
//
// TODO: define the MCP tool schema and handler, delegating to validateAgainstDiff().

export const predictReviewFeedbackTool = {
  name: "predict_review_feedback",
  // TODO: inputSchema, handler
};
