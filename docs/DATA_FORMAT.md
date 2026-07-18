# Interchange data format

All three pipeline stages hand off through plain JSON files in `data/` (path configurable via the
`DATA_DIR` env var, see [.env.example](../.env.example)). This is a deliberate seam: stage 2 and 3
can be built and tested against stage 1's output without a shared database or live GitHub calls.
Types for every file below live in `@ht6/shared` (`packages/shared/src/types`) — import them
rather than redefining shapes locally.

| File                      | Written by            | Read by                          | Shape                                  |
|---------------------------|------------------------|-----------------------------------|-----------------------------------------|
| `data/raw-comments.json`  | `@ht6/ingestion`       | `@ht6/extraction`                 | `RawReviewComment[]`                    |
| `data/episodes.json`      | `@ht6/extraction`      | `@ht6/extraction` (clustering step) | `ReviewEpisode[]`                     |
| `data/conventions.json`   | `@ht6/extraction`      | `@ht6/mcp-server`                  | `Convention[]`                          |
| `data/pipeline-state.json`| webhook/pipeline       | `@ht6/pipeline`                    | repository freshness watermarks         |

Each file is a flat JSON array. A relational production target is defined in
[`schema.sql`](./schema.sql); the JSON boundary remains useful for hackathon parallelism and fixtures.
