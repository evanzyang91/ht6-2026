import type { RawReviewComment } from "@ht6/shared";

import { createGitHubClient } from "./client.js";
import { paginateAll } from "./paginate.js";
import { withRateLimitRetry } from "./rateLimit.js";

export async function fetchReviewComments(
  owner: string,
  repo: string,
  pullRequest: number
): Promise<RawReviewComment[]> {
  const client = createGitHubClient();
  const comments = await paginateAll(async (page) => {
    const response = await withRateLimitRetry(() => client.pulls.listReviewComments({
      owner, repo, pull_number: pullRequest, per_page: 100, page,
    }));
    return response.data;
  });
  return comments.map((comment) => ({
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
  }));
}
