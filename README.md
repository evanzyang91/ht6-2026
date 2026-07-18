# ht6-2026 — PR Convention Memory MCP Server

An MCP server that gives coding agents memory of an organization's past PR review feedback —
the style, architecture, testing, and security conventions reviewers repeatedly flag that aren't
bugs or lint errors, just "how we do things here." Agents query it before writing code, and it
predicts what a human reviewer would flag on a given diff.

## Pipeline

Three stages, wired together via `data/` JSON files — not direct function calls.
Each stage reads the previous stage's JSON output and writes its own; nobody imports another
stage's internals. See [docs/PIPELINE.md](./docs/PIPELINE.md) for the full data flow and
[docs/DATA_FORMAT.md](./docs/DATA_FORMAT.md) for the interchange file shapes.

| Stage | Package | Owner | Reads | Writes |
|---|---|---|---|---|
| 0. Merge webhook | [`packages/webhook-server`](./packages/webhook-server) | GitHub/data | Merged-PR event | triggers single-PR ingestion |
| 1. Ingestion | [`packages/ingestion`](./packages/ingestion) | GitHub/data | GitHub API | `data/raw-comments.json`, stale version |
| 2. Extraction | [`packages/extraction`](./packages/extraction) | Memory compiler | `data/raw-comments.json` | `data/episodes.json`, `data/conventions.json` |
| 3. Retrieval + MCP | [`packages/mcp-server`](./packages/mcp-server) | Retrieval + MCP | refreshes stale memory, reads conventions | serves MCP tools |

## Repo structure

```
ht6-2026/
├── package.json            workspace root: scripts (ingest/extract/mcp-server/build/test), shared devDeps
├── tsconfig.base.json       compiler options every package's tsconfig extends
├── tsconfig.json            project-references root — enables `tsc -b` across all 4 packages
├── vitest.config.ts         test glob covering packages/*/tests
├── .env.example             GITHUB_TOKEN, DATA_DIR, ANTHROPIC_API_KEY — copy to .env
├── data/                    gitignored interchange JSON files live here at runtime
├── docs/
│   ├── PIPELINE.md          stage-by-stage data flow
│   └── DATA_FORMAT.md       what each interchange file contains
└── packages/
    ├── shared/              @ht6/shared — the type contract, no logic
    │   └── src/types/       RawReviewComment, ReviewEpisode, Convention, enums
    ├── ingestion/           @ht6/ingestion — Person 1
    │   └── src/
    │       ├── cli.ts       `npm run ingest -- owner/repository` entry point
    │       ├── ingest.ts    orchestration
    │       ├── github/      client, pagination, rate-limit, fetchers
    │       └── storage/     Store interface + jsonStore/sqliteStore
    ├── extraction/          @ht6/extraction — Person 2
    │   └── src/
    │       ├── cli.ts       `npm run extract` entry point
    │       ├── conventions.ts   buildConventions() top-level entry
    │       ├── linking/     comment → rejected hunk → accepted fix → linkage quality
    │       ├── classify/    review intent classification
    │       └── clustering/  cluster equivalent episodes, infer path/language scope
    └── mcp-server/          @ht6/mcp-server — Person 3
        └── src/
            ├── server.ts    `npm run mcp-server` entry point, registers tools
            ├── store/        ConventionStore interface + jsonConventionStore/sqliteConventionStore
            ├── retrieval/    filterByRepo, filterByScope, textSimilarity, embeddings, rank
            ├── validation/   parseDiff, detectImportsCalls, matchPathScope, matchProhibitedSignal, llmFallback
            └── tools/        five engineering-memory MCP tools
```

Every package also has its own `README.md` (usage + layout), `tests/` (currently `it.todo`
placeholders naming the success criteria), `package.json`, and `tsconfig.json`.

## Where to find things

- **The type contract** (what a `RawReviewComment`/`ReviewEpisode`/`Convention` looks like):
  [`packages/shared/src/types/`](./packages/shared/src/types/). Change a field here, not in the
  package that happens to produce or consume it.
- **The MCP tools**: [`packages/mcp-server/src/tools/`](./packages/mcp-server/src/tools/) —
  convention retrieval, rejected-pattern search, diff prediction, decision explanation, and reviewer history. They wire MCP schemas to
  `retrieval/index.ts` or `validation/index.ts`; the actual logic lives in those folders.
- **"Why did the MCP server flag/not flag this diff?"**:
  [`packages/mcp-server/src/validation/`](./packages/mcp-server/src/validation/) — diff parsing,
  signal matching, and the optional LLM fallback are each their own file.
