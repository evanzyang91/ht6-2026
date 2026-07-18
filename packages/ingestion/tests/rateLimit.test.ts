import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRateLimitRetry } from "../src/github/rateLimit.js";

function rateLimitError(status: number): Error & { status: number } {
  const error = new Error(`rate limited (${status})`) as Error & { status: number };
  error.status = status;
  return error;
}

describe("withRateLimitRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a 403 and returns the result once the call recovers", async () => {
    let attempts = 0;
    const promise = withRateLimitRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw rateLimitError(403);
      return "ok";
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(attempts).toBe(3);
  });

  it("retries a 429 the same way as a 403", async () => {
    let attempts = 0;
    const promise = withRateLimitRetry(async () => {
      attempts += 1;
      if (attempts < 2) throw rateLimitError(429);
      return "ok";
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does not retry a non-rate-limit error", async () => {
    let attempts = 0;
    const promise = withRateLimitRetry(async () => {
      attempts += 1;
      throw new Error("boom");
    });

    await expect(promise).rejects.toThrow("boom");
    expect(attempts).toBe(1);
  });

  it("gives up after exhausting retries on a persistent 403", async () => {
    let attempts = 0;
    const promise = withRateLimitRetry(async () => {
      attempts += 1;
      throw rateLimitError(403);
    });

    const assertion = expect(promise).rejects.toThrow("rate limited (403)");
    await vi.runAllTimersAsync();
    await assertion;
    expect(attempts).toBe(4);
  });

  it("proactively sleeps until reset when remaining budget is low", async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 30;
    const promise = withRateLimitRetry(async () => ({
      data: "ok",
      headers: { "x-ratelimit-remaining": "2", "x-ratelimit-reset": String(resetAt) },
    }));

    let resolved = false;
    promise.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(resolved).toBe(true);
    await expect(promise).resolves.toMatchObject({ data: "ok" });
  });

  it("does not sleep when remaining budget is healthy", async () => {
    const promise = withRateLimitRetry(async () => ({
      data: "ok",
      headers: {
        "x-ratelimit-remaining": "500",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
      },
    }));

    let resolved = false;
    promise.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });
});
