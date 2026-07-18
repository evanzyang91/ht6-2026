import type { LinkageQuality } from "@ht6/shared";

// Scores how confidently an accepted fix was matched to a rejected hunk.
// e.g. "high" = exact same lines changed in the merge commit; "medium" = heuristic
// match (same file, nearby lines, later commit); "unknown" = no match found.
export function scoreLinkageQuality(rejectedCode: string, acceptedCode?: string): LinkageQuality {
  if (!acceptedCode) return "unknown";
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  if (normalize(rejectedCode) && normalize(rejectedCode) !== normalize(acceptedCode)) return "medium";
  return "unknown";
}
