import type { GitHubClient } from "./client.js";

export interface MergedPullRequest {
  number: number;
  mergeCommitSha: string;
  mergedAt: string;
}

// Fetches the most recently merged PRs for a repo, newest first, stopping once `limit` is
// collected. Walks pages via octokit's iterator so a repo with many closed PRs doesn't get
// fully scanned when only the first few pages contain enough merged ones.
export async function fetchMergedPullRequests(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  limit = 100
): Promise<MergedPullRequest[]> {
  const merged: MergedPullRequest[] = [];

  for await (const { data: pulls } of octokit.paginate.iterator(octokit.rest.pulls.list, {
    owner,
    repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: 100,
  })) {
    for (const pr of pulls) {
      if (!pr.merged_at || !pr.merge_commit_sha) continue;
      merged.push({
        number: pr.number,
        mergeCommitSha: pr.merge_commit_sha,
        mergedAt: pr.merged_at,
      });
      if (merged.length >= limit) return merged;
    }
  }

  return merged;
}