- **"Why did we cluster these two comments as the same convention?"**:
  [`packages/extraction/src/clustering/clusterConventions.ts`](./packages/extraction/src/clustering/clusterConventions.ts)
  — clusters on comment text *and* the attached code hunk together (see the note at the top of
  that file), since some comments are self-contained and some only make sense next to their diff.
- **GitHub API details** (auth, pagination, rate limits): all under
  [`packages/ingestion/src/github/`](./packages/ingestion/src/github/), one concern per file.
- **The interchange data itself**: `data/*.json` at runtime (gitignored — regenerate via
  `npm run ingest` / `npm run extract`, or hand-write a fixture while another stage isn't built
  yet).

## What's easy to change later

- **Swap JSON for SQLite**: every stage reads/writes through an interface, not a file directly —
  `Store` in `ingestion/src/storage/index.ts` and `ConventionStore` in
  `mcp-server/src/store/conventionStore.ts`. A `sqliteStore.ts`/`sqliteConventionStore.ts` stub
  already exists next to the JSON one in each package; swapping is a one-line change in whichever
  `create*Store()` factory picks the implementation. `extraction` doesn't have its own store
  since it's a pure batch transform (JSON in, JSON out) — give it one the same way if it grows.
- **Swap a package's language**: stages only talk to each other through `data/*.json`, never
  through direct imports across `packages/*`. That means, say, rewriting `packages/extraction`
  in Python (e.g. for sklearn/sentence-transformers) is architecturally fine — it would just read
  `data/raw-comments.json` and write `data/episodes.json`/`data/conventions.json` matching the
  shapes documented in [docs/DATA_FORMAT.md](./docs/DATA_FORMAT.md), instead of importing
  `@ht6/shared`. The cost is losing compile-time type-checking across that boundary — you'd hand
  -maintain a pydantic (or similar) mirror of the `@ht6/shared` types and keep it in sync
  manually. Reasonable if Person 2 wants Python's NLP ecosystem; not worth it just for variety.
- **Retrieval ranking signals**: `get_repo_conventions` composes independent scorers
  (`filterByRepo` → `filterByScope` → `textSimilarity`/`embeddings` → `rank`) in
  `mcp-server/src/retrieval/`. Adding or removing a signal (e.g. dropping embeddings if there's
  no time) means editing `retrieval/index.ts`'s composition, not the other files.
- **Validation strictness**: `predict_review_feedback` runs signal-matching first
  (`matchPathScope`, `matchProhibitedSignal`) and only falls back to `llmFallback.ts` for
  ambiguous cases — that fallback is optional/stretch and isolated in its own file so it can be
  disabled without touching the rest of `validation/`.

## Quick start

```bash
npm install
cp .env.example .env   # fill in GITHUB_TOKEN

npm run ingest -- owner/repository   # stage 1
npm run extract                      # stage 2
npm run mcp-server                   # stage 3
npm run webhook-server               # merge-only GitHub webhook listener
npm run review-check                 # validate the staged diff against engineering memory
```

Install the tracked pre-commit review gate once with `npm run hooks:install`. It blocks commits whose
staged additions match high-confidence historical review violations. Configure its threshold and
missing-memory behavior in `.env.example`; see the MCP package README for details.

## VS Code extension

The bare-bones popup-driven editor assistant validates only Git-changed lines on save and staged
changes on demand. Save-time results stay in Problems; a blocked pre-commit check produces one
safeguarded popup with a Review action. Install the hook with `npm run hooks:install`, build the
extension with `npm run vscode:build`, then launch **Engineering Memory Extension**
from Run and Debug. See [`packages/vscode-extension/README.md`](./packages/vscode-extension/README.md).

## Merge-only continuous memory

Configure GitHub's **Pull requests** webhook to send JSON to `/github/webhook`. Only a merged
`closed` event is ingested; opened, synchronized, and unmerged PRs are ignored. Ingestion marks the
repository stale but does not extract immediately. The next `get_repo_conventions` or
`predict_review_feedback` MCP call runs extraction once before serving the request. See
[`packages/webhook-server/README.md`](./packages/webhook-server/README.md).

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the data model, retrieval decisions,
Freesolo boundary, hackathon scope, and four-person ownership plan. The production relational
target is documented in [docs/schema.sql](./docs/schema.sql).

## Development

```bash
npm run build       # tsc -b across all packages
npm run test         # vitest across all packages
npm run typecheck    # full rebuild, surfaces type errors
```
