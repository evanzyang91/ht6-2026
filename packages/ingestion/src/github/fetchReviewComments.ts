import type { RawReviewComment } from "@ht6/shared";
import type { GitHubClient } from "./client.js";

// Maps GitHub's review-comment payload to RawReviewComment. Two field-mapping quirks worth
// noting: `original_line` (not `line`) is the stable line number that matches `diff_hunk` —
// `line` is null once a comment becomes "outdated" relative to the current diff view. Likewise
// `original_commit_id` (not `commit_id`) stays stable across force-pushes.
export async function fetchReviewComments(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  pullRequest: number
): Promise<RawReviewComment[]> {
  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pullRequest,
    per_page: 100,
  });

  return comments.map((comment): RawReviewComment => ({
    repository: `${owner}/${repo}`,
    pullRequest,
    commentId: String(comment.id),
    reviewer: comment.user?.login ?? "unknown",
    body: comment.body,
    filePath: comment.path,
    originalCommitSha: comment.original_commit_id,
    line: comment.original_line ?? comment.line ?? undefined,
    diffHunk: comment.diff_hunk,
    createdAt: comment.created_at,
    // mergedCommitSha isn't on this payload — backfilled in ingest.ts from the PR object.
  }));
}
