<div align="center">
    <img alt="Logo" src="public/assets/Premory.png" width="100" />
</div>
<h1 align="center">
    PRemory
</h1>
<p align="center">
    agent memory for org PR reviews
</p>

Every reviewer has a mental list of things they flag over and over that aren't bugs or lint
errors — just "how we do things here." PRemory mines that history out of your team's
merged pull requests and serves it back to coding agents as ranked, evidence-backed conventions,
so an agent can check *before* writing code instead of you catching the same comment on the PR
for the tenth time.

## How It Works

1. **Ingest**: Merged PR review comments flow in automatically, either via a GitHub webhook on a
   repo, or via the VS Code extension's background sync (using your own GitHub login — no admin
   access needed) for whatever repo you have open.
2. **Extract**: The next time an agent asks a question, stale data is compiled on demand — raw
   comments are linked to the code they were left on, classified, and clustered into
   `Convention`s with supporting evidence.
3. **Serve**: An MCP server exposes that memory as tools an agent can call before or while writing
   code — ranked conventions for a path, similar historically-rejected patterns, and a predicted
   review of a diff you're about to propose.
4. **Guard**: A pre-commit hook and VS Code integration can flag staged changes that match a
   high-confidence historical rejection before you even open the PR.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full data model and design rationale,
and [CLAUDE.md](./CLAUDE.md) for a package-by-package tour of the codebase.

## Quick Start

### Prerequisites

- Node.js 22+ (see [`.nvmrc`](./.nvmrc))
- Docker (for local PostgreSQL)
- A GitHub token with `repo` read access, for ingesting PR history
- Optional: `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` for semantic extraction and LLM validation
  fallback — the deterministic analyzer works with no keys at all

### Setup

```bash
npm install

# root env: GITHUB_TOKEN, DATA_DIR, optional model keys
cp .env.example .env

# api-server env: DATABASE_URL, API_HOST/PORT
cp packages/api-server/.env.example packages/api-server/.env

npm run db:setup       # start local Postgres + run migrations
npm run api-server     # GraphQL API on :8790
```

### Get some memory into it

```bash
npm run ingest -- owner/repository   # bulk backfill from a repo's merged PR history
npm run extract                      # compile raw comments into conventions
npm run mcp-server                   # serve conventions over MCP
```

Or skip the manual steps and install the [VS Code extension](./packages/vscode-extension) —
it ingests and refreshes memory for whatever repo you have open, automatically, in the
background.

### Optional: continuous ingestion + pre-commit guard

```bash
npm run webhook-server    # merge-only GitHub webhook listener, for always-on ingestion on one repo
npm run hooks:install     # install the pre-commit review gate
npm run review-check      # manually validate the currently staged diff
```

## Architecture

npm-workspaces monorepo. Every package talks to the others only through JSON files in `data/`
(or Postgres, in production) — never through direct cross-package imports — with `@ht6/shared`
as the one exception for shared type contracts.

| Package | Role |
|---|---|
| [`packages/ingestion`](./packages/ingestion) | GitHub → raw review comments |
| [`packages/extraction`](./packages/extraction) | Raw comments → linked episodes → clustered conventions |
| [`packages/mcp-server`](./packages/mcp-server) | Retrieval, diff validation, and the 5 MCP tools agents call |
| [`packages/pipeline`](./packages/pipeline) | Cross-stage freshness bookkeeping (ingest vs. extract staleness) |
| [`packages/webhook-server`](./packages/webhook-server) | Merge-only GitHub webhook listener |
| [`packages/vscode-extension`](./packages/vscode-extension) | Editor integration: background sync, save-time warnings, pre-commit popup |
| [`packages/api-server`](./packages/api-server) | GraphQL API in front of Postgres, used by the extension and dashboard |
| [`dashboard`](./dashboard) | Read-only web view of conventions and review episodes |

## Development

```bash
npm run build       # tsc -b across all packages
npm run typecheck   # full rebuild, surfaces type errors
npm run test         # vitest across all packages
```

See [docs/PIPELINE.md](./docs/PIPELINE.md) and [docs/DATA_FORMAT.md](./docs/DATA_FORMAT.md) for
the stage-by-stage data flow and interchange file shapes.
