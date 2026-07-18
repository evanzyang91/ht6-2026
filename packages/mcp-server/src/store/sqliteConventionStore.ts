import type { Convention } from "@ht6/shared";
import type { ConventionStore } from "./conventionStore.js";

// Production adapter seam. The target relational schema is documented in docs/schema.sql.
export class SqliteConventionStore implements ConventionStore {
  async all(repository: string): Promise<Convention[]> {
    throw new Error(`SQLite convention store is not enabled for ${repository}; use the JSON store`);
  }
}
