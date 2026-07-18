// Stage 2 (extraction) final output / stage 3 (mcp-server) input. A generalized rule inferred
// from one or more ReviewEpisodes. Persisted to data/conventions.json.
export interface Convention {
  id: string;
  repository: string;
  title: string;
  rule: string;
  rationale: string;
  category: string;
  pathScopes: string[];
  languages: string[];
  prohibitedSignals: string[];
  preferredSignals: string[];
  confidence: number;
  supportingEpisodes: string[];
}
