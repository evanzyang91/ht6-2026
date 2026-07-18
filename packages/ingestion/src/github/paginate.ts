import type { GitHubClient } from "./client.js";

type Paginate = GitHubClient["paginate"];

// Thin wrapper around octokit's own `paginate` — it already follows the Link header correctly,
// so callers use this exactly like `octokit.paginate(route, params)` with full type inference
// intact, no hand-rolled page-number looping.
export function createPaginator(octokit: GitHubClient): Paginate {
  return octokit.paginate.bind(octokit) as Paginate;
}
