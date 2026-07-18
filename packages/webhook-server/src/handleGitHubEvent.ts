import { ingestMergedPullRequest } from "@ht6/ingestion";
import { hasSeenDelivery, recordDelivery } from "./deliveryStore.js";

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
  deliveryId?: string,
): Promise<WebhookResult> {
  if (event !== "pull_request") return { status: "ignored", reason: "unsupported event" };
  const payload = JSON.parse(rawBody.toString("utf8")) as PullRequestWebhook;
  if (payload.action !== "closed" || payload.pull_request?.merged !== true) {
    return { status: "ignored", reason: "pull request was not merged" };
  }
  const repository = payload.repository?.full_name;
  const pullRequest = payload.pull_request.number;
  if (!repository || !pullRequest) throw new Error("Merged pull request payload is missing repository or PR number");

  // GitHub redelivers webhooks with the same delivery id (manual redelivery, retried failed
  // deliveries). Short-circuit before touching the GitHub API or the comment store at all.
  if (deliveryId && (await hasSeenDelivery(deliveryId))) {
    return { status: "ignored", reason: "duplicate delivery", repository, pullRequest };
  }

  const comments = await ingestPullRequest(repository, pullRequest);
  if (deliveryId) await recordDelivery(deliveryId);
  return { status: "ingested", repository, pullRequest, commentCount: comments.length };
}
