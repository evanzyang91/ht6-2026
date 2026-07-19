# Freesolo SFT dataset

This directory provides reviewed executable examples plus conservative semantic-only examples from
real GitHub review history. Medium-linkage real episodes are never assigned executable signals that
the accepted patch does not prove.

## Contract being trained

The dataset matches the extraction seam already defined in
`packages/extraction/src/semantic/types.ts`:

```text
SemanticInput
  repository, pullRequest, filePath, reviewComment, rejectedCode, acceptedCode?, codeContext?

-> SemanticAnalysis
  intent, title, rule, rationale, detection
```

The model returns the non-redundant v2 contract. Extraction derives legacy `prohibitedSignals` from
`detection.forbiddenSignals` and `preferredSignals` from `detection.requiredSignals` so a model
cannot contradict itself by returning the same fact twice.

`detection.semanticDescription` stores the English contextual condition. Exact trigger, forbidden,
and required signal arrays drive deterministic validation. Modes distinguish code that is forbidden
only in a matching context, code required when a context appears, and semantic-only conventions.

Train against this stable extraction-time contract, not the raw GitHub ingestion union. Raw records
contain source-specific IDs, reviewer metadata, patches, and full files that the model should not
memorize. Extraction converts them into the same bounded `SemanticInput` shape used at inference:
the linked rejected/accepted snippets plus language, imports, enclosing symbol metadata, and at most
100 lines of reviewed/accepted historical symbol context.

Freesolo interprets one review episode. Existing deterministic code continues to link comments to
hunks, find accepted fixes, cluster related episodes, calculate confidence, attach provenance, and
write `data/episodes.json` and `data/conventions.json`.

## Generate and inspect

From the repository root:

```bash
npm run freesolo:mock-data
wc -l training/freesolo/environment/dataset/*.jsonl
head -n 1 training/freesolo/environment/dataset/train.jsonl
```

Expected sizes are 45 training rows and 16 held-out evaluation rows. Training is balanced across
15 forbidden-signal, 15 missing-required-signal, and 15 semantic targets. Each JSONL object contains an
`input` string and an `output` string. Both strings contain JSON so the trained model learns a strict
machine-readable response.

## Freesolo setup order

It is safe to install the CLI, log in, and scaffold the environment before refreshing the dataset.

1. Install and authenticate using the commands shown in the Freesolo dashboard.
2. Run `flash env setup` in a separate Freesolo environment directory.
3. Run `npm run freesolo:build-dataset` from the repository root to refresh the checked-in
   environment's train/eval files.
4. Run the environment's local validation or Freesolo dry run.
5. Use a cost preview before submitting a training run.

CLI details can change while Flash is in beta, so treat the files produced by your installed
`flash env setup` as authoritative for configuration names.

## Deploy and start the trained model

Training produces an adapter but does not keep a serving endpoint active. Deploy the completed run
before configuring extraction. Run these commands from the checked-in Freesolo environment:

```bash
cd training/freesolo/environment

export TRAINED_RUN_ID='<flash-run-id>'
flash deploy "$TRAINED_RUN_ID"
```

`queued` is a normal initial state. Check readiness without repeatedly deploying the same run:

```bash
flash deployments
```

Wait until the row is `ready` or `deployed`. Copy the exact value in its `OPENAI MODEL` column; that
is the value the application must send as `FREESOLO_MODEL`. The deployment command also prints an
OpenAI-compatible base URL. Use the URL ending in `/v1`, not the bare endpoint.

Smoke-test the active adapter through the authenticated Flash CLI:

```bash
flash chat "$TRAINED_RUN_ID" \
  --temperature 0 \
  --max-tokens 100 \
  -m 'Return raw JSON: {"status":"ready"}'
```

## Configure extraction to use Freesolo

For the extraction CLI, copy the package template and keep it uncommitted:

```bash
cp packages/extraction/.env.example packages/extraction/.env
```

Set these values in `packages/extraction/.env`:

```dotenv
ENGINEERING_MEMORY_SEMANTIC_ANALYZER=freesolo
ENGINEERING_MEMORY_SEMANTIC_FALLBACK=deterministic

FREESOLO_BASE_URL=https://your-serving-endpoint.example/v1
FREESOLO_MODEL=<exact OPENAI MODEL value from flash deployments>
FREESOLO_API_KEY=

FREESOLO_TIMEOUT_MS=15000
FREESOLO_MAX_RETRIES=2
FREESOLO_RETRY_DELAY_MS=250
FREESOLO_MAX_CONCURRENCY=4
```

`FREESOLO_API_KEY` is an optional serving credential. Leave it empty unless the serving deployment
explicitly provides one. Do not automatically copy the Flash account/login key into application
configuration.

If extraction is initiated through the GraphQL API instead of `npm run extract`, put the same
backend-only variables in `packages/api-server/.env` or in the hosting provider's secret manager.
VS Code and MCP users should never receive these credentials.

## Test the complete repository flow

Make sure `data/raw-comments.json` exists from ingestion, then run:

```bash
cd /path/to/ht6-2026
npm run extract
```

The completion message should name a provider similar to:

```text
freesolo-with-deterministic-fallback@<openai-model>|1
```

During lazy extraction, the GraphQL API and MCP paths use the same environment-selected analyzer.
Hosted responses are schema-checked and grounded against the supplied rejected/accepted code before
they can be persisted. Requests use bounded concurrency, timeout, and retries. If all hosted attempts
fail or the response is invalid, the default configuration logs the failure and analyzes that episode
deterministically.

To make a provider failure stop extraction instead of falling back:

```dotenv
ENGINEERING_MEMORY_SEMANTIC_FALLBACK=none
```

Common checks:

| Symptom | Check |
|---|---|
| Deployment remains queued | Run `flash deployments`; do not submit another training run. |
| HTTP 404 from chat completions | Confirm `FREESOLO_BASE_URL` ends in `/v1`. |
| Model/adapter not found | Copy the exact `OPENAI MODEL` value from `flash deployments`. |
| Every episode falls back | Inspect stderr for HTTP, timeout, or response-validation errors. |
| Extraction is unexpectedly local | Confirm `ENGINEERING_MEMORY_SEMANTIC_ANALYZER=freesolo` in the environment of the process that starts extraction. |

## Stop serving

Keep the adapter deployed while the backend is expected to use it. When the demo or service is done:

```bash
flash undeploy "$TRAINED_RUN_ID"
```

With deterministic fallback enabled, extraction remains available after undeploying but no longer
uses the trained adapter.

## Expanding the dataset

As more reviewed data becomes available, generate rows from `data/episodes.json`. Use the six core
`SemanticInput` fields plus `codeContext` as input and replace `semanticAnalysis` with a
human-approved target. Split by
convention family, repository, or time—not randomly by individual comment—to prevent near-duplicate
review patterns leaking into evaluation.

Do not use the synthetic portion alone to claim model quality. Report executable behavioral replay
separately from the held-out real semantic-only examples.
