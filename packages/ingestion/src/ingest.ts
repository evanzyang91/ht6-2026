import type { RawReviewComment } from "@ht6/shared";
import { fetchMergedPullRequest, fetchMergedPullRequests, type MergedPullRequest } from "./github/fetchPullRequests.js";
import { fetchReviewComments } from "./github/fetchReviewComments.js";
import { fetchChangedFilesAndPatches, type ChangedFilePatch } from "./github/fetchPatches.js";
import { fetchFileContentAtRef } from "./github/fetchFileContent.js";
import { createStore } from "./storage/index.js";
import { markRepositoryIngested } from "@ht6/pipeline";

function parseRepository(repoSlug: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repoSlug.split("/");
  if (!owner || !repo || extra) throw new Error("Repository must use owner/repository format");
  return { owner, repo };
}

// Memoizes fetchFileContentAtRef within one PR's worth of comments — multiple comments often
// land on the same file, and there's no reason to fetch its content at a given ref twice.
function createContentCache(owner: string, repo: string) {
  const cache = new Map<string, Promise<string | undefined>>();
  return (path: string, ref: string): Promise<string | undefined> => {
    const key = `${path}@${ref}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = fetchFileContentAtRef(owner, repo, path, ref);
      cache.set(key, pending);
    }
    return pending;
  };
}

async function collectPullRequestComments(
  owner: string,
  repo: string,
  pr: MergedPullRequest,
): Promise<RawReviewComment[]> {
  const comments = await fetchReviewComments(owner, repo, pr.number);
  const patches = await fetchChangedFilesAndPatches(owner, repo, pr.number);

  // A comment may carry the file's OLD path (made before a later rename in the same PR), but
  // the merged commit only has it under the NEW path — index by both so lookups succeed either way.
  const patchByPath = new Map<string, ChangedFilePatch>();
  for (const file of patches) {
    patchByPath.set(file.filePath, file);
    if (file.previousFilePath) patchByPath.set(file.previousFilePath, file);
  }

  const getContent = createContentCache(owner, repo);

  return Promise.all(comments.map(async (comment) => {
    const fileInfo = patchByPath.get(comment.filePath);
    const mergedFilePath = fileInfo?.filePath ?? comment.filePath;

    const [reviewedFileContent, mergedFileContent] = await Promise.all([
      getContent(comment.filePath, comment.originalCommitSha),
      pr.mergeCommitSha ? getContent(mergedFilePath, pr.mergeCommitSha) : Promise.resolve(undefined),
    ]);

    return {
      ...comment,
      mergedCommitSha: pr.mergeCommitSha,
      acceptedFilePatch: fileInfo?.patch,
      pullRequestTitle: pr.title,
      mergedAt: pr.mergedAt,
      reviewedFileContent,
      mergedFileContent,
    };
  }));
}

// Orchestrates one ingestion run for `owner/repository`:
//   1. fetch 50-100 merged PRs (github/fetchPullRequests.ts)
//   2. for each PR, fetch review comments (github/fetchReviewComments.ts), changed files/patches
//      (github/fetchPatches.ts), and exact file content at both commits (github/fetchFileContent.ts)
//   3. persist RawReviewComment[] via storage/index.ts
//
// Existing comment IDs are retained so reruns are resumable and idempotent. The repository's
// ingestion version is only bumped when this run actually added a comment that wasn't already
// stored — a no-op rerun (nothing new merged) must not trigger a downstream re-extraction.
export async function ingest(repoSlug: string, limit = 75): Promise<RawReviewComment[]> {
  const { owner, repo } = parseRepository(repoSlug);
  const store = createStore();
  const existing = await store.load(repoSlug);
  const existingIds = new Set(existing.map((comment) => comment.commentId));
  const pullRequests = await fetchMergedPullRequests(owner, repo, limit);
  const collected = [...existing];
  let changed = false;

  for (const pr of pullRequests) {
    for (const comment of await collectPullRequestComments(owner, repo, pr)) {
      if (existingIds.has(comment.commentId)) continue;
      collected.push(comment);
      existingIds.add(comment.commentId);
      changed = true;
    }
  }

  if (changed) await store.save(repoSlug, collected);
  const mostRecentPr = pullRequests.reduce(
    (latest, pr) => (latest === undefined || pr.number > latest ? pr.number : latest),
    undefined as number | undefined,
  );
  if (mostRecentPr !== undefined) {
    await markRepositoryIngested(repoSlug, mostRecentPr, undefined, { changed });
  }
  return collected;
}

/** Ingests exactly one PR and rejects calls made before that PR has merged. */
export async function ingestMergedPullRequest(repoSlug: string, pullRequest: number): Promise<RawReviewComment[]> {
  const { owner, repo } = parseRepository(repoSlug);
  const pr = await fetchMergedPullRequest(owner, repo, pullRequest);
  if (!pr) throw new Error(`Pull request ${repoSlug}#${pullRequest} is not merged`);
  const store = createStore();
  const existing = await store.load(repoSlug);
  const existingIds = new Set(existing.map((comment) => comment.commentId));
  const byId = new Map(existing.map((comment) => [comment.commentId, comment]));
  let changed = false;

  for (const comment of await collectPullRequestComments(owner, repo, pr)) {
    if (!existingIds.has(comment.commentId)) changed = true;
    byId.set(comment.commentId, comment);
  }

  const collected = [...byId.values()];
  if (changed) await store.save(repoSlug, collected);
  await markRepositoryIngested(repoSlug, pullRequest, undefined, { changed });
  return collected;
}
