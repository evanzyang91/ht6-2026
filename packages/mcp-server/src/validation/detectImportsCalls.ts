import type { AddedLine } from "./parseDiff.js";

// TODO: detect import statements and function/method calls present in added lines,
// used to match against Convention.prohibitedSignals / preferredSignals.
export function detectImportsAndCalls(addedLines: AddedLine[]): string[] {
  throw new Error("not implemented");
}
