import type { RawReviewComment } from "@ht6/shared";

// Orchestrates one ingestion run for `owner/repository`:
//   1. fetch 50-100 merged PRs (github/fetchPullRequests.ts)
//   2. for each PR, fetch review comments (github/fetchReviewComments.ts)
//      and changed files/patches (github/fetchPatches.ts)
//   3. persist RawReviewComment[] via storage/index.ts
//
// TODO: make this resumable/idempotent — skip PRs already persisted, respect rate limits
// via github/rateLimit.ts, and paginate via github/paginate.ts.
export async function ingest(repoSlug: string): Promise<RawReviewComment[]> {
  throw new Error("not implemented");
}
