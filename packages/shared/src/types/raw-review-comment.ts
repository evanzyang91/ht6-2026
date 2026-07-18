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
}
