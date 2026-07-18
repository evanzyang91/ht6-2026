import type { RawReviewComment, ReviewCodeContext, ReviewSymbolKind } from "@ht6/shared";

const MAX_CONTEXT_LINES = 100;
const MAX_CONTEXT_CHARACTERS = 12_000;

interface LocatedSymbol {
  name?: string;
  kind: ReviewSymbolKind;
  start: number;
  end: number;
}

function languageFromPath(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin" } as Record<string, string>)[extension] ?? (extension || "unknown");
}

function declaration(line: string): { name?: string; kind: ReviewSymbolKind } | undefined {
  const patterns: Array<[RegExp, ReviewSymbolKind]> = [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, "function"],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, "function"],
    [/^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
    [/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/, "function"],
    [/^\s*class\s+([A-Za-z_][\w]*)\s*[:(]/, "class"],
    [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/, "function"],
    [/^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^\{]+)?\s*\{/, "method"],
  ];
  for (const [pattern, kind] of patterns) {
    const match = line.match(pattern);
    if (match && !["if", "for", "while", "switch", "catch"].includes(match[1])) {
      const component = kind === "function" && /^[A-Z]/.test(match[1]);
      return { name: match[1], kind: component ? "component" : kind };
    }
  }
  return undefined;
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].replaceAll("\t", "    ").length ?? 0;
}

function findSymbolEnd(lines: string[], start: number, language: string): number {
  if (language === "python" || language === "ruby") {
    const baseIndent = indentation(lines[start]);
    for (let index = start + 1; index < lines.length; index += 1) {
      if (lines[index].trim() && indentation(lines[index]) <= baseIndent) return index - 1;
    }
    return lines.length - 1;
  }
  let depth = 0;
  let sawOpeningBrace = false;
  for (let index = start; index < lines.length; index += 1) {
    const opening = (lines[index].match(/\{/g) ?? []).length;
    const closing = (lines[index].match(/\}/g) ?? []).length;
    if (opening) sawOpeningBrace = true;
    depth += opening - closing;
    if (sawOpeningBrace && depth <= 0) return index;
  }
  return start;
}

function locateSymbol(lines: string[], target: number, language: string): LocatedSymbol | undefined {
  for (let start = target; start >= 0; start -= 1) {
    const found = declaration(lines[start]);
    if (!found) continue;
    const end = findSymbolEnd(lines, start, language);
    if (end >= target) return { ...found, start, end };
  }
  return undefined;
}

function boundedContext(lines: string[], target: number, symbol?: LocatedSymbol): { text: string; truncated: boolean } {
  const desiredStart = symbol?.start ?? Math.max(0, target - 20);
  const desiredEnd = symbol?.end ?? Math.min(lines.length - 1, target + 20);
  let start = desiredStart;
  let end = desiredEnd;
  if (end - start + 1 > MAX_CONTEXT_LINES) {
    start = Math.max(desiredStart, target - Math.floor(MAX_CONTEXT_LINES / 2));
    end = Math.min(desiredEnd, start + MAX_CONTEXT_LINES - 1);
    if (target > end) {
      end = target;
      start = Math.max(desiredStart, end - MAX_CONTEXT_LINES + 1);
    }
  }
  let text = lines.slice(start, end + 1).join("\n");
  const characterTruncated = text.length > MAX_CONTEXT_CHARACTERS;
  if (characterTruncated) text = text.slice(0, MAX_CONTEXT_CHARACTERS);
  return { text, truncated: start > desiredStart || end < desiredEnd || characterTruncated };
}

function importLines(lines: string[]): string[] {
  return lines.filter((line) => /^\s*(?:import\b|from\s+\S+\s+import\b|(?:const|let|var)\s+.+?=\s*require\s*\()/.test(line))
    .map((line) => line.trim()).slice(0, 30);
}

function lineContaining(lines: string[], code: string | undefined, fallback: number): number {
  const first = code?.split("\n").map((line) => line.trim()).find(Boolean);
  if (!first) return fallback;
  const found = lines.findIndex((line) => line.includes(first));
  return found >= 0 ? found : fallback;
}

/**
 * Produces LSP-style symbol context from exact historical file snapshots. A real language-server
 * resolver can replace this boundary later; this fallback requires no checkout or dependencies.
 */
export function buildReviewCodeContext(
  comment: RawReviewComment,
  acceptedCode?: string,
): ReviewCodeContext | undefined {
  const language = languageFromPath(comment.filePath);
  if (!comment.reviewedFileContent) {
    if (!comment.diffHunk) return undefined;
    const context = comment.diffHunk.split("\n").slice(-MAX_CONTEXT_LINES).join("\n");
    return {
      source: "diff-hunk",
      language,
      commentLine: comment.line,
      imports: [],
      reviewedContext: context.slice(0, MAX_CONTEXT_CHARACTERS),
      truncated: context.length > MAX_CONTEXT_CHARACTERS,
    };
  }

  const reviewedLines = comment.reviewedFileContent.split("\n");
  const target = Math.max(0, Math.min(reviewedLines.length - 1, (comment.line ?? 1) - 1));
  const symbol = locateSymbol(reviewedLines, target, language);
  const reviewed = boundedContext(reviewedLines, target, symbol);
  let acceptedContext: string | undefined;
  let acceptedTruncated = false;
  if (comment.mergedFileContent) {
    const mergedLines = comment.mergedFileContent.split("\n");
    const acceptedTarget = lineContaining(mergedLines, acceptedCode, Math.min(target, mergedLines.length - 1));
    const acceptedSymbol = locateSymbol(mergedLines, acceptedTarget, language);
    const accepted = boundedContext(mergedLines, acceptedTarget, acceptedSymbol);
    acceptedContext = accepted.text;
    acceptedTruncated = accepted.truncated;
  }
  return {
    source: "historical-file",
    language,
    commentLine: comment.line,
    enclosingSymbol: symbol ? {
      name: symbol.name,
      kind: symbol.kind,
      startLine: symbol.start + 1,
      endLine: symbol.end + 1,
    } : undefined,
    imports: importLines(reviewedLines),
    reviewedContext: reviewed.text,
    acceptedContext,
    truncated: reviewed.truncated || acceptedTruncated,
  };
}
