# @ht6/ingestion (Person 1)

Fetches merged PRs and review comments from GitHub and persists them as
`RawReviewComment[]` for the extraction stage to consume.

## Usage

```bash
npm run ingest -- owner/repository
```

Requires `GITHUB_TOKEN` (see root [.env.example](../../.env.example)).

## Output

Writes `RawReviewComment[]` (type in `@ht6/shared`) to `data/raw-comments.json`
(path from `DATA_DIR`). Ingestion must be resumable and idempotent — re-running
against the same repo should not duplicate records.

## Layout

- `src/cli.ts` — argv parsing, entry point.
- `src/ingest.ts` — orchestrates the fetch → persist flow.
- `src/github/` — GitHub API client, pagination, rate-limit handling, and the
  fetchers for PR metadata, review comments, and patches/changed files.
- `src/storage/` — persistence layer (`Store` interface + JSON/SQLite impls).
