import {
  CONVENTIONS_FILE,
  DEFAULT_DATA_DIR,
  EPISODES_FILE,
  RAW_COMMENTS_FILE,
  type RawComment,
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

export const EXTRACTION_PIPELINE_VERSION = "4";

function errorChain(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && messages.length < 4) {
    messages.push(current.message);
    current = current.cause;
  }
  if (!messages.length) messages.push(String(error));
  return messages.join(" <- ");
}

function episodeLabel(input: { repository: string; pullRequest: number; filePath?: string; reviewComment: string }): string {
  const review = input.reviewComment.replace(/\s+/g, " ").trim();
  const summary = review.length > 120 ? `${review.slice(0, 117)}...` : review;
  return `${input.repository}#${input.pullRequest} ${input.filePath ?? "(no file)"} review=${JSON.stringify(summary)}`;
}

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
  // RAW_COMMENTS_FILE holds inline, review-summary, and conversation comments (the full
  // RawComment union). extractComments branches per comment type internally — inline comments go
  // through hunk-linking, review-summary/conversation comments (no file/diff to anchor to) go
  // through the PR-level path. Records with no `type` at all predate the three-way split and are
  // treated as inline, same as before.
  const comments = parsed as RawComment[];
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
    onAttemptFailure: ({ attempt, maxAttempts, willRetry, error, input }) => {
      process.stderr.write(
        `Semantic analyzer attempt ${attempt}/${maxAttempts} failed for ${episodeLabel(input)}; `
        + `${willRetry ? "retrying" : "no retries remain"}: ${errorChain(error)}\n`,
      );
    },
    onDetectionFallback: ({ reason, originalMode, replacementMode, input }) => {
      process.stderr.write(
        `Semantic detection fallback for ${episodeLabel(input)}; reason=${reason}; `
        + `mode=${JSON.stringify(originalMode)} -> ${replacementMode}; preserving Freesolo semantics\n`,
      );
    },
    onFallback: (error, input) => {
      process.stderr.write(
        `Semantic analyzer fallback for ${episodeLabel(input)}; using deterministic analysis: ${errorChain(error)}\n`,
      );
    },
  });
  process.stderr.write(
    `Engineering Memory semantic analyzer: ${configuredAnalyzer.provider}@${configuredAnalyzer.version}\n`,
  );
  const publisher = process.env.DATABASE_URL
    ? createPrismaExtractionPublisher(process.env.DATABASE_URL)
    : undefined;
  try {
    return await runExtraction(dataDirectory, configuredAnalyzer, publisher);
  } finally {
    await publisher?.close();
  }
}
