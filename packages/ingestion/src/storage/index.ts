import type { RawComment } from "@ht6/shared";
import { JsonStore } from "./jsonStore.js";
import { resolve } from "node:path";

// Persistence contract for ingested data. Swappable JSON <-> SQLite without touching
// the rest of the ingestion package.
export interface Store {
  load(repository: string): Promise<RawComment[]>;
  save(repository: string, comments: RawComment[]): Promise<void>;
}

// JSON is the supported hackathon store; this factory is the production adapter seam.
export function createStore(dataDirectory?: string): Store {
  return dataDirectory
    ? new JsonStore(resolve(dataDirectory, "raw-comments.json"))
    : new JsonStore();
}
