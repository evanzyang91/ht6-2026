import type { RawReviewComment } from "@ht6/shared";

// Selects likely accepted lines from the merged PR patch using comment/code vocabulary.
export function findAcceptedFix(comment: RawReviewComment): string | undefined {
  if (!comment.acceptedFilePatch) return undefined;
  const added = comment.acceptedFilePatch.split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1).trimEnd())
    .filter(Boolean);
  if (!added.length) return undefined;
  const commentTerms = new Set(comment.body.toLowerCase().match(/[a-z_$][\w$]{2,}/g) ?? []);
  const relevant = added.filter((line) => {
    const terms = line.toLowerCase().match(/[a-z_$][\w$]{2,}/g) ?? [];
    return terms.some((term) => commentTerms.has(term));
  });
  return (relevant.length ? relevant : added).slice(0, 12).join("\n");
}
