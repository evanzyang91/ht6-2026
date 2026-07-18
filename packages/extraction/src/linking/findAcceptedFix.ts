import type { RawReviewComment } from "@ht6/shared";

// TODO: given a comment and the PR's mergedCommitSha, find the code that replaced the
// rejected hunk (same file/region in a later or merged commit), if any.
export function findAcceptedFix(comment: RawReviewComment): string | undefined {
  throw new Error("not implemented");
}
