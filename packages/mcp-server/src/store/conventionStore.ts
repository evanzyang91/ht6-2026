import type { Convention } from "@ht6/shared";
import { JsonConventionStore } from "./jsonConventionStore.js";
import { PostgresConventionStore } from "./postgresConventionStore.js";

export interface StoredMemoryStatus {
  processed: boolean;
  conventionCount: number;
  failed: boolean;
  lastError?: string;
}

// Query surface both retrieval and validation are built against. Swappable JSON <-> SQLite.
export interface ConventionStore {
  all(repository: string): Promise<Convention[]>;
  inspect?(repository: string): Promise<StoredMemoryStatus>;
  close?(): Promise<void>;
}

// JSON is the supported hackathon store; this factory is the production adapter seam.
export function createConventionStore(): ConventionStore {
  const connectionString = process.env.DATABASE_READ_URL ?? process.env.DATABASE_URL;
  if (connectionString) return new PostgresConventionStore(connectionString);
  return new JsonConventionStore();
}
