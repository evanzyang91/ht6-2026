import { runConfiguredExtraction } from "@ht6/extraction";
import { loadPipelineState, markRepositoriesExtracted } from "./state.js";

let activeRefresh: Promise<void> | undefined;

/** Ensures an MCP request observes all merged PRs ingested before the request began. */
export async function ensureMemoryFresh(repository: string, dataDirectory = process.env.DATA_DIR ?? "data"): Promise<void> {
  while (true) {
    const state = await loadPipelineState(dataDirectory);
    const repositoryState = state[repository];
    if (!repositoryState || repositoryState.extractionVersion >= repositoryState.ingestionVersion) return;
    if (activeRefresh) {
      await activeRefresh;
      continue;
    }
    const staleVersions = Object.fromEntries(Object.entries(state)
      .filter(([, item]) => item.extractionVersion < item.ingestionVersion)
      .map(([slug, item]) => [slug, item.ingestionVersion]));
    activeRefresh = (async () => {
      await runConfiguredExtraction(dataDirectory);
      await markRepositoriesExtracted(staleVersions, dataDirectory);
    })().finally(() => { activeRefresh = undefined; });
    await activeRefresh;
  }
}
