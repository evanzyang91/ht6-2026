import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface RepositoryPipelineState {
  ingestionVersion: number;
  extractionVersion: number;
  lastIngestedAt?: string;
  lastExtractedAt?: string;
  lastMergedPullRequest?: number;
  lastError?: string;
}

export type PipelineState = Record<string, RepositoryPipelineState>;

function statePath(dataDirectory = process.env.DATA_DIR ?? "data"): string {
  return resolve(dataDirectory, "pipeline-state.json");
}

export async function loadPipelineState(dataDirectory?: string): Promise<PipelineState> {
  try {
    return JSON.parse(await readFile(statePath(dataDirectory), "utf8")) as PipelineState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function savePipelineState(state: PipelineState, dataDirectory?: string): Promise<void> {
  const target = statePath(dataDirectory);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

// `changed` defaults to true (preserves prior behavior for existing callers). Pass
// `{ changed: false }` when a merged PR was confirmed and processed but contributed no data
// that wasn't already stored (e.g. zero review comments, or a duplicate/no-op run) — bookkeeping
// (lastMergedPullRequest/lastIngestedAt) still updates, but ingestionVersion does not, so a
// no-op ingestion never triggers a downstream re-extraction.
export async function markRepositoryIngested(
  repository: string,
  pullRequest: number,
  dataDirectory?: string,
  options?: { changed?: boolean },
): Promise<void> {
  const changed = options?.changed ?? true;
  const state = await loadPipelineState(dataDirectory);
  const current = state[repository] ?? { ingestionVersion: 0, extractionVersion: 0 };
  state[repository] = {
    ...current,
    ingestionVersion: changed ? current.ingestionVersion + 1 : current.ingestionVersion,
    lastIngestedAt: new Date().toISOString(),
    lastMergedPullRequest: pullRequest,
    lastError: undefined,
  };
  await savePipelineState(state, dataDirectory);
}

export async function markRepositoryExtracted(repository: string, version: number, dataDirectory?: string): Promise<void> {
  await markRepositoriesExtracted({ [repository]: version }, dataDirectory);
}

export async function markRepositoriesExtracted(versions: Record<string, number>, dataDirectory?: string): Promise<void> {
  const state = await loadPipelineState(dataDirectory);
  const extractedAt = new Date().toISOString();
  for (const [repository, version] of Object.entries(versions)) {
    const current = state[repository] ?? { ingestionVersion: version, extractionVersion: 0 };
    state[repository] = {
      ...current,
      extractionVersion: Math.max(current.extractionVersion, version),
      lastExtractedAt: extractedAt,
      lastError: undefined,
    };
  }
  await savePipelineState(state, dataDirectory);
}

export async function markRepositoryMemoryFailed(
  repository: string,
  error: string,
  dataDirectory?: string,
): Promise<void> {
  const state = await loadPipelineState(dataDirectory);
  const current = state[repository] ?? { ingestionVersion: 0, extractionVersion: 0 };
  state[repository] = { ...current, lastError: error };
  await savePipelineState(state, dataDirectory);
}
