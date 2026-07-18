import type { Convention, ConventionDetection } from "@ht6/shared";
import { detectImportsAndCalls } from "./detectImportsCalls.js";
import type { AddedLine } from "./parseDiff.js";

export interface ConventionDetectionMatch {
  lineNumber?: number;
  matchedSignals: string[];
  missingSignals: string[];
}

export function normalizedDetection(convention: Convention): ConventionDetection {
  return convention.detection ?? {
    mode: convention.prohibitedSignals.length ? "forbidden-signal" : "semantic",
    semanticDescription: convention.rule,
    triggerSignals: [],
    forbiddenSignals: convention.prohibitedSignals,
    requiredSignals: [],
    matchScope: "file",
  };
}

function matchingNeedles(needles: string[], signals: string[]): string[] {
  return needles.filter((needle) => {
    const normalized = needle.trim().toLowerCase();
    return normalized.length >= 2 && signals.some((signal) => signal.toLowerCase().includes(normalized));
  });
}

function matchCandidate(
  detection: ConventionDetection,
  signals: string[],
  lineNumber?: number,
): ConventionDetectionMatch | undefined {
  const triggers = matchingNeedles(detection.triggerSignals, signals);
  const contextMatches = detection.triggerSignals.length === 0 || triggers.length > 0;
  if (!contextMatches) return undefined;

  if (detection.mode === "forbidden-signal") {
    const forbidden = matchingNeedles(detection.forbiddenSignals, signals);
    if (!forbidden.length) return undefined;
    return { lineNumber, matchedSignals: [...triggers, ...forbidden], missingSignals: [] };
  }

  if (detection.mode === "missing-required-signal") {
    if (!detection.triggerSignals.length || !detection.requiredSignals.length) return undefined;
    const presentRequired = matchingNeedles(detection.requiredSignals, signals);
    if (presentRequired.length) return undefined;
    return { lineNumber, matchedSignals: triggers, missingSignals: detection.requiredSignals };
  }

  return undefined;
}

/** Evaluates deterministic context against only the lines added by the proposed diff. */
export function matchConventionDetection(
  convention: Convention,
  addedLines: AddedLine[],
): ConventionDetectionMatch | undefined {
  const detection = normalizedDetection(convention);
  if (detection.mode === "semantic") return undefined;
  if (detection.matchScope === "file") {
    return matchCandidate(detection, detectImportsAndCalls(addedLines), addedLines[0]?.lineNumber);
  }
  for (const line of addedLines) {
    const match = matchCandidate(detection, detectImportsAndCalls([line]), line.lineNumber);
    if (match) return match;
  }
  return undefined;
}
