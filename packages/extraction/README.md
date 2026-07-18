# @ht6/extraction (Person 2)

Converts raw review comments into engineering memory: `ReviewEpisode`s (comment linked to
rejected/accepted code) clustered into evidence-backed `Convention`s.

## Usage

```bash
npm run extract
```

Reads `data/raw-comments.json` (`RawReviewComment[]`), writes `data/episodes.json`
(`ReviewEpisode[]`) and `data/conventions.json` (`Convention[]`).

## Semantic analyzer seam

Factual linking (diff hunks, accepted patches, linkage quality, and provenance) remains outside
the semantic processor. `SemanticAnalyzer` receives that evidence and returns normalized intent,
rule, rationale, and prohibited/preferred code signals. The default
`DeterministicSemanticAnalyzer` uses local heuristics and requires no model or network access.

Future hosted or post-trained analyzers implement the same asynchronous interface and can be
passed to `extractComments(rawComments, analyzer)` without changing the interchange files.
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
