import type { LinkageQuality } from "@ht6/shared";

// TODO: score how confidently an accepted fix was matched to a rejected hunk.
// e.g. "high" = exact same lines changed in the merge commit; "medium" = heuristic
// match (same file, nearby lines, later commit); "unknown" = no match found.
export function scoreLinkageQuality(rejectedCode: string, acceptedCode?: string): LinkageQuality {
  throw new Error("not implemented");
}
