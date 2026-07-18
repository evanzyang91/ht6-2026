import { createGitHubClient } from "./client.js";
import { paginateAll } from "./paginate.js";
import { withRateLimitRetry } from "./rateLimit.js";

export interface MergedPullRequest {
  number: number;
  title: string;
  mergedAt: string;
  mergeCommitSha?: string;
}

export async function fetchMergedPullRequest(owner: string, repo: string, pullRequest: number): Promise<MergedPullRequest | undefined> {
  const client = createGitHubClient();
  const response = await withRateLimitRetry(() => client.pulls.get({ owner, repo, pull_number: pullRequest }));
  const pr = response.data;
  if (!pr.merged_at) return undefined;
  return {
    number: pr.number,
    title: pr.title,
    mergedAt: pr.merged_at,
    mergeCommitSha: pr.merge_commit_sha ?? undefined,
  };
}

export async function fetchMergedPullRequests(owner: string, repo: string, limit = 75): Promise<MergedPullRequest[]> {
  const client = createGitHubClient();
  const closed = await paginateAll(async (page) => {
    const response = await withRateLimitRetry(() => client.pulls.list({
      owner, repo, state: "closed", sort: "updated", direction: "desc", per_page: 100, page,
    }));
    return response.data;
  }, limit * 3);
  return closed.filter((pr) => pr.merged_at).slice(0, limit).map((pr) => ({
    number: pr.number,
    title: pr.title,
    mergedAt: pr.merged_at!,
    mergeCommitSha: pr.merge_commit_sha ?? undefined,
  }));
}
