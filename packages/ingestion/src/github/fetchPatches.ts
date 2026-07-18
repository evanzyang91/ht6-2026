import type { GitHubClient } from "./client.js";

export interface ChangedFile {
  filePath: string;
  status: string;
  patch?: string;
}

// Supplementary provenance data — full per-file patches for a PR, beyond the local diffHunk
// each review comment already carries. Not required by RawReviewComment or the ingestion
// success criterion; lower priority than the comment-fetching path.
export async function fetchChangedFilesAndPatches(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  return files.map((file): ChangedFile => ({
    filePath: file.filename,
    status: file.status,
    patch: file.patch,
  }));
}
