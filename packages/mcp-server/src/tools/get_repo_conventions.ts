import type { ConventionStore } from "../store/conventionStore.js";
import { retrieveConventions, type RetrievalQuery } from "../retrieval/index.js";

export async function getRepoConventions(store: ConventionStore, input: RetrievalQuery) {
  return retrieveConventions(store, input);
}
