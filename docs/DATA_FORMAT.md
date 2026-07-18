# Interchange data format

All three pipeline stages hand off through plain JSON files in `data/` (path configurable via the
`DATA_DIR` env var, see [.env.example](../.env.example)). This is a deliberate seam: stage 2 and 3
can be built and tested against stage 1's output without a shared database or live GitHub calls.
Types for every file below live in `@ht6/shared` (`packages/shared/src/types`) — import them
rather than redefining shapes locally.

| File                      | Written by            | Read by                          | Shape                                  |
|---------------------------|------------------------|-----------------------------------|-----------------------------------------|
| `data/raw-comments.json`  | `@ht6/ingestion`       | `@ht6/extraction`                 | `RawComment[]` (union — see below)      |
| `data/episodes.json`      | `@ht6/extraction`      | `@ht6/extraction` (clustering step) | `ReviewEpisode[]`                     |
| `data/conventions.json`   | `@ht6/extraction`      | `@ht6/mcp-server`                  | `Convention[]`                          |
| `data/pipeline-state.json`| webhook/pipeline       | `@ht6/pipeline`                    | repository freshness watermarks         |
| `data/webhook-deliveries.json` | `@ht6/webhook-server` | `@ht6/webhook-server`          | seen `X-GitHub-Delivery` ids (dedup)    |

Each file is a flat JSON array (`webhook-deliveries.json` is a flat array of delivery id strings,
capped at the 2000 most recent). A relational production target is defined in
[`schema.sql`](./schema.sql); the JSON boundary remains useful for hackathon parallelism and fixtures.

### `RawComment` — three tagged shapes in one array

`data/raw-comments.json` holds three kinds of PR comment, distinguished by a `type` field:

| `type` | Source | Has file/diff context? | Notes |
|---|---|---|---|
| `"inline"` | `pulls.listReviewComments` | Yes — `filePath`, `diffHunk`, `acceptedFilePatch`, `reviewedFileContent`, `mergedFileContent` | The only type extraction currently processes. `type` is optional here for backward compatibility — an entry with no `type` at all is treated as inline. |
| `"review-summary"` | `pulls.listReviews` | No | The overall verdict text from a submitted review (`reviewState`: APPROVED/CHANGES_REQUESTED/COMMENTED/DISMISSED). Reviews with no summary text or still `PENDING` are not ingested. |
| `"conversation"` | `issues.listComments` | No | General PR conversation-tab comments, not tied to a review or diff line. Carries `authorAssociation` (OWNER/MEMBER/etc) as an authority signal. |

All three carry the shared PR-level context fields (`pullRequestTitle`, `mergedAt`, `mergedCommitSha`) alongside their own `commentId`/`reviewer`/`body`/`createdAt`. `@ht6/extraction`'s read boundary (`pipeline.ts`) filters to `type !== "review-summary" && type !== "conversation"` before running hunk-linking — the other two types are persisted but not yet fed through convention extraction, since there's no code to anchor them to. That's a deliberate extension point, not an oversight.

### `ReviewEpisode.codeContext`

For inline comments, extraction uses `reviewedFileContent` and `mergedFileContent` to build bounded
historical context around the commented line. The episode stores language, imports, enclosing symbol
name/kind/range, up to 100 lines of reviewed and accepted symbol context, and whether that context was
truncated. If exact historical content was unavailable, it falls back to the GitHub diff hunk. This
is an LSP-style context boundary: a production resolver can replace the source heuristic with a real
language server after checking out the historical commit, without changing the model input schema.
