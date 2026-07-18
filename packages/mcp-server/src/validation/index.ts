import type { Convention } from "@ht6/shared";
import { parseAddedLines } from "./parseDiff.js";
import { detectImportsAndCalls } from "./detectImportsCalls.js";
import { matchesPathScope } from "./matchPathScope.js";
import { matchesProhibitedSignal } from "./matchProhibitedSignal.js";
import { matchesLanguageScope } from "./matchLanguageScope.js";

export interface PredictedFeedback {
  conventionId: string;
  rule: string;
  confidence: number;
  supportCount: number;
  matchedPath: string;
  matchedLine?: number;
  matchedSignal?: string;
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
    if (!convention.prohibitedSignals.length) {
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
        reason: "The optional semantic validator identified a likely convention violation.",
        supportingPRs: [...new Set(convention.evidence.map((item) => item.pullRequest))],
        acceptedExamples: convention.evidence.flatMap((item) => item.acceptedCode ? [item.acceptedCode] : []).slice(0, 3),
      });
      continue;
    }
    for (const path of paths.filter((filePath) => matchesPathScope(convention, filePath) && matchesLanguageScope(convention, filePath))) {
      const lines = addedLines.filter((line) => line.filePath === path);
      const signals = detectImportsAndCalls(lines);
      if (!matchesProhibitedSignal(convention, signals)) continue;
      const matched = convention.prohibitedSignals.filter((prohibited) =>
        signals.some((signal) => signal.toLowerCase().includes(prohibited.toLowerCase()))
      );
      const matchedAddition = lines.find((line) => matched.some((signal) => line.line.toLowerCase().includes(signal.toLowerCase())));
      findings.push({
        conventionId: convention.id,
        rule: convention.rule,
        confidence: convention.confidence,
        supportCount: new Set(convention.evidence.map((item) => item.pullRequest)).size,
        matchedPath: path,
        matchedLine: matchedAddition?.lineNumber,
        matchedSignal: matched[0],
        reason: `Added code matches historically rejected signal${matched.length === 1 ? "" : "s"}: ${matched.join(", ")}.`,
        supportingPRs: [...new Set(convention.evidence.map((item) => item.pullRequest))],
        acceptedExamples: convention.evidence.flatMap((item) => item.acceptedCode ? [item.acceptedCode] : []).slice(0, 3),
      });
    }
  }
  return findings.sort((a, b) => b.confidence - a.confidence);
}
