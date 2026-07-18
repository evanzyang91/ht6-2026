import type { RawReviewComment } from "@ht6/shared";
import type { Store } from "./index.js";

// TODO: implement Store against data/raw-comments.json (read-merge-write for idempotency).
export class JsonStore implements Store {
  async load(repository: string): Promise<RawReviewComment[]> {
    throw new Error("not implemented");
  }

  async save(repository: string, comments: RawReviewComment[]): Promise<void> {
    throw new Error("not implemented");
  }
}
