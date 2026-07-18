// Parses a unified diff into per-file added lines.
export interface AddedLine {
  filePath: string;
  line: string;
  lineNumber: number;
}

export function parseAddedLines(diff: string): AddedLine[] {
  const result: AddedLine[] = [];
  let filePath = "";
  let newLineNumber = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const nextPath = line.slice(4).replace(/^b\//, "").trim();
      filePath = nextPath === "/dev/null" ? "" : nextPath;
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLineNumber = Number(hunk[1]);
      continue;
    }
    if (filePath && line.startsWith("+") && !line.startsWith("+++")) {
      result.push({ filePath, line: line.slice(1), lineNumber: newLineNumber });
      newLineNumber += 1;
      continue;
    }
    if (filePath && !line.startsWith("-") && !line.startsWith("\\")) newLineNumber += 1;
  }
  return result;
}
