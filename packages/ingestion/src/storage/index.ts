import type { RawReviewComment } from "@ht6/shared";

// Persistence contract for ingested data. Swappable JSON <-> SQLite without touching
// the rest of the ingestion package.
export interface Store {
  load(repository: string): Promise<RawReviewComment[]>;
  save(repository: string, comments: RawReviewComment[]): Promise<void>;
}

// TODO: pick JSON vs SQLite based on config/env and return the right implementation.
export function createStore(): Store {
  throw new Error("not implemented");
}
