import type { RawReviewComment } from "@ht6/shared";
import { JsonStore } from "./jsonStore.js";

// Persistence contract for ingested data. Swappable JSON <-> SQLite without touching
// the rest of the ingestion package.
export interface Store {
  load(repository: string): Promise<RawReviewComment[]>;
  save(repository: string, comments: RawReviewComment[]): Promise<void>;
}

export function createStore(): Store {
  return new JsonStore();
}
