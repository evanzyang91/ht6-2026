import type { Convention } from "@ht6/shared";
import type { ConventionStore } from "./conventionStore.js";

// TODO (stretch): implement ConventionStore against SQLite. Schema TBD.
export class SqliteConventionStore implements ConventionStore {
  async all(repository: string): Promise<Convention[]> {
    throw new Error("not implemented");
  }
}
