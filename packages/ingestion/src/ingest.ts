import type { RawComment } from "@ht6/shared";
import { fetchMergedPullRequest, fetchMergedPullRequests, type MergedPullRequest } from "./github/fetchPullRequests.js";
import { fetchReviewComments } from "./github/fetchReviewComments.js";
import { fetchChangedFilesAndPatches, type ChangedFilePatch } from "./github/fetchPatches.js";
import { fetchFileContentAtRef } from "./github/fetchFileContent.js";
import { fetchReviewSummaries } from "./github/fetchReviewSummaries.js";
import { fetchConversationComments } from "./github/fetchConversationComments.js";
import { createStore } from "./storage/index.js";
import { markRepositoryIngested } from "@ht6/pipeline";
import { withGitHubToken } from "./github/client.js";

export interface IngestionProgress {
  phase: "fetching-pull-requests" | "fetching-comments" | "complete";
  current: number;
  total: number;
  message: string;
}

export interface IngestOptions {
  limit?: number;
  /** Ephemeral credential, normally supplied by VS Code's GitHub authentication provider. */
  token?: string;
  dataDirectory?: string;
  /** Persist an explicit empty source snapshot so downstream extraction can distinguish it from missing data. */
  persistEmptySnapshot?: boolean;
  onProgress?: (progress: IngestionProgress) => void;
}

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

// Collects all three comment types for one PR — inline review comments (code-anchored),
// review summaries (a review's overall verdict text), and general conversation-tab comments —
// each tagged by `type` in the RawComment union, all stamped with the same PR-level context
// (title/mergedAt/mergedCommitSha) since they all belong to the same merged PR.
async function collectPullRequestComments(
  owner: string,
  repo: string,
  pr: MergedPullRequest,
): Promise<RawComment[]> {
  const [inlineComments, patches, reviewSummaries, conversationComments] = await Promise.all([
    fetchReviewComments(owner, repo, pr.number),
    fetchChangedFilesAndPatches(owner, repo, pr.number),
    fetchReviewSummaries(owner, repo, pr.number),
    fetchConversationComments(owner, repo, pr.number),
  ]);

  // A comment may carry the file's OLD path (made before a later rename in the same PR), but
  // the merged commit only has it under the NEW path — index by both so lookups succeed either way.
  const patchByPath = new Map<string, ChangedFilePatch>();
  for (const file of patches) {
    patchByPath.set(file.filePath, file);
    if (file.previousFilePath) patchByPath.set(file.previousFilePath, file);
  }

  const getContent = createContentCache(owner, repo);

  const inline: RawComment[] = await Promise.all(inlineComments.map(async (comment) => {
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

  const prContext = { pullRequestTitle: pr.title, mergedAt: pr.mergedAt, mergedCommitSha: pr.mergeCommitSha };
  const summaries: RawComment[] = reviewSummaries.map((review) => ({ ...review, ...prContext }));
  const conversation: RawComment[] = conversationComments.map((comment) => ({ ...comment, ...prContext }));

  return [...inline, ...summaries, ...conversation];
}

function commentId(comment: RawComment): string {
  return comment.commentId;
}

// Orchestrates one ingestion run for `owner/repository`:
//   1. fetch 50-100 merged PRs (github/fetchPullRequests.ts)
//   2. for each PR, fetch inline review comments, review summaries, conversation comments,
//      changed files/patches, and exact file content at both commits
//   3. persist RawComment[] via storage/index.ts
//
// Existing comment IDs are retained so reruns are resumable and idempotent. The repository's
// ingestion version is only bumped when this run actually added a comment that wasn't already
// stored — a no-op rerun (nothing new merged) must not trigger a downstream re-extraction.
async function runIngestion(repoSlug: string, options: IngestOptions): Promise<RawComment[]> {
  const { owner, repo } = parseRepository(repoSlug);
  const limit = options.limit ?? 75;
  const store = createStore(options.dataDirectory);
  const existing = await store.load(repoSlug);
  const existingIds = new Set(existing.map(commentId));
  options.onProgress?.({
    phase: "fetching-pull-requests",
    current: 0,
    total: limit,
    message: `Finding the latest ${limit} merged pull requests…`,
  });
  const pullRequests = await fetchMergedPullRequests(owner, repo, limit);
  const collected = [...existing];
  let changed = false;

  for (const [index, pr] of pullRequests.entries()) {
    options.onProgress?.({
      phase: "fetching-comments",
      current: index,
      total: pullRequests.length,
      message: `Processing pull request #${pr.number} (${index + 1}/${pullRequests.length})…`,
    });
    for (const comment of await collectPullRequestComments(owner, repo, pr)) {
      if (existingIds.has(commentId(comment))) continue;
      collected.push(comment);
      existingIds.add(commentId(comment));
      changed = true;
    }
  }

  if (changed || (options.persistEmptySnapshot && !existing.length)) {
    await store.save(repoSlug, collected);
  }
  const mostRecentPr = pullRequests.reduce(
    (latest, pr) => (latest === undefined || pr.number > latest ? pr.number : latest),
    undefined as number | undefined,
  );
  if (mostRecentPr !== undefined) {
    await markRepositoryIngested(repoSlug, mostRecentPr, options.dataDirectory, { changed });
  }
  options.onProgress?.({
    phase: "complete",
    current: pullRequests.length,
    total: pullRequests.length,
    message: `Collected ${collected.length} review comments.`,
  });
  return collected;
}

export async function ingest(
  repoSlug: string,
  limitOrOptions: number | IngestOptions = 75,
): Promise<RawComment[]> {
  const options = typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const operation = () => runIngestion(repoSlug, options);
  return options.token ? withGitHubToken(options.token, operation) : operation();
}

/** Ingests exactly one PR and rejects calls made before that PR has merged. */
export async function ingestMergedPullRequest(repoSlug: string, pullRequest: number): Promise<RawComment[]> {
  const { owner, repo } = parseRepository(repoSlug);
  const pr = await fetchMergedPullRequest(owner, repo, pullRequest);
  if (!pr) throw new Error(`Pull request ${repoSlug}#${pullRequest} is not merged`);
  const store = createStore();
  const existing = await store.load(repoSlug);
  const existingIds = new Set(existing.map(commentId));
  const byId = new Map(existing.map((comment) => [commentId(comment), comment]));
  let changed = false;

  for (const comment of await collectPullRequestComments(owner, repo, pr)) {
    if (!existingIds.has(commentId(comment))) changed = true;
    byId.set(commentId(comment), comment);
  }

  const collected = [...byId.values()];
  if (changed) await store.save(repoSlug, collected);
  await markRepositoryIngested(repoSlug, pullRequest, undefined, { changed });
  return collected;
}
