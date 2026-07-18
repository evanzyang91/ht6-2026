import type { Convention } from "@ht6/shared";
import { JsonConventionStore } from "./jsonConventionStore.js";

// Query surface both retrieval and validation are built against. Swappable JSON <-> SQLite.
export interface ConventionStore {
  all(repository: string): Promise<Convention[]>;
}

// JSON is the supported hackathon store; this factory is the production adapter seam.
export function createConventionStore(): ConventionStore {
  return new JsonConventionStore();
}
