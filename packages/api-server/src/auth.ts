import { createHash } from "node:crypto";
import type { RepositoryAuthorizer } from "./schema.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const accessCache = new Map<string, number>();

/** Confirms that the supplied GitHub token can read the requested repository. */
export const authorizeGitHubRepository: RepositoryAuthorizer = async (repository, token) => {
  const key = createHash("sha256").update(`${token}:${repository}`).digest("hex");
  if ((accessCache.get(key) ?? 0) > Date.now()) return;
  const response = await fetch(`https://api.github.com/repos/${repository}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "engineering-memory-api",
    },
  });
  if (!response.ok) {
    throw new Error(response.status === 404
      ? `Repository ${repository} is unavailable to the authenticated GitHub user`
      : `GitHub authorization failed (${response.status})`);
  }
  accessCache.set(key, Date.now() + CACHE_TTL_MS);
};
