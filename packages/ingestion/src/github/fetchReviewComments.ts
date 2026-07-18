import type { RawReviewComment } from "@ht6/shared";

// TODO: fetch review comments for a single PR and map them to RawReviewComment
// (reviewer, body, filePath, originalCommitSha, line, diffHunk, createdAt, ...).
export async function fetchReviewComments(
  owner: string,
  repo: string,
  pullRequest: number
): Promise<RawReviewComment[]> {
  throw new Error("not implemented");
}
