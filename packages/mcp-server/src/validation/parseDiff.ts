// Parses a unified diff into per-file added lines.
export interface AddedLine {
  filePath: string;
  line: string;
}

export function parseAddedLines(diff: string): AddedLine[] {
  const result: AddedLine[] = [];
  let filePath = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      filePath = line.slice(4).replace(/^b\//, "").trim();
      continue;
    }
    if (filePath && line.startsWith("+") && !line.startsWith("+++")) {
      result.push({ filePath, line: line.slice(1) });
    }
  }
  return result;
}
