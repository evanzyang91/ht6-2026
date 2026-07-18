import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";

// Single place that reads process.env.GITHUB_TOKEN — everything else takes a client instance.
const RetryableOctokit = Octokit.plugin(retry);

// Typed as plain Octokit (not InstanceType<typeof RetryableOctokit>) — the retry plugin only
// changes internal request behavior, it doesn't add new public methods, and using the base
// Octokit type here keeps declaration output portable (see TS2742).
export type GitHubClient = Octokit;

export function createGitHubClient(): GitHubClient {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Copy .env.example to .env and fill in a personal access token."
    );
  }
  return new RetryableOctokit({ auth: token });
}
