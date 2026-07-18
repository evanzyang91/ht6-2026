import type { RawReviewComment } from "@ht6/shared";

// TODO: given a comment's diffHunk/filePath/originalCommitSha, identify the exact rejected
// code snippet it refers to.
export function linkCommentToRejectedHunk(comment: RawReviewComment): string {
  throw new Error("not implemented");
}
