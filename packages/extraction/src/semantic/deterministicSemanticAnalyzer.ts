import { classifyIntent } from "../classify/classifyIntent.js";
import { extractCodeSignals } from "./codeSignals.js";
import { synthesizeContextualRule } from "./ruleSynthesis.js";
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
  const prohibitedSignals = extractCodeSignals(input.rejectedCode);
  const preferredSignals = extractCodeSignals(input.acceptedCode ?? "");
  const intent = classifyIntent(comment);
  const rule = synthesizeContextualRule(input);
  const rationale = input.acceptedCode
    ? "The accepted implementation replaced the reviewed pattern with the preferred pattern."
    : "Derived from the review comment and the code it was attached to; no accepted replacement was available.";
  const detection = intent === "question-nonactionable" || !prohibitedSignals.length
    ? {
      mode: "semantic" as const,
      semanticDescription: rule,
      triggerSignals: [],
      forbiddenSignals: [],
      requiredSignals: [],
      matchScope: "line" as const,
    }
    : {
      mode: "forbidden-signal" as const,
      semanticDescription: rule,
      triggerSignals: [],
      forbiddenSignals: prohibitedSignals,
      requiredSignals: [],
      matchScope: "line" as const,
    };

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
  readonly version = "1";

  async analyze(input: SemanticInput): Promise<SemanticAnalysis> {
    return analyzeDeterministically(input);
  }
}
