import type { ReviewSummaryComment } from "@ht6/shared";
import { createGitHubClient } from "./client.js";
import { paginateAll } from "./paginate.js";
import { withRateLimitRetry } from "./rateLimit.js";

type ReviewSummaryFields = Omit<
  ReviewSummaryComment,
  "pullRequestTitle" | "mergedAt" | "mergedCommitSha"
>;

// Fetches review-level summaries (the body text submitted alongside an Approve/Request
// changes/Comment verdict) — distinct from inline comments. Skips PENDING (draft, not yet
// submitted) reviews and reviews with no summary text, since there's nothing to ingest from
// those. PR-level fields (title/mergedAt/mergedCommitSha) are attached by the caller.
export async function fetchReviewSummaries(
  owner: string,
  repo: string,
  pullRequest: number
): Promise<ReviewSummaryFields[]> {
  const client = createGitHubClient();
  const reviews = await paginateAll(async (page) => {
    const response = await withRateLimitRetry(() => client.pulls.listReviews({
      owner, repo, pull_number: pullRequest, per_page: 100, page,
    }));
    return response.data;
  });

  return reviews
    .filter((review) => review.state !== "PENDING" && review.body?.trim())
    .map((review) => ({
      type: "review-summary" as const,
      repository: `${owner}/${repo}`,
      pullRequest,
      commentId: String(review.id),
      reviewer: review.user?.login ?? "unknown",
      body: review.body ?? "",
      createdAt: review.submitted_at ?? "",
      reviewState: review.state as ReviewSummaryFields["reviewState"],
      reviewCommitSha: review.commit_id ?? undefined,
    }));
}
