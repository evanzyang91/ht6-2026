// TODO: parse a unified diff string into per-file added lines (and their file paths).
export interface AddedLine {
  filePath: string;
  line: string;
}

export function parseAddedLines(diff: string): AddedLine[] {
  throw new Error("not implemented");
}
