import type { RawReviewComment } from "@ht6/shared";
import { fetchMergedPullRequest, fetchMergedPullRequests, type MergedPullRequest } from "./github/fetchPullRequests.js";
import { fetchReviewComments } from "./github/fetchReviewComments.js";
import { fetchChangedFilesAndPatches } from "./github/fetchPatches.js";
import { createStore } from "./storage/index.js";
import { markRepositoryIngested } from "@ht6/pipeline";

function parseRepository(repoSlug: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repoSlug.split("/");
  if (!owner || !repo || extra) throw new Error("Repository must use owner/repository format");
  return { owner, repo };
}

async function collectPullRequestComments(
  owner: string,
  repo: string,
  pr: MergedPullRequest,
): Promise<RawReviewComment[]> {
  const comments = await fetchReviewComments(owner, repo, pr.number);
  const patches = await fetchChangedFilesAndPatches(owner, repo, pr.number);
  const patchByPath = new Map(patches.map((file) => [file.filePath, file.patch]));
  return comments.map((comment) => ({
    ...comment,
    mergedCommitSha: pr.mergeCommitSha,
    acceptedFilePatch: patchByPath.get(comment.filePath),
    pullRequestTitle: pr.title,
    mergedAt: pr.mergedAt,
  }));
}

// Orchestrates one ingestion run for `owner/repository`:
//   1. fetch 50-100 merged PRs (github/fetchPullRequests.ts)
//   2. for each PR, fetch review comments (github/fetchReviewComments.ts)
//      and changed files/patches (github/fetchPatches.ts)
//   3. persist RawReviewComment[] via storage/index.ts
//
// Existing comment IDs are retained so reruns are resumable and idempotent.
export async function ingest(repoSlug: string, limit = 75): Promise<RawReviewComment[]> {
  const { owner, repo } = parseRepository(repoSlug);
  const store = createStore();
  const existing = await store.load(repoSlug);
  const existingIds = new Set(existing.map((comment) => comment.commentId));
  const pullRequests = await fetchMergedPullRequests(owner, repo, limit);
  const collected = [...existing];

  for (const pr of pullRequests) {
    for (const comment of await collectPullRequestComments(owner, repo, pr)) {
      if (existingIds.has(comment.commentId)) continue;
      collected.push(comment);
      existingIds.add(comment.commentId);
    }
  }
  await store.save(repoSlug, collected);
  for (const pr of pullRequests) await markRepositoryIngested(repoSlug, pr.number);
  return collected;
}

/** Ingests exactly one PR and rejects calls made before that PR has merged. */
export async function ingestMergedPullRequest(repoSlug: string, pullRequest: number): Promise<RawReviewComment[]> {
  const { owner, repo } = parseRepository(repoSlug);
  const pr = await fetchMergedPullRequest(owner, repo, pullRequest);
  if (!pr) throw new Error(`Pull request ${repoSlug}#${pullRequest} is not merged`);
  const store = createStore();
  const existing = await store.load(repoSlug);
  const byId = new Map(existing.map((comment) => [comment.commentId, comment]));
  for (const comment of await collectPullRequestComments(owner, repo, pr)) byId.set(comment.commentId, comment);
  const collected = [...byId.values()];
  await store.save(repoSlug, collected);
  await markRepositoryIngested(repoSlug, pullRequest);
  return collected;
}
