import { createGitHubClient } from "./client.js";
import { paginateAll } from "./paginate.js";
import { withRateLimitRetry } from "./rateLimit.js";

export interface ChangedFilePatch { filePath: string; patch?: string }

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
  return files.map((file) => ({ filePath: file.filename, patch: file.patch }));
}
