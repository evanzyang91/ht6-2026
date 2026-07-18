# @ht6/extraction (Person 2)

Converts raw review comments into engineering memory: `ReviewEpisode`s (comment linked to
rejected/accepted code) clustered into evidence-backed `Convention`s.

## Usage

```bash
npm run extract
```

Reads `data/raw-comments.json` (`RawReviewComment[]`), writes `data/episodes.json`
(`ReviewEpisode[]`) and `data/conventions.json` (`Convention[]`). If `DATABASE_URL` is set,
the same command also publishes the derived memory to PostgreSQL. Ingestion never receives or
uses the database credential.

## PostgreSQL persistence

Copy `.env.example` to `.env`, set the extraction database URL, then run:

```bash
cp packages/extraction/.env.example packages/extraction/.env
npm run db:setup
npm run extract
```

`db:setup` starts the local PostgreSQL 18 container, waits until it is healthy, and applies the
Prisma migrations. The named Docker volume preserves data across `npm run db:down` and ordinary
container recreation.

In production, set `DATABASE_URL` to the pooled application connection and `DIRECT_URL` to the
direct or session connection used by migrations. Deploy with `npm run db:deploy
--workspace=@ht6/extraction`; Docker Compose is only for local development.

The database stores immutable `ExtractionRun`s. Each run owns its episodes, conventions, and
normalized evidence links. Publication changes `Repository.activeExtractionRunId` in the same
transaction that completes the run, so readers see either the previous complete memory or the
new complete memory—never a partially written rebuild. Analyzer and input versions are retained
for auditability and future deterministic/model/Freesolo comparisons.

Useful commands:

```bash
npm run db:validate --workspace=@ht6/extraction
npm run db:generate --workspace=@ht6/extraction
npm run db:studio --workspace=@ht6/extraction
npm run db:logs
npm run db:down
```

## Semantic analyzer seam

Factual linking (diff hunks, accepted patches, linkage quality, and provenance) remains outside
the semantic processor. `SemanticAnalyzer` receives that evidence and returns normalized intent,
rule, rationale, and prohibited/preferred code signals. The default
`DeterministicSemanticAnalyzer` uses local heuristics and requires no model or network access.
`FreesoloSemanticAnalyzer` calls a deployed adapter through its OpenAI-compatible `/v1` endpoint.
Configured extraction selects the provider from environment variables; direct library calls remain
deterministic unless an analyzer is explicitly supplied.

To enable Freesolo on a backend after deploying an adapter:

```dotenv
ENGINEERING_MEMORY_SEMANTIC_ANALYZER=freesolo
ENGINEERING_MEMORY_SEMANTIC_FALLBACK=deterministic
FREESOLO_BASE_URL=https://your-serving-endpoint.example/v1
FREESOLO_MODEL=your-adapter-or-run-id
FREESOLO_API_KEY=backend-only-secret
FREESOLO_TIMEOUT_MS=15000
FREESOLO_MAX_RETRIES=2
FREESOLO_MAX_CONCURRENCY=4
```

Missing provider configuration fails when extraction starts so a deployment cannot silently claim
to use the model. Once configured, transient network errors, HTTP 408/409/429/5xx responses,
timeouts, and invalid model output are retried with bounded exponential backoff. If all attempts
fail, the default fallback compiles that episode deterministically and writes a warning to stderr.
Set `ENGINEERING_MEMORY_SEMANTIC_FALLBACK=none` to fail the extraction instead.

Every hosted response must be raw JSON with the exact semantic contract. Runtime validation checks
the intent and detection enums, mode-specific invariants, and that executable signals are literal
substrings of the supplied reviewed or accepted code. Invalid or invented signals never enter the
database. Hosted calls are concurrency-limited because extraction may analyze many episodes at once.

Keep the Freesolo and database credentials on the hosted API/extraction service. VS Code and MCP
users should connect to that service; they should not receive or manually configure service keys.
Each episode stores the semantic snapshot and analyzer provider/version so conventions can be
rebuilt and audited without calling the provider again.

## Success criterion

At least three `Convention`s each supported by multiple real PRs
(`supportingEpisodes.length > 1` across distinct `pullRequest`s).

## Layout

- `src/cli.ts` — entry point, runs the full extraction pipeline.
- `src/linking/` — link a comment to its rejected hunk, find the likely accepted fix,
  and score linkage quality (high/medium/unknown).
- `src/classify/` — classify review intent (actionable/architecture/testing/security/style/question).
- `src/clustering/` — cluster equivalent episodes and infer path/language scope.
- `src/semantic/` — provider-neutral analyzer contract and deterministic implementation.
- `src/conventions.ts` — top-level `buildConventions()` combining the above into `Convention[]`.
