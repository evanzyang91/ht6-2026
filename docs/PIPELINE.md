# Pipeline overview

Three stages, one owner each, connected by JSON files in `data/` (see [DATA_FORMAT.md](./DATA_FORMAT.md)).

For continuous operation, a verified GitHub webhook ingests only merged PRs. It increments a
repository ingestion version in `pipeline-state.json`; extraction remains lazy and is run by the
next essential MCP tool call when that version is newer than the compiled extraction version.

```
GitHub repo
    │  (packages/ingestion)
    ▼
data/raw-comments.json      RawReviewComment[]
    │  (packages/extraction)
    ▼
data/episodes.json          ReviewEpisode[]
data/conventions.json       Convention[]
    │  (packages/mcp-server)
    ▼
MCP tools: conventions, rejected patterns, prediction, explanation, reviewer history
```

```text
pull_request.closed + merged=true
    -> ingestMergedPullRequest(repository, number)
    -> raw-comments.json + stale pipeline version
    -> next get_repo_conventions / predict_review_feedback
    -> ensureMemoryFresh(repository)
    -> extraction + MCP response
```

## Stage 1 — Ingestion (`@ht6/ingestion`)

Authenticates to GitHub, fetches 50-100 merged PRs from a target repository (metadata, review
comments, changed files, commit SHAs, patches, reviewers, timestamps), and persists them as
`RawReviewComment[]`. Resumable and idempotent — re-running should not duplicate data.

Run: `npm run ingest -- owner/repository`

## Stage 2 — Extraction (`@ht6/extraction`)

Reads raw comments, links each comment to the rejected code hunk it was left on, and finds the
likely accepted fix from a later or merged commit (linkage quality: high/medium/unknown).
Classifies review intent and clusters equivalent comments into `Convention` records with
confidence scores and supporting evidence.

Run: `npm run extract`

## Stage 3 — Retrieval + MCP server (`@ht6/mcp-server`)

Serves the persisted conventions to coding agents via two MCP tools:

- `get_repo_conventions` — hybrid retrieval (repo/path/language scope, text similarity,
  confidence/support ranking) over the convention store.
- `predict_review_feedback` — validates a supplied diff against conventions (added-line parsing,
  import/call detection, path scope, contextual forbidden signals, missing required signals, and
  optional semantic fallback) and returns evidence-backed predictions.

Run: `npm run mcp-server`
