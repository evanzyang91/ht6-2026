# @ht6/mcp-server (Person 3)

Serves the extracted `Convention`s to coding agents over MCP.

## Usage

```bash
npm run mcp-server
```

## Pre-commit review gate

Install the repository-managed hook once:

```bash
npm run hooks:install
```

The hook runs `npm run review-check`, reads `git diff --cached`, refreshes stale engineering memory,
and validates only the changes included in the pending commit. Findings block only when they meet the
confidence threshold and have enough distinct supporting PRs. The hook prints their rule, matched
path, reason, supporting PRs, and an accepted example. When VS Code is open, it also publishes a
local `data/commit-review.json` event that the extension turns into one notification.

```dotenv
# Optional: inferred from the origin remote by default.
ENGINEERING_MEMORY_REPOSITORY=owner/repository
ENGINEERING_MEMORY_BLOCK_THRESHOLD=0.8
ENGINEERING_MEMORY_BLOCK_MIN_SUPPORT=2

# false lets a repository with no compiled conventions commit with a warning.
ENGINEERING_MEMORY_REQUIRE_DATA=false
```

Run it manually at any time:

```bash
git add path/to/files
npm run review-check
```

The deterministic gate checks known prohibited signals and applicable path scopes. It does not claim
to replace human review or detect conventions that have not yet been compiled into memory.

Reads `data/conventions.json` (`Convention[]`, written by `@ht6/extraction`) via
`src/store/`.

Set `ENGINEERING_MEMORY_EMBEDDINGS=local` to add the dependency-free hashed-vector signal to
lexical ranking. It is an offline hackathon fallback; replace `retrieval/embeddings.ts` with a
semantic embedding provider for production.

## Tools

### `get_repo_conventions`

Hybrid retrieval over the convention store: repository filter, path/language scope,
full-text similarity (+ optional embeddings), ranked by confidence and support count.
The MCP response is deliberately compact: rule, rationale, scope, signals, confidence, support
count, supporting PR numbers, and a few accepted examples. Raw review records stay internal.

### `predict_review_feedback`

Validates a supplied diff against known conventions: added-line parsing, import/call
detection, path scope match, prohibited-signal match, optional LLM fallback for
ambiguous cases. Returns compact, evidence-backed findings, e.g.:

```json
{
  "rule": "Controllers must not access Prisma directly.",
  "confidence": 0.82,
  "matchedPath": "src/controllers/order.ts",
  "reason": "The added code imports Prisma inside a controller.",
  "supportingPRs": [142, 207],
  "acceptedExamples": ["return orderService.create(data)"]
}
```

Also exposed: `find_similar_rejected_patterns`, `explain_engineering_decision`, and
`summarize_personal_review_history`.

## Layout

- `src/server.ts` — MCP server bootstrap, registers tools from `src/tools/`.
- `src/store/` — `ConventionStore` interface + JSON/SQLite implementations.
- `src/retrieval/` — pieces composed by `get_repo_conventions`.
- `src/validation/` — pieces composed by `predict_review_feedback`.
- `src/tools/` — the two MCP tool definitions/handlers.
- `tests/` — per-tool tests plus an end-to-end MCP integration test.
