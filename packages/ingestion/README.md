# @ht6/ingestion (Person 1)

Fetches merged PRs and review comments from GitHub and persists them as
`RawReviewComment[]` for the extraction stage to consume. Two entry points:

- **`ingest(repository, limit)`** — bulk historical import (CLI-driven).
- **`ingestMergedPullRequest(repository, pullRequest)`** — ingests exactly one PR, used by
  `@ht6/webhook-server` on a merge event. Confirms the PR is actually merged, fetches its
  comments/patches/exact file content, merges idempotently, and calls
  `markRepositoryIngested` — it does **not** run extraction. The next
  `get_repo_conventions`/`predict_review_feedback` MCP call detects the stale ingestion version
  and runs extraction automatically (see `@ht6/pipeline`).

## Usage

```bash
npm run ingest -- owner/repository        # historical backfill (this package's CLI)
npm run webhook-server                    # continuous ingestion on merge (see @ht6/webhook-server)
```

Requires `GITHUB_TOKEN` (see root [.env.example](../../.env.example)). The webhook path also
needs `GITHUB_WEBHOOK_SECRET`, `WEBHOOK_HOST`, `WEBHOOK_PORT`.

## Output

Writes `RawReviewComment[]` (type in `@ht6/shared`) to `data/raw-comments.json`
(path from `DATA_DIR`). Every stored comment carries: repository, PR number, comment id,
reviewer, body, file path, original commit SHA, line, diff hunk, timestamp, merge commit SHA,
merged-file patch, PR title, merge timestamp — plus exact file content at both the reviewed and
merged commits (`reviewedFileContent`/`mergedFileContent`), fetched directly rather than derived
only from the patch, which GitHub can truncate for large diffs.

Both entry points are resumable and idempotent: re-running never duplicates a `commentId`, and
the pipeline's `ingestionVersion` only increments when a run actually added a comment that wasn't
already stored — a no-op rerun (nothing new, or a merged PR with zero review comments) still
updates bookkeeping (`lastMergedPullRequest`) but must not trigger a downstream re-extraction.

## Layout

- `src/cli.ts` — argv parsing, entry point for the historical backfill.
- `src/ingest.ts` — orchestrates both entry points: fetch → resolve renames → fetch exact file
  content → persist → mark ingested.
- `src/github/` — GitHub API client (retry-plugin-wrapped), pagination, rate-limit handling
  (reactive retry + proactive `x-ratelimit-remaining` backoff), and fetchers for PR metadata,
  review comments, changed files/patches (with rename + truncation detection), and exact file
  content at a ref.
- `src/storage/` — persistence layer (`Store` interface + atomic-write `JsonStore`).
