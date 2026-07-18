# @ht6/extraction (Person 2)

Converts raw review comments into engineering memory: `ReviewEpisode`s (comment linked to
rejected/accepted code) clustered into evidence-backed `Convention`s.

## Usage

```bash
npm run extract
```

Reads `data/raw-comments.json` (`RawReviewComment[]`), writes `data/episodes.json`
(`ReviewEpisode[]`) and `data/conventions.json` (`Convention[]`).

## Success criterion

At least three `Convention`s each supported by multiple real PRs
(`supportingEpisodes.length > 1` across distinct `pullRequest`s).

## Layout

- `src/cli.ts` — entry point, runs the full extraction pipeline.
- `src/linking/` — link a comment to its rejected hunk, find the likely accepted fix,
  and score linkage quality (high/medium/unknown).
- `src/classify/` — classify review intent (actionable/architecture/testing/security/style/question).
- `src/clustering/` — cluster equivalent episodes and infer path/language scope.
- `src/conventions.ts` — top-level `buildConventions()` combining the above into `Convention[]`.
