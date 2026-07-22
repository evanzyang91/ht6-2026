import { classifyIntent } from "../classify/classifyIntent.js";
import { extractCodeSignals } from "./codeSignals.js";
import { synthesizeContextualRule } from "./ruleSynthesis.js";
import { deriveDeterministicDetection } from "./semanticAnalysisValidation.js";
import type { SemanticAnalysis, SemanticAnalyzer, SemanticInput } from "./types.js";

function cleanComment(comment: string): string {
  return comment
    .replace(/^\s*(nit|suggestion|question|blocking|issue)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveTitle(rule: string, intent: string): string {
  const firstSentence = rule.split(/[.!?\n]/)[0]?.trim();
  return (firstSentence || `${intent} convention`).slice(0, 80);
}

/** Synchronous core retained so the existing buildConventions API remains deterministic. */
export function analyzeDeterministically(input: SemanticInput): SemanticAnalysis {
  const comment = cleanComment(input.reviewComment);
  const intent = classifyIntent(comment);
  const rule = synthesizeContextualRule(input);
  const rationale = input.acceptedCode
    ? "The accepted implementation replaced the reviewed pattern with the preferred pattern."
    : "Derived from the review comment and the code it was attached to; no accepted replacement was available.";
  // deriveDeterministicDetection is the single source of truth for what predict_review_feedback
  // actually checks (forbidden-signal when something was removed, missing-required-signal when
  // something was added with nothing removed, semantic otherwise) — reused here rather than
  // duplicated, so this path and the LLM-fallback grounding-failure path can never diverge.
  const detection = intent === "question-nonactionable"
    ? {
      mode: "semantic" as const,
      semanticDescription: rule,
      triggerSignals: [],
      forbiddenSignals: [],
      requiredSignals: [],
      matchScope: "line" as const,
    }
    : deriveDeterministicDetection(input, rule, "line");
  // prohibitedSignals/preferredSignals are the general removed/added delta between rejected and
  // accepted code — informational (shown by MCP tools regardless of which detection.mode won,
  // e.g. still useful context on a forbidden-signal convention), independent of what
  // predict_review_feedback actively matches against via detection itself.
  const rejectedSignals = extractCodeSignals(input.rejectedCode ?? "");
  const acceptedSignals = extractCodeSignals(input.acceptedCode ?? "");
  const prohibitedSignals = rejectedSignals.filter((signal) => !acceptedSignals.includes(signal));
  const preferredSignals = acceptedSignals.filter((signal) => !rejectedSignals.includes(signal));

  return {
    intent,
    title: deriveTitle(rule, intent),
    rule,
    rationale,
    prohibitedSignals,
    preferredSignals,
    detection,
  };
}

export class DeterministicSemanticAnalyzer implements SemanticAnalyzer {
  readonly provider = "deterministic";
  // Bump whenever analyzeDeterministically's output changes for the same input — the publisher's
  // run-reuse fingerprint keys on this string, so an unbumped version silently reuses a stale
  // published run instead of re-extracting, even though the code that computes signals changed.
  readonly version = "3";

  async analyze(input: SemanticInput): Promise<SemanticAnalysis> {
    return analyzeDeterministically(input);
  }
}
