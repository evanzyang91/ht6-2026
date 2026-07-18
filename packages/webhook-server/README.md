# @ht6/webhook-server

Receives GitHub `pull_request` webhooks and ingests a PR only when the event is `closed` and
`pull_request.merged` is true. All other GitHub events and unmerged closures are acknowledged and
ignored. Request bodies are authenticated with `X-Hub-Signature-256` before parsing.

## Run

```bash
GITHUB_TOKEN=... \
GITHUB_WEBHOOK_SECRET=... \
npm run webhook-server
```

Endpoints:

- `POST /github/webhook`
- `GET /health`

Configure the repository webhook with JSON content type, the same secret, and only the **Pull
requests** event. The payload URL must be publicly reachable; for local demos, expose port 8787
through a tunnel.

After a merge, the service ingests only that PR and increments its repository's ingestion version
in `data/pipeline-state.json`. It does not run extraction.

The next essential MCP request runs extraction before reading memory:

```text
merged PR webhook
  -> raw-comments.json
  -> pipeline-state.json: ingestionVersion++

get_repo_conventions / predict_review_feedback
  -> ensureMemoryFresh(repository)
  -> episodes.json + conventions.json
  -> pipeline-state.json: extractionVersion = ingestionVersion
  -> MCP response
```

The JSON state and in-process lock are appropriate for a single-instance hackathon deployment.
Use a durable queue, database transaction, and distributed lock before running multiple instances.
