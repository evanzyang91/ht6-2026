import { ensureMemoryFresh } from "@ht6/pipeline";
import { JsonConventionStore } from "./store/jsonConventionStore.js";
import { validateAgainstDiff, type PredictedFeedback } from "./validation/index.js";
import { resolve } from "node:path";

export interface EngineeringMemoryValidationResult {
  conventionCount: number;
  findings: PredictedFeedback[];
}

/** Stable client API shared by MCP, pre-commit, and editor integrations. */
export async function validateRepositoryDiff(
  repository: string,
  diff: string,
  options: { dataDirectory?: string } = {},
): Promise<EngineeringMemoryValidationResult> {
  const dataDirectory = options.dataDirectory ?? process.env.DATA_DIR ?? "data";
  await ensureMemoryFresh(repository, dataDirectory);
  const conventions = await new JsonConventionStore(resolve(dataDirectory, "conventions.json")).all(repository);
  return { conventionCount: conventions.length, findings: await validateAgainstDiff(conventions, diff) };
}

export type { PredictedFeedback } from "./validation/index.js";
