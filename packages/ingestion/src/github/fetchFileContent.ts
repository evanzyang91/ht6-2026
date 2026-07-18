import { createGitHubClient } from "./client.js";
import { withRateLimitRetry } from "./rateLimit.js";

// Fetches the exact content of a file at a specific commit — used instead of relying only on
// PR patches, which GitHub can truncate/omit for large diffs. Returns undefined (not a thrown
// error) when the file doesn't exist at that ref: deleted, renamed away, or the ref itself is
// unreachable. Callers are expected to treat "no content" as an acceptable, common outcome.
export async function fetchFileContentAtRef(
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | undefined> {
  const client = createGitHubClient();
  try {
    const response = await withRateLimitRetry(() =>
      client.repos.getContent({ owner, repo, path, ref })
    );
    const file = response.data;
    if (Array.isArray(file) || file.type !== "file" || !("content" in file)) return undefined;
    return Buffer.from(file.content, "base64").toString("utf8");
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error
      ? Number((error as { status: unknown }).status) : 0;
    if (status === 404) return undefined;
    throw error;
  }
}
