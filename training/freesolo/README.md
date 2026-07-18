# Freesolo SFT smoke dataset

This directory provides synthetic data for verifying the Freesolo training workflow before real
GitHub review history is available. It is deliberately too small and synthetic for a production
adapter.

## Contract being trained

The dataset matches the extraction seam already defined in
`packages/extraction/src/semantic/types.ts`:

```text
SemanticInput
  repository, pullRequest, filePath, reviewComment, rejectedCode, acceptedCode?, codeContext?

-> SemanticAnalysis
  intent, title, rule, rationale, prohibitedSignals, preferredSignals, detection
```

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
wc -l training/freesolo/datasets/*.jsonl
head -n 1 training/freesolo/datasets/train.jsonl
```

Expected sizes are 18 training rows and 6 held-out evaluation rows. Each JSONL object contains an
`input` string and an `output` string. Both strings contain JSON so the trained model learns a strict
machine-readable response.

## Freesolo setup order

It is safe to install the CLI, log in, and scaffold an environment before real data exists. Do not
pay for or submit a meaningful training run yet.

1. Install and authenticate using the commands shown in the Freesolo dashboard.
2. Run `flash env setup` in a separate Freesolo environment directory.
3. Copy this directory's `datasets/train.jsonl` and `datasets/eval.jsonl` into the generated
   environment's dataset directory, preserving the names expected by its generated `environment.py`.
4. Run the environment's local validation or Freesolo dry run.
5. Use a cost preview before submitting a training run.

CLI details can change while Flash is in beta, so treat the files produced by your installed
`flash env setup` as authoritative for configuration names.

## Replacing mock data

Once ingestion and accepted-fix linking work, generate rows from `data/episodes.json`. Use the six
core `SemanticInput` fields plus `codeContext` as input and replace `semanticAnalysis` with a
human-approved target. Split by
convention family, repository, or time—not randomly by individual comment—to prevent near-duplicate
review patterns leaking into evaluation.

Never use synthetic evaluation data to claim model quality. The mock set checks formatting,
training, deployment, and JSON parsing only.
