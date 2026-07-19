import type { CommentIntent, Convention, ConventionDetection } from "@ht6/shared";
import { Pool } from "pg";
import type { ConventionStore, StoredMemoryStatus } from "./conventionStore.js";

interface ConventionRow {
  convention_key: string;
  title: string;
  rule: string;
  rationale: string;
  category: string;
  path_scopes: string[];
  languages: string[];
  prohibited_signals: string[];
  preferred_signals: string[];
  detection: unknown | null;
  confidence: number;
  episode_key: string | null;
  pull_request: number | null;
  reviewer: string | null;
  file_path: string | null;
  review_comment: string | null;
  rejected_code: string | null;
  accepted_code: string | null;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function storedDetection(value: unknown): ConventionDetection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.mode !== "forbidden-signal" && item.mode !== "missing-required-signal" && item.mode !== "semantic") {
    throw new Error(`Unknown stored convention detection mode: ${String(item.mode)}`);
  }
  if (item.matchScope !== "line" && item.matchScope !== "file") {
    throw new Error(`Unknown stored convention detection scope: ${String(item.matchScope)}`);
  }
  if (typeof item.semanticDescription !== "string"
    || !stringArray(item.triggerSignals)
    || !stringArray(item.forbiddenSignals)
    || !stringArray(item.requiredSignals)) {
    throw new Error("Invalid stored convention detection payload");
  }
  return {
    mode: item.mode,
    semanticDescription: item.semanticDescription,
    triggerSignals: item.triggerSignals,
    forbiddenSignals: item.forbiddenSignals,
    requiredSignals: item.requiredSignals,
    matchScope: item.matchScope,
  };
}

function sharedIntent(value: string): CommentIntent {
  const values: Record<string, CommentIntent> = {
    ACTIONABLE: "actionable-change",
    ARCHITECTURE: "architecture",
    TESTING: "testing",
    SECURITY: "security",
    STYLE: "style",
    QUESTION: "question-nonactionable",
  };
  const intent = values[value];
  if (!intent) throw new Error(`Unknown stored comment intent: ${value}`);
  return intent;
}

/** Read-only adapter over the active immutable extraction run. */
export class PostgresConventionStore implements ConventionStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async all(repository: string): Promise<Convention[]> {
    const result = await this.pool.query<ConventionRow>(`
      SELECT
        c.convention_key, c.title, c.rule, c.rationale, c.category::text,
        c.path_scopes, c.languages, c.prohibited_signals, c.preferred_signals, c.detection,
        c.confidence,
        e.episode_key, e.pull_request, e.reviewer, e.file_path,
        e.review_comment, e.rejected_code, e.accepted_code
      FROM repositories r
      JOIN extraction_runs run ON run.id = r.active_extraction_run_id
      JOIN conventions c ON c.run_id = run.id
      LEFT JOIN convention_evidence ce ON ce.convention_id = c.id
      LEFT JOIN review_episodes e ON e.id = ce.episode_id
      WHERE r.slug = $1 AND run.status = 'PUBLISHED'
      ORDER BY c.confidence DESC, c.id, ce.position
    `, [repository]);

    const conventions = new Map<string, Convention>();
    for (const row of result.rows) {
      let convention = conventions.get(row.convention_key);
      if (!convention) {
        convention = {
          id: row.convention_key,
          repository,
          title: row.title,
          rule: row.rule,
          rationale: row.rationale,
          category: sharedIntent(row.category),
          pathScopes: row.path_scopes,
          languages: row.languages,
          prohibitedSignals: row.prohibited_signals,
          preferredSignals: row.preferred_signals,
          detection: storedDetection(row.detection),
          confidence: row.confidence,
          supportingEpisodes: [],
          evidence: [],
        };
        conventions.set(row.convention_key, convention);
      }
      if (row.episode_key && row.pull_request !== null && row.reviewer && row.file_path
        && row.review_comment !== null && row.rejected_code !== null) {
        convention.supportingEpisodes.push(row.episode_key);
        convention.evidence.push({
          episodeId: row.episode_key,
          pullRequest: row.pull_request,
          reviewer: row.reviewer,
          filePath: row.file_path,
          reviewComment: row.review_comment,
          rejectedCode: row.rejected_code,
          acceptedCode: row.accepted_code ?? undefined,
        });
      }
    }
    return [...conventions.values()];
  }

  async inspect(repository: string): Promise<StoredMemoryStatus> {
    const result = await this.pool.query<{
      active_extraction_run_id: string | null;
      latest_status: string | null;
      convention_count: number | null;
      latest_error: string | null;
    }>(`
      SELECT r.active_extraction_run_id, active.convention_count,
        latest.status::text AS latest_status, latest.error AS latest_error
      FROM repositories r
      LEFT JOIN extraction_runs active ON active.id = r.active_extraction_run_id
      LEFT JOIN LATERAL (
        SELECT status, error
        FROM extraction_runs
        WHERE repository_id = r.id
        ORDER BY started_at DESC
        LIMIT 1
      ) latest ON true
      WHERE r.slug = $1
    `, [repository]);
    const row = result.rows[0];
    return {
      processed: Boolean(row?.active_extraction_run_id),
      conventionCount: row?.convention_count ?? 0,
      failed: row?.latest_status === "FAILED",
      lastError: row?.latest_error ?? undefined,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
