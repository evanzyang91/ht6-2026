import type { RawComment } from "@ht6/shared";
import { JsonStore } from "./jsonStore.js";

// Persistence contract for ingested data. Swappable JSON <-> SQLite without touching
// the rest of the ingestion package.
export interface Store {
  load(repository: string): Promise<RawComment[]>;
  save(repository: string, comments: RawComment[]): Promise<void>;
}

// JSON is the supported hackathon store; this factory is the production adapter seam.
export function createStore(): Store {
  return new JsonStore();
}
