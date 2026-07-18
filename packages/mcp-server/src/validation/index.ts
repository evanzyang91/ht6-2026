import type { Convention } from "@ht6/shared";
import { parseAddedLines } from "./parseDiff.js";
import { detectImportsAndCalls } from "./detectImportsCalls.js";
import { matchesPathScope } from "./matchPathScope.js";
import { matchesProhibitedSignal } from "./matchProhibitedSignal.js";

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
  const addedLines = parseAddedLines(diff);
  const paths = [...new Set(addedLines.map((line) => line.filePath))];
  const findings: PredictedFeedback[] = [];
  for (const convention of conventions) {
    if (!convention.prohibitedSignals.length) continue;
    for (const path of paths.filter((filePath) => matchesPathScope(convention, filePath))) {
      const lines = addedLines.filter((line) => line.filePath === path);
      const signals = detectImportsAndCalls(lines);
      if (!matchesProhibitedSignal(convention, signals)) continue;
      const matched = convention.prohibitedSignals.filter((prohibited) =>
        signals.some((signal) => signal.toLowerCase().includes(prohibited.toLowerCase()))
      );
      findings.push({
        rule: convention.rule,
        confidence: convention.confidence,
        matchedPath: path,
        reason: `Added code matches historically rejected signal${matched.length === 1 ? "" : "s"}: ${matched.join(", ")}.`,
        supportingPRs: [...new Set(convention.evidence.map((item) => item.pullRequest))],
        acceptedExamples: convention.evidence.flatMap((item) => item.acceptedCode ? [item.acceptedCode] : []).slice(0, 3),
      });
    }
  }
  return findings.sort((a, b) => b.confidence - a.confidence);
}
