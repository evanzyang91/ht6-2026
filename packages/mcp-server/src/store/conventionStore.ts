import type { Convention } from "@ht6/shared";

// Query surface both retrieval and validation are built against. Swappable JSON <-> SQLite.
export interface ConventionStore {
  all(repository: string): Promise<Convention[]>;
}

// TODO: pick JSON vs SQLite based on config/env and return the right implementation.
export function createConventionStore(): ConventionStore {
  throw new Error("not implemented");
}
