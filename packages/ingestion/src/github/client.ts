import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";

// Single place that reads process.env.GITHUB_TOKEN — everything else takes a client instance.
const RetryableOctokit = Octokit.plugin(retry);

export type GitHubClient = InstanceType<typeof RetryableOctokit>;

export function createGitHubClient(): GitHubClient {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Copy .env.example to .env and fill in a personal access token."
    );
  }
  return new RetryableOctokit({ auth: token });
}
