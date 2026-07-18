import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGitHubEvent } from "../src/handleGitHubEvent.js";
import { verifyGitHubSignature } from "../src/verifyGitHubSignature.js";

const mergedPayload = Buffer.from(JSON.stringify({
  action: "closed",
  repository: { full_name: "acme/api" },
  pull_request: { number: 42, merged: true },
}));

describe("merge-only GitHub webhook", () => {
  it("verifies the raw request body signature", () => {
    const signature = `sha256=${createHmac("sha256", "secret").update(mergedPayload).digest("hex")}`;
    expect(verifyGitHubSignature("secret", mergedPayload, signature)).toBe(true);
    expect(verifyGitHubSignature("wrong", mergedPayload, signature)).toBe(false);
  });

  it("ingests a merged pull request", async () => {
    const ingest = vi.fn(async () => []);
    const result = await handleGitHubEvent("pull_request", mergedPayload, ingest);
    expect(ingest).toHaveBeenCalledWith("acme/api", 42);
    expect(result).toMatchObject({ status: "ingested", repository: "acme/api", pullRequest: 42 });
  });

  it("ignores closed pull requests that were not merged", async () => {
    const ingest = vi.fn(async () => []);
    const body = Buffer.from(JSON.stringify({ action: "closed", pull_request: { number: 42, merged: false } }));
    expect(await handleGitHubEvent("pull_request", body, ingest)).toMatchObject({ status: "ignored" });
    expect(ingest).not.toHaveBeenCalled();
  });

  describe("delivery deduplication", () => {
    let originalDataDir: string | undefined;

    beforeEach(async () => {
      originalDataDir = process.env.DATA_DIR;
      process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "webhook-delivery-"));
    });

    afterEach(() => {
      process.env.DATA_DIR = originalDataDir;
    });

    it("ingests once and skips a redelivered event with the same delivery id", async () => {
      const ingest = vi.fn(async () => []);

      const first = await handleGitHubEvent("pull_request", mergedPayload, ingest, "delivery-1");
      const redelivered = await handleGitHubEvent("pull_request", mergedPayload, ingest, "delivery-1");

      expect(first).toMatchObject({ status: "ingested", repository: "acme/api", pullRequest: 42 });
      expect(redelivered).toMatchObject({ status: "ignored", reason: "duplicate delivery" });
      expect(ingest).toHaveBeenCalledTimes(1);
    });

    it("processes a different delivery id for the same PR independently", async () => {
      const ingest = vi.fn(async () => []);

      await handleGitHubEvent("pull_request", mergedPayload, ingest, "delivery-1");
      const second = await handleGitHubEvent("pull_request", mergedPayload, ingest, "delivery-2");

      expect(second).toMatchObject({ status: "ingested" });
      expect(ingest).toHaveBeenCalledTimes(2);
    });
  });
});
