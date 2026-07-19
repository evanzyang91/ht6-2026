import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  decideGitHubWebhook,
  RepositorySyncQueue,
  verifyGitHubWebhookSignature,
} from "../src/githubWebhook.js";

const mergedBody = Buffer.from(JSON.stringify({
  action: "closed",
  repository: { full_name: "acme/api" },
  pull_request: { number: 42, merged: true },
}));

it("accepts only correctly signed webhook bodies", () => {
  const signature = `sha256=${createHmac("sha256", "secret").update(mergedBody).digest("hex")}`;
  expect(verifyGitHubWebhookSignature("secret", mergedBody, signature)).toBe(true);
  expect(verifyGitHubWebhookSignature("wrong", mergedBody, signature)).toBe(false);
  expect(verifyGitHubWebhookSignature("secret", mergedBody, undefined)).toBe(false);
});

it("queues a sync only for merged pull requests", () => {
  expect(decideGitHubWebhook("pull_request", mergedBody)).toEqual({
    status: "sync",
    repository: "acme/api",
    pullRequest: 42,
  });
  expect(decideGitHubWebhook("pull_request", Buffer.from(JSON.stringify({
    action: "closed",
    pull_request: { number: 42, merged: false },
  })))).toMatchObject({ status: "ignored" });
  expect(decideGitHubWebhook("push", mergedBody)).toMatchObject({ status: "ignored" });
});

it("serializes automatic syncs for the same repository", async () => {
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const sync = vi.fn()
    .mockImplementationOnce(() => firstBlocked)
    .mockResolvedValueOnce(undefined);
  const queue = new RepositorySyncQueue(sync, () => undefined);

  queue.enqueue("acme/api");
  queue.enqueue("acme/api");
  await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
  releaseFirst();
  await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
});
