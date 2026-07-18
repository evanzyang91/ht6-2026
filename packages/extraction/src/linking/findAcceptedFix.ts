import type { RawReviewComment } from "@ht6/shared";

// Selects likely accepted lines from the merged PR patch using comment/code vocabulary.
// This is intentionally best-effort: patches do not preserve enough information for AST-level
// alignment, so callers must retain linkage quality and tolerate an unknown result.
export function findAcceptedFix(
  comment: RawReviewComment,
  rejectedCode = ""
): string | undefined {
  if (!comment.acceptedFilePatch) return undefined;
  const added = comment.acceptedFilePatch.split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1).trimEnd())
    .filter(Boolean);
  if (!added.length) return undefined;
  const evidenceTerms = new Set(
    `${comment.body} ${rejectedCode}`.toLowerCase().match(/[a-z_$][\w$]{2,}/g) ?? []
  );
  const relevant = added.filter((line) => {
    const terms = line.toLowerCase().match(/[a-z_$][\w$]{2,}/g) ?? [];
    return terms.some((term) => evidenceTerms.has(term));
  });
  return (relevant.length ? relevant : added).slice(0, 12).join("\n");
}
