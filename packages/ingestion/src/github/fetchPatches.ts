import { createGitHubClient } from "./client.js";
import { paginateAll } from "./paginate.js";
import { withRateLimitRetry } from "./rateLimit.js";

export interface ChangedFilePatch {
  filePath: string;
  /** Set only when this file was renamed — the path it had before the PR. */
  previousFilePath?: string;
  status: string;
  patch?: string;
  /**
   * True when GitHub omitted `patch` for a file that actually changed (large diff) — the
   * caller should not treat a missing patch as "no changes" in that case, and should prefer
   * fetching exact file content instead.
   */
  truncated: boolean;
}

export async function fetchChangedFilesAndPatches(
  owner: string,
  repo: string,
  pullRequest: number
): Promise<ChangedFilePatch[]> {
  const client = createGitHubClient();
  const files = await paginateAll(async (page) => {
    const response = await withRateLimitRetry(() => client.pulls.listFiles({
      owner, repo, pull_number: pullRequest, per_page: 100, page,
    }));
    return response.data;
  });
  return files.map((file) => ({
    filePath: file.filename,
    previousFilePath: file.status === "renamed" ? file.previous_filename : undefined,
    status: file.status,
    patch: file.patch,
    truncated: file.status !== "removed" && !file.patch && file.changes > 0,
  }));
}
