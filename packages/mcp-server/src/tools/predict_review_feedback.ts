import type { ConventionStore } from "../store/conventionStore.js";
import { validateAgainstDiff } from "../validation/index.js";

export async function predictReviewFeedback(
  store: ConventionStore,
  input: { repository: string; diff: string },
) {
  return validateAgainstDiff(await store.all(input.repository), input.diff);
}
