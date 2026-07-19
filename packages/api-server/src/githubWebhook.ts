import { createHmac, timingSafeEqual } from "node:crypto";

interface PullRequestWebhookPayload {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: { number?: number; merged?: boolean };
}

export type GitHubWebhookDecision =
  | { status: "ignored"; reason: string }
  | { status: "sync"; repository: string; pullRequest: number };

export function verifyGitHubWebhookSignature(
  secret: string,
  body: Buffer,
  signature: string | undefined,
): boolean {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function decideGitHubWebhook(event: string | undefined, body: Buffer): GitHubWebhookDecision {
  if (event !== "pull_request") return { status: "ignored", reason: "unsupported event" };

  const payload = JSON.parse(body.toString("utf8")) as PullRequestWebhookPayload;
  if (payload.action !== "closed" || payload.pull_request?.merged !== true) {
    return { status: "ignored", reason: "pull request was not merged" };
  }

  const repository = payload.repository?.full_name;
  const pullRequest = payload.pull_request.number;
  if (!repository || !pullRequest) {
    throw new Error("Merged pull request payload is missing repository or PR number");
  }
  return { status: "sync", repository, pullRequest };
}

/** Serializes syncs per repository while allowing different repositories to sync concurrently. */
export class RepositorySyncQueue {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly sync: (repository: string) => Promise<void>,
    private readonly onError: (repository: string, error: unknown) => void,
  ) {}

  enqueue(repository: string): void {
    const previous = this.pending.get(repository) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.sync(repository))
      .catch((error) => this.onError(repository, error))
      .finally(() => {
        if (this.pending.get(repository) === current) this.pending.delete(repository);
      });
    this.pending.set(repository, current);
  }
}
