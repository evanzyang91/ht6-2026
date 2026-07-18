import { Octokit } from "@octokit/rest";

export function createGitHubClient(): Octokit {
  const auth = process.env.GITHUB_TOKEN;
  if (!auth) throw new Error("GITHUB_TOKEN is required to ingest GitHub history");
  return new Octokit({ auth, userAgent: "engineering-memory-hackathon" });
}
