import type { RawReviewComment } from "@ht6/shared";
import { fetchMergedPullRequests } from "./github/fetchPullRequests.js";
import { fetchReviewComments } from "./github/fetchReviewComments.js";
import { fetchChangedFilesAndPatches } from "./github/fetchPatches.js";
import { createStore } from "./storage/index.js";

// Orchestrates one ingestion run for `owner/repository`:
//   1. fetch 50-100 merged PRs (github/fetchPullRequests.ts)
//   2. for each PR, fetch review comments (github/fetchReviewComments.ts)
//      and changed files/patches (github/fetchPatches.ts)
//   3. persist RawReviewComment[] via storage/index.ts
//
// Existing comment IDs are retained so reruns are resumable and idempotent.
export async function ingest(repoSlug: string, limit = 75): Promise<RawReviewComment[]> {
  const [owner, repo, extra] = repoSlug.split("/");
  if (!owner || !repo || extra) throw new Error("Repository must use owner/repository format");
  const store = createStore();
  const existing = await store.load(repoSlug);
  const existingIds = new Set(existing.map((comment) => comment.commentId));
  const pullRequests = await fetchMergedPullRequests(owner, repo, limit);
  const collected = [...existing];

  for (const pr of pullRequests) {
    const comments = await fetchReviewComments(owner, repo, pr.number);
    const patches = await fetchChangedFilesAndPatches(owner, repo, pr.number);
    const patchByPath = new Map(patches.map((file) => [file.filePath, file.patch]));
    for (const comment of comments) {
      if (existingIds.has(comment.commentId)) continue;
      collected.push({
        ...comment,
        mergedCommitSha: pr.mergeCommitSha,
        acceptedFilePatch: patchByPath.get(comment.filePath),
        pullRequestTitle: pr.title,
        mergedAt: pr.mergedAt,
      });
      existingIds.add(comment.commentId);
    }
  }
  await store.save(repoSlug, collected);
  return collected;
}
