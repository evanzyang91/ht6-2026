// TODO: fetch changed files + patches for a PR, and the merged commit SHA, to backfill
// RawReviewComment.mergedCommitSha and support stage 2's accepted-fix lookup.
export async function fetchChangedFilesAndPatches(
  owner: string,
  repo: string,
  pullRequest: number
) {
  throw new Error("not implemented");
}
