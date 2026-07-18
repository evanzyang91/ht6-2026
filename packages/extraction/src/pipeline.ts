import {
  CONVENTIONS_FILE,
  DEFAULT_DATA_DIR,
  EPISODES_FILE,
  RAW_COMMENTS_FILE,
  type RawReviewComment,
} from "@ht6/shared";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractComments } from "./extract.js";
import { DeterministicSemanticAnalyzer } from "./semantic/deterministicSemanticAnalyzer.js";
import type { SemanticAnalyzer } from "./semantic/types.js";

export interface ExtractionResult {
  episodeCount: number;
  conventionCount: number;
  semanticProvider: string;
  semanticVersion: string;
}

function defaultDataDirectory(): string {
  const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
  return resolve(repositoryRoot, process.env.DATA_DIR ?? DEFAULT_DATA_DIR);
}

/** Rebuilds derived memory atomically from the persisted raw-review snapshot. */
export async function runExtraction(
  dataDirectory = defaultDataDirectory(),
  analyzer: SemanticAnalyzer = new DeterministicSemanticAnalyzer()
): Promise<ExtractionResult> {
  const dataDir = resolve(dataDirectory);
  const parsed: unknown = JSON.parse(await readFile(resolve(dataDir, RAW_COMMENTS_FILE), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${RAW_COMMENTS_FILE} must contain a JSON array`);
  const comments = parsed as RawReviewComment[];
  const { episodes, conventions } = await extractComments(comments, analyzer);

  await mkdir(dataDir, { recursive: true });
  for (const [name, value] of [[EPISODES_FILE, episodes], [CONVENTIONS_FILE, conventions]] as const) {
    const target = resolve(dataDir, name);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, target);
  }

  return {
    episodeCount: episodes.length,
    conventionCount: conventions.length,
    semanticProvider: analyzer.provider,
    semanticVersion: analyzer.version,
  };
}
