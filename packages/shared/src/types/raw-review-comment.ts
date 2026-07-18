// Stage 1 (ingestion) output. One record per PR review comment, plus enough context to
// reconstruct the diff it was left on. Persisted to data/raw-comments.json.
export interface RawReviewComment {
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
