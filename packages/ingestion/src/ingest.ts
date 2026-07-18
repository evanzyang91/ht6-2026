import type { RawReviewComment } from "@ht6/shared";
import { createGitHubClient, type GitHubClient } from "./github/client.js";
import { fetchMergedPullRequests, type MergedPullRequest } from "./github/fetchPullRequests.js";
import { fetchReviewComments } from "./github/fetchReviewComments.js";
import { withRateLimitRetry } from "./github/rateLimit.js";
import { createStore } from "./storage/index.js";

export interface IngestOptions {
  limit?: number;
  pr?: number;
  force?: boolean;
}

async function resolveTargetPullRequests(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  options: IngestOptions
): Promise<MergedPullRequest[]> {
  if (options.pr !== undefined) {
    const pullNumber = options.pr;
    const { data: pr } = await withRateLimitRetry(() =>
      octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber })
    );
    if (!pr.merged_at || !pr.merge_commit_sha) {
      throw new Error(`PR #${pullNumber} in ${owner}/${repo} is not merged`);
    }
    return [{ number: pr.number, mergeCommitSha: pr.merge_commit_sha, mergedAt: pr.merged_at }];
  }

  return withRateLimitRetry(() =>
    fetchMergedPullRequests(octokit, owner, repo, options.limit ?? 100)
  );
}

// Orchestrates one ingestion run for `owner/repository`: resolve the target PR list, fetch each
// PR's review comments, backfill mergedCommitSha (only known from the PR object, not the
// comment), and persist after every PR so a killed run loses at most one PR's worth of work.
//
// Resumability: a PR is skipped if any RawReviewComment for it already exists in the store
// (unless --force). Known limitation: a merged PR with zero review comments never shows up in
// the store, so it gets re-checked (one cheap API call) on every rerun — acceptable at this
// scale, not worth a separate "processed PRs" manifest.
export async function ingest(
  repoSlug: string,
  options: IngestOptions = {}
): Promise<RawReviewComment[]> {
  const [owner, repo] = repoSlug.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository "${repoSlug}", expected "owner/repository"`);
  }

  const octokit = createGitHubClient();
  const store = createStore();

  const existing = options.force ? [] : await store.load(repoSlug);
  const alreadyCoveredPrs = new Set(existing.map((c) => c.pullRequest));
  let all = existing;

  const pullRequests = await resolveTargetPullRequests(octokit, owner, repo, options);

  for (const pr of pullRequests) {
    if (!options.force && alreadyCoveredPrs.has(pr.number)) {
      continue;
    }

    const comments = await withRateLimitRetry(() =>
      fetchReviewComments(octokit, owner, repo, pr.number)
    );
    const withMergeSha = comments.map((c) => ({ ...c, mergedCommitSha: pr.mergeCommitSha }));

    all = [...all.filter((c) => c.pullRequest !== pr.number), ...withMergeSha];
    await store.save(repoSlug, all);
  }

  return all;
}
