import { classifyIntent } from "../classify/classifyIntent.js";
import { extractCodeSignals } from "./codeSignals.js";
import type { SemanticAnalysis, SemanticAnalyzer, SemanticInput } from "./types.js";

const CONTEXT_DEPENDENT_COMMENT = /^(fix\s+(this|it)|same\s+as\s+(above|before)|ditto|change\s+this|nope)[.!?\s]*$/i;

function cleanComment(comment: string): string {
  return comment
    .replace(/^\s*(nit|suggestion|question|blocking|issue)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeSignal(signal: string): string {
  return signal.replace(/[_$]/g, " ");
}

function deriveRule(
  comment: string,
  prohibitedSignals: string[],
  preferredSignals: string[],
  filePath: string
): string {
  if (comment && !CONTEXT_DEPENDENT_COMMENT.test(comment)) return comment;

  const prohibited = prohibitedSignals[0];
  const preferred = preferredSignals[0];
  if (prohibited && preferred) {
    return `Prefer ${humanizeSignal(preferred)} over ${humanizeSignal(prohibited)} in ${filePath}.`;
  }
  if (prohibited) return `Avoid ${humanizeSignal(prohibited)} in ${filePath}.`;
  return `Review the implementation pattern used in ${filePath}.`;
}

function deriveTitle(rule: string, intent: string): string {
  const firstSentence = rule.split(/[.!?\n]/)[0]?.trim();
  return (firstSentence || `${intent} convention`).slice(0, 80);
}

/** Synchronous core retained so the existing buildConventions API remains deterministic. */
export function analyzeDeterministically(input: SemanticInput): SemanticAnalysis {
  const comment = cleanComment(input.reviewComment);
  const prohibitedSignals = extractCodeSignals(input.rejectedCode);
  const preferredSignals = extractCodeSignals(input.acceptedCode ?? "");
  const intent = classifyIntent(comment);
  const rule = deriveRule(comment, prohibitedSignals, preferredSignals, input.filePath);
  const rationale = input.acceptedCode
    ? "The accepted implementation replaced the reviewed pattern with the preferred pattern."
    : "Derived from the review comment and the code it was attached to; no accepted replacement was available.";

  return {
    intent,
    title: deriveTitle(rule, intent),
    rule,
    rationale,
    prohibitedSignals,
    preferredSignals,
  };
}

export class DeterministicSemanticAnalyzer implements SemanticAnalyzer {
  readonly provider = "deterministic";
  readonly version = "1";

  async analyze(input: SemanticInput): Promise<SemanticAnalysis> {
    return analyzeDeterministically(input);
  }
}

