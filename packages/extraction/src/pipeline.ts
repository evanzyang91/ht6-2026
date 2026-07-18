import {
  CONVENTIONS_FILE,
  DEFAULT_DATA_DIR,
  EPISODES_FILE,
  RAW_COMMENTS_FILE,
  type RawComment,
  type RawReviewComment,
} from "@ht6/shared";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractComments } from "./extract.js";
import { DeterministicSemanticAnalyzer } from "./semantic/deterministicSemanticAnalyzer.js";
import { createSemanticAnalyzerFromEnv } from "./semantic/createSemanticAnalyzer.js";
import type { SemanticAnalyzer } from "./semantic/types.js";
import type { ExtractionPublisher } from "./storage/types.js";
import { createPrismaExtractionPublisher } from "./storage/prismaExtractionPublisher.js";

export interface ExtractionResult {
  episodeCount: number;
  conventionCount: number;
  semanticProvider: string;
  semanticVersion: string;
  publishedRepositoryCount: number;
}

export const EXTRACTION_PIPELINE_VERSION = "1";

function defaultDataDirectory(): string {
  const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
  return resolve(repositoryRoot, process.env.DATA_DIR ?? DEFAULT_DATA_DIR);
}

/** Rebuilds derived memory atomically from the persisted raw-review snapshot. */
export async function runExtraction(
  dataDirectory = defaultDataDirectory(),
  analyzer: SemanticAnalyzer = new DeterministicSemanticAnalyzer(),
  publisher?: ExtractionPublisher
): Promise<ExtractionResult> {
  const dataDir = resolve(dataDirectory);
  const parsed: unknown = JSON.parse(await readFile(resolve(dataDir, RAW_COMMENTS_FILE), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${RAW_COMMENTS_FILE} must contain a JSON array`);
  // RAW_COMMENTS_FILE now also holds review-summary and conversation comments (RawComment
  // union) alongside inline ones. Neither has a file/diff to anchor evidence to, so they're
  // excluded here rather than fed through hunk-linking — a natural extension point once this
  // pipeline is ready to derive episodes from them too. Records with no `type` at all predate
  // the three-way split and are treated as inline, same as before.
  const comments = (parsed as RawComment[]).filter(
    (comment): comment is RawReviewComment =>
      comment.type !== "review-summary" && comment.type !== "conversation"
  );
  const { episodes, conventions } = await extractComments(comments, analyzer);

  await mkdir(dataDir, { recursive: true });
  for (const [name, value] of [[EPISODES_FILE, episodes], [CONVENTIONS_FILE, conventions]] as const) {
    const target = resolve(dataDir, name);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, target);
  }

  const publication = await publisher?.publish({
    comments,
    episodes,
    conventions,
    analyzerProvider: analyzer.provider,
    analyzerVersion: analyzer.version,
    extractorVersion: EXTRACTION_PIPELINE_VERSION,
  });

  return {
    episodeCount: episodes.length,
    conventionCount: conventions.length,
    semanticProvider: analyzer.provider,
    semanticVersion: analyzer.version,
    publishedRepositoryCount: publication?.repositoryCount ?? 0,
  };
}

/** Runs extraction with the environment-configured database publisher when available. */
export async function runConfiguredExtraction(
  dataDirectory?: string,
  analyzer?: SemanticAnalyzer,
): Promise<ExtractionResult> {
  const configuredAnalyzer = analyzer ?? createSemanticAnalyzerFromEnv(process.env, {
    onFallback: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Freesolo semantic analysis failed; using deterministic fallback: ${message}\n`);
    },
  });
  const publisher = process.env.DATABASE_URL
    ? createPrismaExtractionPublisher(process.env.DATABASE_URL)
    : undefined;
  try {
    return await runExtraction(dataDirectory, configuredAnalyzer, publisher);
  } finally {
    await publisher?.close();
  }
}
