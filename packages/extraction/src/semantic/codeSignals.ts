const CALL_PATTERN = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
const IMPORT_PATTERN = /(?:\bfrom\s+|\brequire\s*\(\s*['"])([@\w./-]+)/g;

/** Extract compact import and call names suitable for deterministic diff matching. */
export function extractCodeSignals(code: string): string[] {
  const imports = [...code.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
  const calls = [...code.matchAll(CALL_PATTERN)].map((match) => match[1]);
  return [...new Set([...imports, ...calls])].slice(0, 12);
}

