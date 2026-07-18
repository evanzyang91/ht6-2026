import {
  ensureMemoryFresh,
  loadPipelineState,
  markRepositoryExtracted,
  markRepositoryMemoryFailed,
} from "@ht6/pipeline";
import type { Convention } from "@ht6/shared";
import { ingest, type IngestionProgress } from "@ht6/ingestion";
import { runExtraction } from "@ht6/extraction";
import { JsonConventionStore } from "./store/jsonConventionStore.js";
import { validateAgainstDiff, type PredictedFeedback } from "./validation/index.js";
import { resolve } from "node:path";

export interface EngineeringMemoryValidationResult {
  conventionCount: number;
  findings: PredictedFeedback[];
}

export interface EngineeringMemorySnapshot {
  repository: string;
  conventions: Convention[];
}

export type RepositoryMemoryStatus = "unprocessed" | "stale" | "ready" | "empty" | "failed";

export interface RepositoryMemoryInspection {
  repository: string;
  status: RepositoryMemoryStatus;
  conventionCount: number;
  lastError?: string;
}

export interface MemoryInitializationProgress extends IngestionProgress {}

export interface MemoryInitializationResult {
  repository: string;
  commentCount: number;
  episodeCount: number;
  conventionCount: number;
}

export async function inspectRepositoryMemory(
  repository: string,
  options: { dataDirectory?: string } = {},
): Promise<RepositoryMemoryInspection> {
  const dataDirectory = options.dataDirectory ?? process.env.DATA_DIR ?? "data";
  const [state, conventions] = await Promise.all([
    loadPipelineState(dataDirectory),
    new JsonConventionStore(resolve(dataDirectory, "conventions.json")).all(repository),
  ]);
  const repositoryState = state[repository];
  let status: RepositoryMemoryStatus;
  if (repositoryState?.lastError) status = "failed";
  else if (repositoryState && repositoryState.extractionVersion < repositoryState.ingestionVersion) status = "stale";
  else if (conventions.length) status = "ready";
  else if (repositoryState?.lastExtractedAt) status = "empty";
  else status = "unprocessed";
  return { repository, status, conventionCount: conventions.length, lastError: repositoryState?.lastError };
}

/** Backfills GitHub history and compiles repository memory using an ephemeral credential. */
export async function initializeRepositoryMemory(
  repository: string,
  options: {
    token: string;
    dataDirectory?: string;
    limit?: number;
    onProgress?: (progress: MemoryInitializationProgress) => void;
  },
): Promise<MemoryInitializationResult> {
  const dataDirectory = options.dataDirectory ?? process.env.DATA_DIR ?? "data";
  try {
    const comments = await ingest(repository, {
      token: options.token,
      dataDirectory,
      limit: options.limit,
      persistEmptySnapshot: true,
      onProgress: options.onProgress,
    });
    options.onProgress?.({
      phase: "complete",
      current: 1,
      total: 1,
      message: "Compiling repository conventions…",
    });
    const extraction = await runExtraction(dataDirectory);
    const state = await loadPipelineState(dataDirectory);
    await markRepositoryExtracted(repository, state[repository]?.ingestionVersion ?? 0, dataDirectory);
    const snapshot = await loadRepositoryMemory(repository, { dataDirectory });
    return {
      repository,
      commentCount: comments.length,
      episodeCount: extraction.episodeCount,
      conventionCount: snapshot.conventions.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markRepositoryMemoryFailed(repository, message, dataDirectory);
    throw error;
  }
}

/**
 * Ingests newly merged PRs for a repository without running extraction — the editor-integration
 * equivalent of the webhook path's ingestMergedPullRequest, for a background poll that shouldn't
 * force a full extraction pass on every tick. ingest() already skips PRs already represented in
 * the store, so a poll where nothing new has merged costs one PR-list request, not a re-scrape.
 * Extraction stays lazy: the next loadRepositoryMemory/validateRepositoryDiff call (via
 * ensureMemoryFresh) picks up the bumped ingestion version and compiles memory then.
 */
export async function refreshRepositoryMemory(
  repository: string,
  options: { token: string; dataDirectory?: string; limit?: number },
): Promise<{ repository: string; commentCount: number }> {
  const dataDirectory = options.dataDirectory ?? process.env.DATA_DIR ?? "data";
  try {
    const comments = await ingest(repository, {
      token: options.token,
      dataDirectory,
      limit: options.limit,
    });
    return { repository, commentCount: comments.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markRepositoryMemoryFailed(repository, message, dataDirectory);
    throw error;
  }
}

/** Read-only snapshot used by editor integrations to explain the currently compiled memory. */
export async function loadRepositoryMemory(
  repository: string,
  options: { dataDirectory?: string } = {},
): Promise<EngineeringMemorySnapshot> {
  const dataDirectory = options.dataDirectory ?? process.env.DATA_DIR ?? "data";
  await ensureMemoryFresh(repository, dataDirectory);
  const conventions = await new JsonConventionStore(resolve(dataDirectory, "conventions.json")).all(repository);
  return { repository, conventions };
}

/** Stable client API shared by MCP, pre-commit, and editor integrations. */
export async function validateRepositoryDiff(
  repository: string,
  diff: string,
  options: { dataDirectory?: string } = {},
): Promise<EngineeringMemoryValidationResult> {
  const dataDirectory = options.dataDirectory ?? process.env.DATA_DIR ?? "data";
  const { conventions } = await loadRepositoryMemory(repository, { dataDirectory });
  return { conventionCount: conventions.length, findings: await validateAgainstDiff(conventions, diff) };
}

export type { PredictedFeedback } from "./validation/index.js";
