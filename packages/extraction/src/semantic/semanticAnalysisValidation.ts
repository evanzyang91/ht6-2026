import type { CommentIntent, ConventionDetection } from "@ht6/shared";
import type { SemanticAnalysis, SemanticInput } from "./types.js";

const LEGACY_TOP_LEVEL_KEYS = [
  "intent", "title", "rule", "rationale", "prohibitedSignals", "preferredSignals", "detection",
] as const;
const TOP_LEVEL_KEYS = ["intent", "title", "rule", "rationale", "detection"] as const;
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

function signalsGrounded(signals: string[], evidence: string): boolean {
  return signals.every((signal) => evidence.includes(signal));
}

function detectionViolates(detection: ConventionDetection, code: string): boolean {
  const contextMatches = detection.triggerSignals.length === 0
    || detection.triggerSignals.some((signal) => code.includes(signal));
  if (!contextMatches) return false;
  if (detection.mode === "forbidden-signal") {
    return detection.forbiddenSignals.some((signal) => code.includes(signal));
  }
  if (detection.mode === "missing-required-signal") {
    return detection.requiredSignals.length > 0
      && !detection.requiredSignals.some((signal) => code.includes(signal));
  }
  return false;
}

function parseDetection(value: unknown): ConventionDetection {
  if (!isRecord(value)) throw new SemanticAnalysisValidationError("detection must be an object");
  assertExactKeys(value, DETECTION_KEYS, "detection");
  const semanticDescription = requiredString(value.semanticDescription, "detection.semanticDescription");
  const matchScope = requiredString(value.matchScope, "detection.matchScope");
  if (matchScope !== "line" && matchScope !== "file") {
    throw new SemanticAnalysisValidationError("detection.matchScope must be line or file");
  }
  const mode = requiredString(value.mode, "detection.mode");
  if (!MODES.has(mode)) {
    return {
      mode: "semantic",
      semanticDescription,
      triggerSignals: [],
      forbiddenSignals: [],
      requiredSignals: [],
      matchScope,
    };
  }
  let triggerSignals: string[];
  let forbiddenSignals: string[];
  let requiredSignals: string[];
  try {
    triggerSignals = stringArray(value.triggerSignals, "detection.triggerSignals");
    forbiddenSignals = stringArray(value.forbiddenSignals, "detection.forbiddenSignals");
    requiredSignals = stringArray(value.requiredSignals, "detection.requiredSignals");
  } catch (error) {
    if (!(error instanceof SemanticAnalysisValidationError)) throw error;
    return {
      mode: "semantic",
      semanticDescription,
      triggerSignals: [],
      forbiddenSignals: [],
      requiredSignals: [],
      matchScope,
    };
  }
  return {
    mode: mode as ConventionDetection["mode"],
    semanticDescription,
    triggerSignals,
    forbiddenSignals,
    requiredSignals,
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
  const keys = Object.keys(parsed).sort();
  const v2Keys = [...TOP_LEVEL_KEYS].sort();
  const legacyKeys = [...LEGACY_TOP_LEVEL_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(v2Keys) && JSON.stringify(keys) !== JSON.stringify(legacyKeys)) {
    throw new SemanticAnalysisValidationError(`top-level keys must be exactly ${v2Keys.join(", ")}`);
  }

  const intent = requiredString(parsed.intent, "intent");
  if (!INTENTS.has(intent as CommentIntent)) {
    throw new SemanticAnalysisValidationError(`unsupported intent ${JSON.stringify(intent)}`);
  }
  let detection = parseDetection(parsed.detection);
  const reviewedEvidence = evidenceText(input, "reviewed");
  const acceptedEvidence = evidenceText(input, "accepted");

  const coherent = detection.mode === "forbidden-signal"
    ? detection.forbiddenSignals.length > 0 && detection.requiredSignals.length === 0
    : detection.mode === "missing-required-signal"
      ? detection.triggerSignals.length > 0 && detection.requiredSignals.length > 0
        && detection.forbiddenSignals.length === 0 && Boolean(acceptedEvidence)
      : detection.triggerSignals.length === 0 && detection.forbiddenSignals.length === 0
        && detection.requiredSignals.length === 0;
  const grounded = signalsGrounded(detection.triggerSignals, reviewedEvidence)
    && signalsGrounded(detection.forbiddenSignals, reviewedEvidence)
    && signalsGrounded(detection.requiredSignals, acceptedEvidence);
  const behaviorallySafe = detection.mode === "semantic"
    || (detectionViolates(detection, input.rejectedCode)
      && (!input.acceptedCode || !detectionViolates(detection, input.acceptedCode)));

  // Preserve useful semantic meaning while preventing malformed or invented executable signals
  // from entering memory. Legacy top-level signal fields are deliberately ignored and derived.
  if (!coherent || !grounded || !behaviorallySafe || intent === "question-nonactionable") {
    detection = {
      mode: "semantic",
      semanticDescription: detection.semanticDescription,
      triggerSignals: [],
      forbiddenSignals: [],
      requiredSignals: [],
      matchScope: detection.matchScope,
    };
  }

  const prohibitedSignals = detection.mode === "forbidden-signal" ? detection.forbiddenSignals : [];
  const preferredSignals = detection.mode === "missing-required-signal" ? detection.requiredSignals : [];

  // Defense in depth after canonicalization.
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
