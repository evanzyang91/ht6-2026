import { ingestMergedPullRequest } from "@ht6/ingestion";

interface PullRequestWebhook {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: { number?: number; merged?: boolean };
}

export interface WebhookResult {
  status: "ignored" | "ingested";
  reason?: string;
  repository?: string;
  pullRequest?: number;
  commentCount?: number;
}

export async function handleGitHubEvent(
  event: string | undefined,
  rawBody: Buffer,
  ingestPullRequest: typeof ingestMergedPullRequest = ingestMergedPullRequest,
): Promise<WebhookResult> {
  if (event !== "pull_request") return { status: "ignored", reason: "unsupported event" };
  const payload = JSON.parse(rawBody.toString("utf8")) as PullRequestWebhook;
  if (payload.action !== "closed" || payload.pull_request?.merged !== true) {
    return { status: "ignored", reason: "pull request was not merged" };
  }
  const repository = payload.repository?.full_name;
  const pullRequest = payload.pull_request.number;
  if (!repository || !pullRequest) throw new Error("Merged pull request payload is missing repository or PR number");
  const comments = await ingestPullRequest(repository, pullRequest);
  return { status: "ingested", repository, pullRequest, commentCount: comments.length };
}
