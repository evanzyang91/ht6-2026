import type { RawReviewComment } from "@ht6/shared";

// Inline comments normally point at proposed (+) lines; removed lines are the fallback.
export function linkCommentToRejectedHunk(comment: RawReviewComment): string {
  if (!comment.diffHunk) return "";
  const lines = comment.diffHunk.split("\n");
  const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
  if (added.length) return added.join("\n").trim();
  return lines.filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .map((line) => line.slice(1)).join("\n").trim();
}
