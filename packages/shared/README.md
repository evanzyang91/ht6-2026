# @ht6/shared

Single source of truth for the types that flow between pipeline stages. **Do not redefine these
shapes in `ingestion`, `extraction`, or `mcp-server`** — import them from here so all three stay
in sync as the schema evolves.

## Exports

- `RawReviewComment` — stage 1 output (see [src/types/raw-review-comment.ts](./src/types/raw-review-comment.ts))
- `ReviewEpisode` — stage 2 intermediate output (see [src/types/review-episode.ts](./src/types/review-episode.ts))
- `Convention` — stage 2 final output / stage 3 input (see [src/types/convention.ts](./src/types/convention.ts))
- `LinkageQuality`, `CommentIntent` — shared literal unions (see [src/types/enums.ts](./src/types/enums.ts))
- Data-dir and interchange filename constants (see [src/constants.ts](./src/constants.ts))
