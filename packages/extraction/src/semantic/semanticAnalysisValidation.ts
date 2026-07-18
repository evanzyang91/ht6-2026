import type { CommentIntent, ConventionDetection } from "@ht6/shared";
import type { SemanticAnalysis, SemanticInput } from "./types.js";

const TOP_LEVEL_KEYS = [
  "intent", "title", "rule", "rationale", "prohibitedSignals", "preferredSignals", "detection",
] as const;
const DETECTION_KEYS = [
  "mode", "semanticDescription", "triggerSignals", "forbiddenSignals", "requiredSignals", "matchScope",
] as const;
const INTENTS = new Set<CommentIntent>([
  "actionable-change", "architecture", "testing", "security", "style", "question-nonactionable",
]);
const MODES = new Set(["forbidden-signal", "missing-required-signal", "semantic"]);

export class SemanticAnalysisValidationError extends Error {
  constructor(message: string) {
    super(`Invalid semantic analysis: ${message}`);
    this.name = "SemanticAnalysisValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new SemanticAnalysisValidationError(`${label} keys must be exactly ${wanted.join(", ")}`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SemanticAnalysisValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new SemanticAnalysisValidationError(`${label} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function evidenceText(input: SemanticInput, kind: "reviewed" | "accepted"): string {
  return kind === "reviewed"
    ? [input.rejectedCode, input.codeContext?.reviewedContext].filter(Boolean).join("\n")
    : [input.acceptedCode, input.codeContext?.acceptedContext].filter(Boolean).join("\n");
}

function assertSignalsGrounded(signals: string[], evidence: string, label: string): void {
  for (const signal of signals) {
    if (!evidence.includes(signal)) {
      throw new SemanticAnalysisValidationError(`${label} contains a signal absent from supplied code: ${JSON.stringify(signal)}`);
    }
  }
}

function parseDetection(value: unknown): ConventionDetection {
  if (!isRecord(value)) throw new SemanticAnalysisValidationError("detection must be an object");
  assertExactKeys(value, DETECTION_KEYS, "detection");
  const mode = requiredString(value.mode, "detection.mode");
  if (!MODES.has(mode)) throw new SemanticAnalysisValidationError(`unsupported detection.mode ${JSON.stringify(mode)}`);
  const matchScope = requiredString(value.matchScope, "detection.matchScope");
  if (matchScope !== "line" && matchScope !== "file") {
    throw new SemanticAnalysisValidationError("detection.matchScope must be line or file");
  }
  return {
    mode: mode as ConventionDetection["mode"],
    semanticDescription: requiredString(value.semanticDescription, "detection.semanticDescription"),
    triggerSignals: stringArray(value.triggerSignals, "detection.triggerSignals"),
    forbiddenSignals: stringArray(value.forbiddenSignals, "detection.forbiddenSignals"),
    requiredSignals: stringArray(value.requiredSignals, "detection.requiredSignals"),
    matchScope,
  };
}

/** Parses and grounds the model response before it can enter persistent engineering memory. */
export function parseSemanticAnalysis(responseText: string, input: SemanticInput): SemanticAnalysis {
  const text = responseText.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    throw new SemanticAnalysisValidationError("response must be raw JSON without Markdown or commentary");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SemanticAnalysisValidationError("response is not valid JSON");
  }
  if (!isRecord(parsed)) throw new SemanticAnalysisValidationError("response must be an object");
  assertExactKeys(parsed, TOP_LEVEL_KEYS, "top-level");

  const intent = requiredString(parsed.intent, "intent");
  if (!INTENTS.has(intent as CommentIntent)) {
    throw new SemanticAnalysisValidationError(`unsupported intent ${JSON.stringify(intent)}`);
  }
  const prohibitedSignals = stringArray(parsed.prohibitedSignals, "prohibitedSignals");
  const preferredSignals = stringArray(parsed.preferredSignals, "preferredSignals");
  const detection = parseDetection(parsed.detection);

  if (detection.mode === "forbidden-signal") {
    if (!detection.forbiddenSignals.length || detection.requiredSignals.length) {
      throw new SemanticAnalysisValidationError("forbidden-signal requires forbiddenSignals and forbids requiredSignals");
    }
  } else if (detection.mode === "missing-required-signal") {
    if (!detection.triggerSignals.length || !detection.requiredSignals.length || detection.forbiddenSignals.length) {
      throw new SemanticAnalysisValidationError("missing-required-signal requires triggerSignals and requiredSignals only");
    }
    if (prohibitedSignals.length || !sameMembers(preferredSignals, detection.requiredSignals)) {
      throw new SemanticAnalysisValidationError("missing-required-signal requires empty prohibitedSignals and preferredSignals equal to requiredSignals");
    }
  } else if (
    detection.triggerSignals.length || detection.forbiddenSignals.length || detection.requiredSignals.length
  ) {
    throw new SemanticAnalysisValidationError("semantic detection cannot contain executable detection signals");
  }

  if (intent === "question-nonactionable" && (
    detection.mode !== "semantic" || prohibitedSignals.length || preferredSignals.length
  )) {
    throw new SemanticAnalysisValidationError("question-nonactionable must be semantic and cannot contain preferred or prohibited signals");
  }

  const reviewedEvidence = evidenceText(input, "reviewed");
  const acceptedEvidence = evidenceText(input, "accepted");
  assertSignalsGrounded(prohibitedSignals, reviewedEvidence, "prohibitedSignals");
  assertSignalsGrounded(detection.triggerSignals, reviewedEvidence, "detection.triggerSignals");
  assertSignalsGrounded(detection.forbiddenSignals, reviewedEvidence, "detection.forbiddenSignals");
  if (preferredSignals.length || detection.requiredSignals.length) {
    if (!acceptedEvidence) {
      throw new SemanticAnalysisValidationError("preferred or required signals need accepted code evidence");
    }
    assertSignalsGrounded(preferredSignals, acceptedEvidence, "preferredSignals");
    assertSignalsGrounded(detection.requiredSignals, acceptedEvidence, "detection.requiredSignals");
  }

  return {
    intent: intent as CommentIntent,
    title: requiredString(parsed.title, "title"),
    rule: requiredString(parsed.rule, "rule"),
    rationale: requiredString(parsed.rationale, "rationale"),
    prohibitedSignals,
    preferredSignals,
    detection,
  };
}
