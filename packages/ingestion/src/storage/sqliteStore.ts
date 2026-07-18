import type { RawReviewComment } from "@ht6/shared";
import type { Store } from "./index.js";

// TODO (stretch): implement Store against SQLite. Schema TBD — see docs/DATA_FORMAT.md.
export class SqliteStore implements Store {
  async load(repository: string): Promise<RawReviewComment[]> {
    throw new Error("not implemented");
  }

  async save(repository: string, comments: RawReviewComment[]): Promise<void> {
    throw new Error("not implemented");
  }
}
