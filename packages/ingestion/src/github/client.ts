import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { AsyncLocalStorage } from "node:async_hooks";

// Single place that reads process.env.GITHUB_TOKEN. Retry-plugin-wrapped for automatic backoff
// on secondary rate limits / 5xx, on top of the manual withRateLimitRetry() used around
// individual calls. Typed as plain Octokit (not InstanceType<typeof RetryableOctokit>) — the
// retry plugin only changes internal request behavior, it doesn't add new public methods, and
// using the base Octokit type keeps declaration output portable (see TS2742).
const RetryableOctokit = Octokit.plugin(retry);
const injectedToken = new AsyncLocalStorage<string>();

/** Makes a credential available only to GitHub calls spawned by this async operation. */
export function withGitHubToken<T>(token: string, operation: () => Promise<T>): Promise<T> {
  if (!token.trim()) throw new Error("A non-empty GitHub token is required");
  return injectedToken.run(token, operation);
}

export function createGitHubClient(): Octokit {
  const auth = injectedToken.getStore() ?? process.env.GITHUB_TOKEN;
  if (!auth) throw new Error("GITHUB_TOKEN is required to ingest GitHub history");
  return new RetryableOctokit({ auth, userAgent: "engineering-memory-hackathon" });
}
