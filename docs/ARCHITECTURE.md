# Engineering Memory architecture

## Product boundary

This system is a memory compiler, not a code-review chatbot. It converts private historical review
events into versioned, scoped, evidence-backed conventions. MCP clients consume the compiled
memory before generation and use the same memory to validate a diff afterward.

```text
GitHub PRs/comments/files
        |
        v
RawReviewComment (immutable source record)
        |
        v
ReviewEpisode = rejected code + review intent + accepted code + linkage quality
        |
        v
Convention = normalized rule + scope + signals + confidence + evidence
        |
        +--> hybrid retrieval (repo/scope + lexical; embeddings are optional)
        +--> deterministic diff validation (path + imports/calls/signals)
        |
        v
MCP tools used before and after code generation
```

Raw GitHub data remains behind the compilation boundary. MCP responses contain derived knowledge
and compact provenance only. Every prediction must point back to a convention and supporting PRs.

## Mapping a review into reusable memory

1. Anchor the inline comment to its diff hunk and record the proposed code as `rejectedCode`.
2. Compare the same file/region with the merged PR patch and infer `acceptedCode`.
3. Grade the link: `high` for a changed same-region replacement, `medium` for heuristic linkage,
   and `unknown` when no replacement can be established.
4. Classify intent. Exclude non-actionable questions from convention clustering.
5. Cluster on **comment + rejected code + accepted code**, within repository and intent. Comment
   text alone cannot disambiguate “same as above” or “fix this.”
6. Compile each cluster into a convention. Infer its path/language scope, prohibited/preferred code
   signals, distinct-PR support, confidence, and evidence.

The current implementation is deterministic and deliberately conservative. Production extraction
should fetch file content at the comment commit and merge commit (not only patches), align AST nodes,
and retain extraction model/prompt versions for reproducibility.

## Convention representation

A convention is an executable policy with provenance:

```json
{
  "id": "stable-id",
  "repository": "acme/api",
  "title": "No direct Prisma access in controllers",
  "rule": "Controllers must access persistence through services.",
  "rationale": "Observed in 4 pull requests; 3 include an accepted replacement.",
  "category": "architecture",
  "pathScopes": ["src/controllers/**"],
  "languages": ["typescript"],
  "prohibitedSignals": ["prisma.user.findMany"],
  "preferredSignals": ["userService.list"],
  "detection": {
    "mode": "forbidden-signal",
    "semanticDescription": "A controller accesses Prisma directly.",
    "triggerSignals": [],
    "forbiddenSignals": ["prisma.user.findMany"],
    "requiredSignals": [],
    "matchScope": "line"
  },
  "confidence": 0.89,
  "supportingEpisodes": ["episode-a", "episode-b"],
  "evidence": [{ "pullRequest": 142, "rejectedCode": "...", "acceptedCode": "..." }]
}
```

Detection is hybrid: `semanticDescription` preserves the broader English condition, while exact
signals support fast deterministic checks. `triggerSignals` constrain when a forbidden pattern is
relevant. A `missing-required-signal` rule instead fires when its trigger is present but required
code is absent. `semantic` rules use the optional model fallback. Older convention records without
`detection` continue to use their flat `prohibitedSignals` behavior.

Keep confidence separate from severity. Confidence measures whether the convention is real; severity
describes the cost of violating it and should be added once the team has a reliable taxonomy.

## Database

The hackathon runtime uses atomic JSON files so all stages can run independently. The production
relational schema is in [`schema.sql`](./schema.sql). PostgreSQL plus `pgvector` is sufficient:

- relational tables preserve lineage and allow audits/recomputation;
- JSONB stores source-specific metadata without destabilizing the schema;
- vector columns support semantic candidate generation;
- no graph database is needed for the MVP. SQL joins cover repository, PR, reviewer, episode,
  convention, and evidence relationships.

A graph becomes useful only when cross-repository inheritance, ownership, supersession, and policy
dependencies become first-class product features.

## Retrieval and validation

Use a hybrid pipeline:

1. hard-filter repository and applicable path/language scope;
2. retrieve lexical matches over rule, rationale, category, and signals;
3. optionally union semantic embedding candidates;
4. rerank using query relevance, convention confidence, distinct-PR support, recency, and scope
   specificity;
5. validate diffs with deterministic AST/import/call matchers first;
6. use a model only for conventions that cannot be expressed as executable signals.

AST matching is valuable for high-precision validation, but it is language-specific. Add Tree-sitter
after the demo works. A knowledge graph is not on the critical path.

## MCP surface

- `get_repo_conventions`: pre-generation retrieval, optionally scoped by path/language/task.
- `find_similar_rejected_patterns`: rejected/accepted examples for a planned change.
- `predict_review_feedback`: post-generation diff validation with PR evidence.
- `explain_engineering_decision`: rationale and provenance for a convention.
- `summarize_personal_review_history`: reviewer-specific recurring categories and rules.

Inputs are compact and task-oriented. Outputs are derived memory, never a raw PR export. MCP should
not mutate conventions during an agent request.

## Where Freesolo adds value

Freesolo is justified in the offline compiler where one inference benefits every future request:

- classify ambiguous review intent;
- normalize paraphrases into a canonical rule;
- infer a concise label and rationale from comment/code pairs;
- decide whether two candidate clusters express the same convention;
- rerank ambiguous historical evidence.

It does not add defensible value merely generating review prose. Keep deterministic linking,
provenance, storage, scope filters, and AST checks outside Freesolo. Store model version, prompt
version, input hashes, and output confidence so conventions can be rebuilt and audited. Treat review
text as untrusted input and isolate it from tool/system instructions.

Runtime selection is backend-only. `ENGINEERING_MEMORY_SEMANTIC_ANALYZER=freesolo` selects the
OpenAI-compatible Freesolo analyzer for configured extraction; the default remains deterministic.
Hosted responses cross a strict validation boundary before persistence, calls have bounded
concurrency/timeouts/retries, and exhausted or invalid calls use the deterministic analyzer unless
the operator explicitly disables fallback. End users never need the Freesolo credential.

## 24–36 hour delivery plan

Ship the vertical slice already represented by this repository: ingest 50–75 merged PRs, compile
review episodes and at least three repeated conventions, serve the MCP tools, and demonstrate the
before/after agent loop on one repository. Prefer a curated demo repository if review density is low.

Do not put these on the critical path: graph database, organization-wide learning, online convention
mutation, multi-language AST coverage, fine-tuning, or a polished dashboard.

### Four-person ownership

1. **GitHub/data:** ingestion, permissions, pagination, rate limits, commit/file snapshots, and a
   clean demo dataset.
2. **Memory compiler:** comment/hunk/fix linkage, intent classification, clustering, confidence, and
   evaluation of the top conventions.
3. **Retrieval/validation:** scope filters, lexical/embedding retrieval, reranking, diff parsing, and
   deterministic/AST checks.
4. **MCP/demo/integration:** tool contracts, MCP client configuration, end-to-end demo script,
   observability, pitch, and fallback fixtures.

All four share the types in `@ht6/shared` and the JSON interchange contract. Freeze those shapes early
and integrate at least twice before the final demo window.
