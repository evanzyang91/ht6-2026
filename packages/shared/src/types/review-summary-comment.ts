// A review's overall summary text (the body a reviewer types when submitting Approve/Request
// changes/Comment) — distinct from the inline comments attached to that same review. Not
// anchored to any file or line; the signal here is the reviewer's overall verdict/reasoning for
// the PR as a whole. See raw-comment.ts for the RawComment union.
export interface ReviewSummaryComment {
  type: "review-summary";
  repository: string;
  pullRequest: number;
  commentId: string;
  /** Who submitted the review. */
  reviewer: string;
  body: string;
  createdAt: string;
  reviewState: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  /** The commit this review was submitted against, if GitHub reported one. */
  reviewCommitSha?: string;
  pullRequestTitle?: string;
  mergedAt?: string;
  mergedCommitSha?: string;
}
