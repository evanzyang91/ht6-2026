// Stage 1 (ingestion) output. One record per inline PR review comment (anchored to a diff
// line), plus enough context to reconstruct the diff it was left on. Persisted alongside
// ReviewSummaryComment and ConversationComment in data/raw-comments.json — see raw-comment.ts
// for the RawComment union and how to tell the three apart.
//
// `type` is optional (defaults to "inline" when absent) so existing fixtures/consumers that
// predate the three-way split keep working unchanged; new code should set it explicitly.
export interface RawReviewComment {
  type?: "inline";
  repository: string;
  pullRequest: number;
  commentId: string;
  reviewer: string;
  body: string;
  filePath: string;
  originalCommitSha: string;
  line?: number;
  diffHunk?: string;
  createdAt: string;
  mergedCommitSha?: string;
  /** Final PR patch for this file. Used to infer the code accepted at merge time. */
  acceptedFilePatch?: string;
  pullRequestTitle?: string;
  mergedAt?: string;
  /**
   * Exact file content at originalCommitSha, fetched directly rather than derived from a
   * patch — a patch can be truncated or absent for large diffs. Undefined if the fetch failed
   * or the file didn't exist at that commit.
   */
  reviewedFileContent?: string;
  /** Exact file content at mergedCommitSha (rename-resolved). Same caveats as reviewedFileContent. */
  mergedFileContent?: string;
}
