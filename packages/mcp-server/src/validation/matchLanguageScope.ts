import type { Convention } from "@ht6/shared";

const languageByExtension: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
};

export function matchesLanguageScope(convention: Convention, filePath: string): boolean {
  if (!convention.languages.length) return true;
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  const language = languageByExtension[extension] ?? extension;
  return convention.languages.some((candidate) => candidate.toLowerCase() === language);
}
