import type { Convention } from "@ht6/shared";
import type { ConventionStore } from "./conventionStore.js";

// TODO: implement ConventionStore by reading data/conventions.json.
export class JsonConventionStore implements ConventionStore {
  async all(repository: string): Promise<Convention[]> {
    throw new Error("not implemented");
  }
}
