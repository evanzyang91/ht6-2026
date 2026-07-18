import type { ConversationComment } from "@ht6/shared";
import { createGitHubClient } from "./client.js";
import { paginateAll } from "./paginate.js";
import { withRateLimitRetry } from "./rateLimit.js";

type ConversationCommentFields = Omit<
  ConversationComment,
  "pullRequestTitle" | "mergedAt" | "mergedCommitSha"
>;

// Fetches general PR conversation-tab comments (not tied to any diff line or formal review —
// GitHub serves these through the issues API, since a PR is an issue under the hood). PR-level
// fields (title/mergedAt/mergedCommitSha) are attached by the caller.
export async function fetchConversationComments(
  owner: string,
  repo: string,
  pullRequest: number
): Promise<ConversationCommentFields[]> {
  const client = createGitHubClient();
  const comments = await paginateAll(async (page) => {
    const response = await withRateLimitRetry(() => client.issues.listComments({
      owner, repo, issue_number: pullRequest, per_page: 100, page,
    }));
    return response.data;
  });

  return comments
    .filter((comment) => comment.body?.trim())
    .map((comment) => ({
      type: "conversation" as const,
      repository: `${owner}/${repo}`,
      pullRequest,
      commentId: String(comment.id),
      reviewer: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      createdAt: comment.created_at,
      authorAssociation: comment.author_association,
    }));
}
