import type { Convention } from "@ht6/shared";
import { parseAddedLines } from "./parseDiff.js";
import { matchesPathScope } from "./matchPathScope.js";
import { matchesLanguageScope } from "./matchLanguageScope.js";
import { matchConventionDetection, normalizedDetection } from "./matchConventionDetection.js";

export interface PredictedFeedback {
  conventionId: string;
  rule: string;
  confidence: number;
  supportCount: number;
  matchedPath: string;
  matchedLine?: number;
  matchedSignal?: string;
  detectionMode?: "forbidden-signal" | "missing-required-signal" | "semantic";
  reason: string;
  supportingPRs: number[];
  acceptedExamples: string[];
}

export interface ValidationOptions {
  llmFallback?: (convention: Convention, diff: string) => Promise<boolean>;
}

// Orchestrates parseDiff -> detectImportsCalls -> matchPathScope -> matchProhibitedSignal
// -> (optional) llmFallback. Backs the predict_review_feedback MCP tool.
export async function validateAgainstDiff(
  conventions: Convention[],
  diff: string,
  options: ValidationOptions = {},
): Promise<PredictedFeedback[]> {
  const addedLines = parseAddedLines(diff);
  const paths = [...new Set(addedLines.map((line) => line.filePath))];
  const findings: PredictedFeedback[] = [];
  for (const convention of conventions) {
    const detection = normalizedDetection(convention);
    if (detection.mode === "semantic") {
      if (!options.llmFallback || !await options.llmFallback(convention, diff)) continue;
      const matchedPath = paths.find((path) => matchesPathScope(convention, path) && matchesLanguageScope(convention, path));
      if (!matchedPath) continue;
      findings.push({
        conventionId: convention.id,
        rule: convention.rule,
        confidence: convention.confidence,
        supportCount: new Set(convention.evidence.map((item) => item.pullRequest)).size,
        matchedPath,
        matchedLine: addedLines.find((line) => line.filePath === matchedPath)?.lineNumber,
        detectionMode: "semantic",
        reason: `${detection.semanticDescription} The optional semantic validator identified a likely convention violation.`,
        supportingPRs: [...new Set(convention.evidence.map((item) => item.pullRequest))],
        acceptedExamples: convention.evidence.flatMap((item) => item.acceptedCode ? [item.acceptedCode] : []).slice(0, 3),
      });
      continue;
    }
    for (const path of paths.filter((filePath) => matchesPathScope(convention, filePath) && matchesLanguageScope(convention, filePath))) {
      const lines = addedLines.filter((line) => line.filePath === path);
      const match = matchConventionDetection(convention, lines);
      if (!match) continue;
      const reason = detection.mode === "missing-required-signal"
        ? `${detection.semanticDescription} Added code matches context ${match.matchedSignals.join(", ")} but is missing required signal${match.missingSignals.length === 1 ? "" : "s"}: ${match.missingSignals.join(", ")}.`
        : `${detection.semanticDescription} Added code matches a forbidden signal in context: ${match.matchedSignals.join(", ")}.`;
      findings.push({
        conventionId: convention.id,
        rule: convention.rule,
        confidence: convention.confidence,
        supportCount: new Set(convention.evidence.map((item) => item.pullRequest)).size,
        matchedPath: path,
        matchedLine: match.lineNumber,
        matchedSignal: match.matchedSignals[0],
        detectionMode: detection.mode,
        reason,
        supportingPRs: [...new Set(convention.evidence.map((item) => item.pullRequest))],
        acceptedExamples: convention.evidence.flatMap((item) => item.acceptedCode ? [item.acceptedCode] : []).slice(0, 3),
      });
    }
  }
  return findings.sort((a, b) => b.confidence - a.confidence);
}
