import type { AddedLine } from "./parseDiff.js";

// Detects imports, calls, and full-line signals from additions.
export function detectImportsAndCalls(addedLines: AddedLine[]): string[] {
  const signals = new Set<string>();
  for (const { line } of addedLines) {
    for (const match of line.matchAll(/(?:from\s+|require\s*\(\s*['"])([@\w./-]+)/g)) signals.add(match[1]);
    for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) signals.add(match[1]);
    for (const match of line.matchAll(/\b(import|use)\s+([@\w./-]+)/g)) signals.add(match[2]);
    signals.add(line.trim());
  }
  return [...signals].filter(Boolean);
}
