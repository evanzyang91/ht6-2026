import type { RawReviewComment } from "@ht6/shared";
import type { Store } from "./index.js";

// Production adapter seam. The target relational schema is documented in docs/schema.sql.
export class SqliteStore implements Store {
  async load(repository: string): Promise<RawReviewComment[]> {
    throw new Error(`SQLite ingestion store is not enabled for ${repository}; use the JSON store`);
  }

  async save(repository: string, comments: RawReviewComment[]): Promise<void> {
    throw new Error(`SQLite ingestion store is not enabled for ${repository}; use the JSON store (${comments.length} records were not written)`);
  }
}
